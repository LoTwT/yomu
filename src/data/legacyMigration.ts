import {
  isArticleRecord,
  YOMU_ENTITY_SCHEMA_VERSION,
  type ArticleRecord,
  type ArticleSentenceRecord,
  type CapabilityCoverage,
  type ReadingAttempt,
  type VocabularyContext,
  type VocabularyTerm,
} from './entities'
import type { LegacyMigrationPayload, LocalRepositories } from './repositories'

const importedArticleIndexKey = 'yomu:imported-article:index'
const importedArticlePrefix = 'yomu:imported-article:'
const practiceSessionPrefix = 'yomu:practice-session:'
const savedVocabularyKey = 'yomu:saved-vocabulary'
const ttsSettingsKey = 'yomu:tts-settings'
const readExpansionSettingsKey = 'yomu:read-expansion-settings'

export const LEGACY_MIGRATION_VERSION = 2

export interface LegacyKeyValueSource {
  get: (key: string) => string | null
  keys: () => string[]
}

export interface MutableLegacyKeyValueSource extends LegacyKeyValueSource {
  set: (key: string, value: string) => void
}

export interface MigrationDiagnostic {
  key: string
  code: 'invalid-json' | 'invalid-article' | 'invalid-session' | 'missing-article' | 'unrecoverable-vocabulary'
  message: string
}

export interface LegacyMigrationPlan extends LegacyMigrationPayload {
  diagnostics: MigrationDiagnostic[]
}

export interface LegacyMigrationResult {
  status: 'applied' | 'already-applied'
  migrated: {
    articles: number
    attempts: number
    vocabularyTerms: number
    vocabularyContexts: number
  }
  diagnostics: MigrationDiagnostic[]
  clearedSensitiveSettings: string[]
}

export function buildLegacyMigrationPlan(source: LegacyKeyValueSource): LegacyMigrationPlan {
  const diagnostics: MigrationDiagnostic[] = []
  const articles = collectLegacyArticles(source, diagnostics)
  const articleById = new Map(articles.map(article => [article.id, article]))
  const attempts = collectLegacyAttempts(source, articleById, diagnostics)
  const vocabulary = collectLegacyVocabulary(source, articles, diagnostics)

  return {
    targetVersion: LEGACY_MIGRATION_VERSION,
    articles,
    attempts,
    vocabularyTerms: vocabulary.terms,
    vocabularyContexts: vocabulary.contexts,
    diagnostics,
  }
}

function collectLegacyVocabulary(
  source: LegacyKeyValueSource,
  articles: ArticleRecord[],
  diagnostics: MigrationDiagnostic[],
): { terms: VocabularyTerm[], contexts: VocabularyContext[] } {
  const raw = parseJson(source.get(savedVocabularyKey), savedVocabularyKey, diagnostics)
  if (raw === null) {
    return { terms: [], contexts: [] }
  }
  if (!Array.isArray(raw)) {
    diagnostics.push({
      key: savedVocabularyKey,
      code: 'unrecoverable-vocabulary',
      message: 'The legacy vocabulary record is not a token id list and was skipped.',
    })
    return { terms: [], contexts: [] }
  }

  const termsByNormalized = new Map<string, VocabularyTerm>()
  const contexts: VocabularyContext[] = []
  const savedIds = [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))]

  for (const legacyTokenId of savedIds) {
    const candidates = articles.flatMap(article => article.sentences.flatMap(sentence =>
      sentence.tokens
        .filter(token => token.kind === 'word'
          && (token.id === legacyTokenId || token.id.endsWith(`:${legacyTokenId}`)))
        .map(token => ({ article, sentence, token })),
    ))

    if (candidates.length !== 1) {
      diagnostics.push({
        key: `${savedVocabularyKey}:${legacyTokenId}`,
        code: 'unrecoverable-vocabulary',
        message: candidates.length === 0
          ? 'The saved token no longer exists in a migrated article.'
          : 'The saved token id matches more than one migrated article, so no context was guessed.',
      })
      continue
    }

    const { article, sentence, token } = candidates[0]!
    const normalizedTerm = normalizeVocabularyTerm(token.text)
    if (!normalizedTerm) {
      continue
    }
    const termId = `legacy-term:${encodeURIComponent(normalizedTerm)}`
    const savedAt = article.updatedAt
    const existing = termsByNormalized.get(normalizedTerm)
    termsByNormalized.set(normalizedTerm, existing ?? {
      id: termId,
      normalizedTerm,
      displayTerm: token.text,
      meaning: token.meaning,
      orphanedContextCount: 0,
      savedAt,
      updatedAt: savedAt,
    })
    contexts.push({
      id: `legacy-context:${article.id}:${sentence.id}:${token.id}`,
      termId,
      articleId: article.id,
      sentenceId: sentence.id,
      sentenceText: sentence.original,
      displayTerm: token.text,
      savedAt,
    })
  }

  return {
    terms: [...termsByNormalized.values()].sort((left, right) => left.id.localeCompare(right.id)),
    contexts: contexts.sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function normalizeVocabularyTerm(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

export async function migrateLegacyData(
  repositories: LocalRepositories,
  source: LegacyKeyValueSource,
): Promise<LegacyMigrationResult> {
  const clearedSensitiveSettings = isMutableSource(source)
    ? clearLegacySensitiveSettings(source)
    : []
  const currentVersion = await repositories.migration.getVersion()
  if (currentVersion >= LEGACY_MIGRATION_VERSION) {
    return {
      status: 'already-applied',
      migrated: emptyMigrationCounts(),
      diagnostics: [],
      clearedSensitiveSettings,
    }
  }

  const plan = buildLegacyMigrationPlan(source)
  await repositories.migration.apply(plan)
  return {
    status: 'applied',
    migrated: {
      articles: plan.articles.length,
      attempts: plan.attempts.length,
      vocabularyTerms: plan.vocabularyTerms.length,
      vocabularyContexts: plan.vocabularyContexts.length,
    },
    diagnostics: plan.diagnostics,
    clearedSensitiveSettings,
  }
}

export function clearLegacySensitiveSettings(source: MutableLegacyKeyValueSource): string[] {
  const changed: string[] = []
  if (rewriteJson(source, ttsSettingsKey, (value) => {
    const mimo = asRecord(value.mimo)
    if (!mimo || typeof mimo.apiKey !== 'string' || !mimo.apiKey) {
      return false
    }
    mimo.apiKey = ''
    return true
  })) {
    changed.push(ttsSettingsKey)
  }

  if (rewriteJson(source, readExpansionSettingsKey, (value) => {
    const ai = asRecord(value.ai)
    const openai = asRecord(ai?.openai)
    let didChange = false
    if (openai && typeof openai.apiKey === 'string' && openai.apiKey) {
      openai.apiKey = ''
      didChange = true
    }
    if (ai?.consentAccepted === true) {
      ai.consentAccepted = false
      didChange = true
    }
    return didChange
  })) {
    changed.push(readExpansionSettingsKey)
  }
  return changed
}

function collectLegacyArticles(
  source: LegacyKeyValueSource,
  diagnostics: MigrationDiagnostic[],
): ArticleRecord[] {
  const ids = new Set<string>()
  const index = parseJson(source.get(importedArticleIndexKey), importedArticleIndexKey, diagnostics)
  if (Array.isArray(index)) {
    for (const item of index) {
      const record = asRecord(item)
      if (typeof record?.articleId === 'string' && record.articleId) {
        ids.add(record.articleId)
      }
    }
  }

  for (const key of source.keys()) {
    if (key.startsWith(importedArticlePrefix) && key !== importedArticleIndexKey) {
      ids.add(key.slice(importedArticlePrefix.length))
    }
  }

  const articles: ArticleRecord[] = []
  for (const id of [...ids].sort()) {
    const key = `${importedArticlePrefix}${id}`
    const raw = parseJson(source.get(key), key, diagnostics)
    const article = convertLegacyArticle(raw)
    if (!article) {
      diagnostics.push({
        key,
        code: 'invalid-article',
        message: 'The legacy article is incomplete or does not match its import metadata.',
      })
      continue
    }
    articles.push(article)
  }
  return articles
}

function collectLegacyAttempts(
  source: LegacyKeyValueSource,
  articles: Map<string, ArticleRecord>,
  diagnostics: MigrationDiagnostic[],
): ReadingAttempt[] {
  const attempts: ReadingAttempt[] = []
  for (const key of source.keys().filter(key => key.startsWith(practiceSessionPrefix)).sort()) {
    const raw = asRecord(parseJson(source.get(key), key, diagnostics))
    if (!raw
      || typeof raw.articleId !== 'string'
      || typeof raw.completedAt !== 'string'
      || !isIsoDate(raw.completedAt)
      || typeof raw.durationSec !== 'number'
      || !Number.isFinite(raw.durationSec)
      || raw.durationSec < 0) {
      diagnostics.push({
        key,
        code: 'invalid-session',
        message: 'The legacy completion record is invalid and was skipped.',
      })
      continue
    }

    const article = articles.get(raw.articleId)
    if (!article) {
      diagnostics.push({
        key,
        code: 'missing-article',
        message: `The legacy session references article ${raw.articleId}, which was not migrated.`,
      })
      continue
    }

    const lastSentence = article.sentences.at(-1)
    attempts.push({
      id: `legacy-completed:${raw.articleId}:${raw.completedAt}`,
      articleId: raw.articleId,
      currentSentenceId: lastSentence?.id,
      furthestSentenceOrdinal: Math.max(0, article.sentences.length - 1),
      activeDurationSec: raw.durationSec,
      status: 'completed',
      startedAt: raw.completedAt,
      lastOpenedAt: raw.completedAt,
      completedAt: raw.completedAt,
    })
  }
  return attempts
}

function convertLegacyArticle(value: unknown): ArticleRecord | null {
  const article = asRecord(value)
  const metadata = asRecord(article?.importMetadata)
  const sourceRef = asRecord(metadata?.sourceRef)
  if (!article
    || !metadata
    || !sourceRef
    || typeof article.id !== 'string'
    || metadata.articleId !== article.id
    || typeof metadata.textHash !== 'string'
    || typeof metadata.importedAt !== 'string'
    || !isIsoDate(metadata.importedAt)
    || (metadata.sourceType !== 'paste' && metadata.sourceType !== 'file' && metadata.sourceType !== 'url')
    || typeof article.title !== 'string'
    || !article.title.trim()
    || !Array.isArray(article.sentences)
    || article.sentences.length === 0) {
    return null
  }

  const sentences = article.sentences
    .map((sentence, index) => convertLegacySentence(article.id as string, sentence, index))
  if (sentences.some(sentence => sentence === null)) {
    return null
  }
  const validSentences = sentences as ArticleSentenceRecord[]
  const legacyRights = asRecord(article.rights)
  const factSources = Array.isArray(article.factSources)
    ? article.factSources.flatMap((source) => {
        const record = asRecord(source)
        return typeof record?.title === 'string' && typeof record.url === 'string'
          ? [{ title: record.title, url: record.url }]
          : []
      })
    : []
  const wordCount = validSentences.reduce((count, sentence) =>
    count + sentence.tokens.filter(token => token.kind === 'word').length, 0)

  const migrated: ArticleRecord = {
    id: article.id,
    schemaVersion: YOMU_ENTITY_SCHEMA_VERSION,
    contentHash: metadata.textHash,
    title: article.title,
    description: typeof article.deck === 'string' && article.deck ? article.deck : undefined,
    language: 'en',
    level: article.level === 'B1' || article.level === 'B2' ? article.level : 'unassessed',
    source: {
      kind: metadata.sourceType,
      label: typeof sourceRef.label === 'string' && sourceRef.label ? sourceRef.label : 'Imported text',
      url: typeof sourceRef.url === 'string' ? sourceRef.url : undefined,
    },
    rights: {
      status: 'user-provided-unknown',
      note: typeof legacyRights?.licenseNote === 'string'
        ? legacyRights.licenseNote
        : 'User-provided content; rights were not independently verified.',
      ttsAllowed: legacyRights?.ttsAllowed !== false,
      translationAllowed: legacyRights?.translationAllowed !== false,
      cacheAllowed: legacyRights?.cacheAllowed !== false,
    },
    capabilities: {
      sentenceTranslation: coverage(validSentences, sentence => Boolean(sentence.translation?.trim())),
      sentenceIpa: coverage(validSentences, sentence => Boolean(sentence.sentenceIpa?.trim())),
      tokenMeaning: tokenCoverage(validSentences, token => Boolean(token.meaning?.trim())),
    },
    sentences: validSentences,
    factSources,
    wordCount,
    estimatedReadTimeMinutes: typeof article.estimatedReadTimeMinutes === 'number'
      && Number.isFinite(article.estimatedReadTimeMinutes)
      && article.estimatedReadTimeMinutes >= 0
      ? article.estimatedReadTimeMinutes
      : Math.max(1, Math.ceil(wordCount / 180)),
    createdAt: metadata.importedAt,
    updatedAt: metadata.importedAt,
  }
  return isArticleRecord(migrated) ? migrated : null
}

function convertLegacySentence(
  articleId: string,
  value: unknown,
  fallbackOrder: number,
): ArticleSentenceRecord | null {
  const sentence = asRecord(value)
  if (!sentence
    || typeof sentence.id !== 'string'
    || typeof sentence.original !== 'string'
    || !sentence.original.trim()
    || !Array.isArray(sentence.tokens)) {
    return null
  }

  const tokens = sentence.tokens.flatMap((token, index) => {
    const record = asRecord(token)
    if (!record || typeof record.text !== 'string') {
      return []
    }
    const legacyId = typeof record.id === 'string' && record.id ? record.id : `token-${index}`
    return [{
      id: namespaceId(articleId, legacyId),
      text: record.text,
      kind: record.kind === 'punctuation' ? 'punctuation' as const : 'word' as const,
      ipa: typeof record.ipa === 'string' ? record.ipa : undefined,
      meaning: typeof record.meaning === 'string' ? record.meaning : undefined,
    }]
  })
  const annotations = asRecord(sentence.annotations)
  return {
    id: namespaceId(articleId, sentence.id),
    order: typeof sentence.order === 'number' && sentence.order >= 0 ? sentence.order : fallbackOrder,
    paragraphIndex: typeof sentence.paragraphIndex === 'number' && sentence.paragraphIndex >= 0
      ? sentence.paragraphIndex
      : 0,
    textHash: typeof sentence.textHash === 'string' && sentence.textHash
      ? sentence.textHash
      : `legacy-${fallbackOrder}`,
    original: sentence.original,
    translation: typeof sentence.translation === 'string' && sentence.translation
      ? sentence.translation
      : undefined,
    sentenceIpa: typeof annotations?.ipa === 'string' && annotations.ipa ? annotations.ipa : undefined,
    tokens,
  }
}

function coverage<T>(values: T[], present: (value: T) => boolean): CapabilityCoverage {
  const count = values.filter(present).length
  if (count === 0) {
    return 'none'
  }
  return count === values.length ? 'complete' : 'partial'
}

function tokenCoverage(
  sentences: ArticleSentenceRecord[],
  present: (token: ArticleSentenceRecord['tokens'][number]) => boolean,
): CapabilityCoverage {
  return coverage(sentences.flatMap(sentence => sentence.tokens.filter(token => token.kind === 'word')), present)
}

function namespaceId(articleId: string, localId: string): string {
  return localId.startsWith(`${articleId}:`) ? localId : `${articleId}:${localId}`
}

function rewriteJson(
  source: MutableLegacyKeyValueSource,
  key: string,
  mutate: (value: Record<string, unknown>) => boolean,
): boolean {
  const raw = source.get(key)
  if (!raw) {
    return false
  }
  try {
    const value = asRecord(JSON.parse(raw))
    if (!value || !mutate(value)) {
      return false
    }
    source.set(key, JSON.stringify(value))
    return true
  }
  catch {
    return false
  }
}

function parseJson(
  raw: string | null,
  key: string,
  diagnostics: MigrationDiagnostic[],
): unknown {
  if (raw === null) {
    return null
  }
  try {
    return JSON.parse(raw)
  }
  catch {
    diagnostics.push({
      key,
      code: 'invalid-json',
      message: 'The legacy record is not valid JSON.',
    })
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value))
}

function isMutableSource(source: LegacyKeyValueSource): source is MutableLegacyKeyValueSource {
  return 'set' in source && typeof source.set === 'function'
}

function emptyMigrationCounts(): LegacyMigrationResult['migrated'] {
  return {
    articles: 0,
    attempts: 0,
    vocabularyTerms: 0,
    vocabularyContexts: 0,
  }
}
