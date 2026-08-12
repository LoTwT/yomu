import {
  isArticleRecord,
  YOMU_ENTITY_SCHEMA_VERSION,
  type ArticleRecord,
  type ArticleSentenceRecord,
  type ReadingAttempt,
} from '@/data/entities'
import { deriveArticleCapabilities } from '@/data/articleCapabilities'
import { DataConstraintError } from '@/data/repositories'
import { createStableTextHash } from '@/features/import/textHash'
import { getArticleDeletionFence } from './articleDeletionFence'
import type { PlatformServices } from '@/platform/contracts'
import { publicDomainSampleArticle } from './publicDomainSample'
import type { ArticleSentence, DailyArticle, PublicDomainArticleMetadata } from './types'

const publicDomainArticleIdPrefix = 'public-domain'

export interface StartBundledSampleReadingDependencies {
  now?: () => Date
  randomUUID?: () => string
}

export interface StartBundledSampleReadingResult {
  article: ArticleRecord
  attempt: ReadingAttempt
  articleCreated: boolean
  attemptCreated: boolean
}

export class BundledSampleValidationError extends Error {
  constructor(message = 'The bundled public-domain sample is not ready to save.') {
    super(message)
    this.name = 'BundledSampleValidationError'
  }
}

export class BundledSampleIdentityConflictError extends Error {
  constructor(
    readonly articleId: string,
    readonly expectedItemId: string,
    readonly expectedItemVersion: string,
  ) {
    super(`Article ${articleId} is already used by a different source item.`)
    this.name = 'BundledSampleIdentityConflictError'
  }
}

export class BundledSampleDeletionPendingError extends Error {
  constructor(readonly articleId: string) {
    super(`Article ${articleId} is being deleted and cannot be reopened.`)
    this.name = 'BundledSampleDeletionPendingError'
  }
}

/**
 * Adds the approved bundled sample to the canonical library and opens its active
 * reading attempt. Article and first-attempt writes share one transaction.
 */
export async function startBundledSampleReading(
  services: Pick<PlatformServices, 'repositories' | 'preferences'>,
  dependencies: StartBundledSampleReadingDependencies = {},
): Promise<StartBundledSampleReadingResult> {
  const now = dependencies.now ?? (() => new Date())
  const randomUUID = dependencies.randomUUID ?? getRandomUUID
  const timestamp = now().toISOString()
  const expectedArticle = mapBundledSampleToArticleRecord(
    publicDomainSampleArticle,
    timestamp,
  )
  const identity = getPublicDomainIdentity(expectedArticle)
  if (!identity) {
    throw new BundledSampleValidationError('The bundled sample is missing its stable source identity.')
  }

  return services.repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const articles = await scope.articles.list()
    const identityMatches = articles.filter(article =>
      hasPublicDomainIdentity(article, identity.itemId, identity.itemVersion))
    if (identityMatches.length > 1) {
      throw new BundledSampleIdentityConflictError(
        expectedArticle.id,
        identity.itemId,
        identity.itemVersion,
      )
    }

    const articleAtStableId = articles.find(article => article.id === expectedArticle.id)
    if (articleAtStableId && !hasPublicDomainIdentity(
      articleAtStableId,
      identity.itemId,
      identity.itemVersion,
    )) {
      throw new BundledSampleIdentityConflictError(
        expectedArticle.id,
        identity.itemId,
        identity.itemVersion,
      )
    }

    const existingArticle = identityMatches[0] ?? articleAtStableId
    if (existingArticle) {
      const fence = await getArticleDeletionFence(
        services.preferences,
        existingArticle.id,
      )
      if (fence.deletionPending || fence.progressRetired) {
        throw new BundledSampleDeletionPendingError(existingArticle.id)
      }
    }

    let initialAttemptId: string | undefined
    let article = existingArticle
    if (!article) {
      initialAttemptId = randomUUID()
      article = moveArticleToId(
        expectedArticle,
        createPublicDomainArticleIncarnationId(
          identity.itemId,
          identity.itemVersion,
          initialAttemptId,
        ),
      )
    }
    const articleCreated = !existingArticle
    if (articleCreated) {
      try {
        await scope.articles.add(article)
      }
      catch (error) {
        if (error instanceof DataConstraintError) {
          throw new BundledSampleIdentityConflictError(
            expectedArticle.id,
            identity.itemId,
            identity.itemVersion,
          )
        }
        throw error
      }
    }

    const activeAttempt = await scope.attempts.getActiveByArticle(article.id)
    if (activeAttempt) {
      const attempt: ReadingAttempt = {
        ...activeAttempt,
        currentSentenceId: resolveCurrentSentenceId(article, activeAttempt.currentSentenceId),
        lastOpenedAt: timestamp,
      }
      await scope.attempts.put(attempt)
      return {
        article,
        attempt,
        articleCreated,
        attemptCreated: false,
      }
    }

    const attempt: ReadingAttempt = {
      id: initialAttemptId ?? randomUUID(),
      articleId: article.id,
      currentSentenceId: resolveCurrentSentenceId(article),
      furthestSentenceOrdinal: 0,
      activeDurationSec: 0,
      progressRevision: 0,
      status: 'active',
      startedAt: timestamp,
      lastOpenedAt: timestamp,
    }
    await scope.attempts.put(attempt)

    return {
      article,
      attempt,
      articleCreated,
      attemptCreated: true,
    }
  })
}

export function mapBundledSampleToArticleRecord(
  sample: DailyArticle,
  timestamp: string,
): ArticleRecord {
  if (!isApprovedPublicDomainSample(sample)
    || sample.rights.sourceType !== 'public-domain'
    || sample.rights.rightsStatus !== 'public-domain'
    || !hasCompletePublicDomainMetadata(sample.publicDomainMetadata)
    || sample.publicDomainMetadata.rightsStatus !== 'public-domain-us'
    || sample.publicDomainMetadata.allowedUses.tts !== sample.rights.ttsAllowed
    || sample.publicDomainMetadata.allowedUses.translation
      !== sample.rights.translationAllowed
    || sample.publicDomainMetadata.allowedUses.cache !== sample.rights.cacheAllowed
    || !sample.contentVersion.trim()) {
    throw new BundledSampleValidationError()
  }

  const articleId = createPublicDomainArticleId(
    sample.publicDomainMetadata.id,
    sample.contentVersion,
  )
  const sentences = sample.sentences.map((sentence, index) =>
    mapSentence(articleId, sentence, index))
  const wordCount = sentences.reduce((total, sentence) =>
    total + sentence.tokens.filter(token => token.kind === 'word').length, 0)
  const article: ArticleRecord = {
    id: articleId,
    schemaVersion: YOMU_ENTITY_SCHEMA_VERSION,
    contentHash: createStableTextHash(sentences.map(sentence => sentence.original).join('\n')),
    title: sample.title,
    description: nonEmptyText(sample.deck),
    language: 'en',
    level: sample.level,
    source: {
      kind: 'public-domain',
      label: sample.publicDomainMetadata.sourceLabel,
      url: sample.publicDomainMetadata.sourceUrl,
      itemId: sample.publicDomainMetadata.id,
      itemVersion: sample.contentVersion,
      author: sample.publicDomainMetadata.author,
      publicationYear: sample.publicDomainMetadata.publicationYear,
    },
    rights: {
      status: 'public-domain',
      note: createRightsNote(sample),
      ttsAllowed: sample.rights.ttsAllowed,
      translationAllowed: sample.rights.translationAllowed,
      cacheAllowed: sample.rights.cacheAllowed,
    },
    capabilities: deriveArticleCapabilities(sentences),
    sentences,
    factSources: sample.factSources.map(source => ({ ...source })),
    wordCount,
    estimatedReadTimeMinutes: sample.estimatedReadTimeMinutes,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  if (!isArticleRecord(article)) {
    throw new BundledSampleValidationError()
  }
  return article
}

function isApprovedPublicDomainSample(sample: DailyArticle): boolean {
  return sample.qaStatus === 'approved'
    && sample.language === 'en'
    && (sample.level === 'B1' || sample.level === 'B2')
    && Boolean(sample.id.trim())
    && Boolean(sample.title.trim())
    && Boolean(sample.contentVersion.trim())
    && Number.isFinite(sample.estimatedReadTimeMinutes)
    && sample.estimatedReadTimeMinutes >= 0
    && Array.isArray(sample.factSources)
    && sample.factSources.every(source =>
      Boolean(source.title.trim()) && Boolean(source.url.trim()))
    && Array.isArray(sample.sentences)
    && sample.sentences.length > 0
    && sample.sentences.every(isReadableSampleSentence)
}

function isReadableSampleSentence(sentence: ArticleSentence): boolean {
  return Boolean(sentence.id.trim())
    && Boolean(sentence.original.trim())
    && (sentence.order === undefined || isNonNegativeFiniteNumber(sentence.order))
    && (sentence.paragraphIndex === undefined
      || isNonNegativeFiniteNumber(sentence.paragraphIndex))
    && Array.isArray(sentence.tokens)
    && sentence.tokens.length > 0
    && sentence.tokens.every(token => typeof token.text === 'string')
}

export function createPublicDomainArticleId(itemId: string, itemVersion: string): string {
  const normalizedItemId = normalizeIdentityPart(itemId)
  const normalizedItemVersion = normalizeIdentityPart(itemVersion)
  if (!normalizedItemId || !normalizedItemVersion) {
    throw new BundledSampleValidationError('The bundled sample source identity is incomplete.')
  }
  return `${publicDomainArticleIdPrefix}:${normalizedItemId}:${normalizedItemVersion}`
}

export function createPublicDomainArticleIncarnationId(
  itemId: string,
  itemVersion: string,
  incarnationId: string,
): string {
  const normalizedIncarnationId = normalizeIdentityPart(incarnationId)
  if (!normalizedIncarnationId) {
    throw new BundledSampleValidationError('The bundled sample incarnation identity is incomplete.')
  }
  return `${createPublicDomainArticleId(itemId, itemVersion)}:incarnation:${normalizedIncarnationId}`
}

function moveArticleToId(article: ArticleRecord, articleId: string): ArticleRecord {
  const sentencePrefix = `${article.id}:`
  const moved: ArticleRecord = {
    ...article,
    id: articleId,
    sentences: article.sentences.map((sentence) => {
      if (!sentence.id.startsWith(sentencePrefix)) {
        throw new BundledSampleValidationError('The bundled sample sentence identity is inconsistent.')
      }
      const sentenceId = `${articleId}:${sentence.id.slice(sentencePrefix.length)}`
      const tokenPrefix = `${sentence.id}:`
      return {
        ...sentence,
        id: sentenceId,
        tokens: sentence.tokens.map((token) => {
          if (!token.id.startsWith(tokenPrefix)) {
            throw new BundledSampleValidationError('The bundled sample token identity is inconsistent.')
          }
          return {
            ...token,
            id: `${sentenceId}:${token.id.slice(tokenPrefix.length)}`,
          }
        }),
      }
    }),
  }
  if (!isArticleRecord(moved)) {
    throw new BundledSampleValidationError()
  }
  return moved
}

function mapSentence(
  articleId: string,
  sentence: ArticleSentence,
  fallbackOrder: number,
): ArticleSentenceRecord {
  const sourceSentenceId = normalizeIdentityPart(sentence.id) || `s${fallbackOrder + 1}`
  const sentenceId = `${articleId}:${sourceSentenceId}`
  const translation = nonEmptyText(sentence.translation)
    ?? nonEmptyText(sentence.bilingual?.zh)
  const sentenceIpa = nonEmptyText(sentence.annotations?.ipa)

  return {
    id: sentenceId,
    order: isNonNegativeFiniteNumber(sentence.order) ? sentence.order : fallbackOrder,
    paragraphIndex: isNonNegativeFiniteNumber(sentence.paragraphIndex)
      ? sentence.paragraphIndex
      : 0,
    textHash: nonEmptyText(sentence.textHash)
      ?? createStableTextHash(sentence.original),
    original: sentence.original,
    ...(translation ? { translation } : {}),
    ...(sentenceIpa ? { sentenceIpa } : {}),
    tokens: sentence.tokens.map((token, index) => ({
      id: `${sentenceId}:t${index + 1}`,
      text: token.text,
      kind: token.kind === 'punctuation'
        || (token.kind === undefined && !/[A-Za-z0-9]/.test(token.text))
        ? 'punctuation'
        : 'word',
      ...(nonEmptyText(token.ipa) ? { ipa: nonEmptyText(token.ipa) } : {}),
      ...(nonEmptyText(token.meaning) ? { meaning: nonEmptyText(token.meaning) } : {}),
    })),
  }
}

function createRightsNote(sample: DailyArticle): string {
  const metadata = sample.publicDomainMetadata
  if (!metadata) {
    throw new BundledSampleValidationError()
  }
  return uniqueNonEmpty([
    sample.rights.licenseNote,
    metadata.publicDomainBasis,
    metadata.regionPosture,
    `摘录范围：${metadata.excerptRange}`,
    `来源获取日期：${metadata.retrievedAt}`,
    metadata.providerCachePolicy,
  ]).join(' ')
}

function hasCompletePublicDomainMetadata(
  metadata: PublicDomainArticleMetadata | undefined,
): metadata is PublicDomainArticleMetadata {
  return Boolean(metadata
    && metadata.noRewrite
    && metadata.id.trim()
    && metadata.sourceLabel.trim()
    && metadata.sourceUrl.trim()
    && metadata.author.trim()
    && metadata.publicationYear.trim()
    && metadata.publicDomainBasis.trim()
    && metadata.regionPosture.trim()
    && metadata.excerptRange.trim()
    && metadata.retrievedAt.trim())
}

function getPublicDomainIdentity(
  article: ArticleRecord,
): { itemId: string, itemVersion: string } | null {
  const itemId = article.source.itemId?.trim()
  const itemVersion = article.source.itemVersion?.trim()
  return article.source.kind === 'public-domain' && itemId && itemVersion
    ? { itemId, itemVersion }
    : null
}

function hasPublicDomainIdentity(
  article: ArticleRecord,
  itemId: string,
  itemVersion: string,
): boolean {
  const identity = getPublicDomainIdentity(article)
  return identity?.itemId === itemId && identity.itemVersion === itemVersion
}

function resolveCurrentSentenceId(article: ArticleRecord, candidate?: string): string {
  if (candidate && article.sentences.some(sentence => sentence.id === candidate)) {
    return candidate
  }
  const firstSentence = [...article.sentences].sort((left, right) => left.order - right.order)[0]
  if (!firstSentence) {
    throw new BundledSampleValidationError('The bundled sample has no readable sentence.')
  }
  return firstSentence.id
}

function normalizeIdentityPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
}

function nonEmptyText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function isNonNegativeFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function getRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('This platform cannot create a secure local record id.')
  }
  return globalThis.crypto.randomUUID()
}
