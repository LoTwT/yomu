import {
  YOMU_ENTITY_SCHEMA_VERSION,
  type ArticleRecord,
  type ArticleSentenceRecord,
  type ReadingAttempt,
} from '@/data/entities'
import type { LocalRepositories } from '@/data/repositories'
import type { ImportedArticleDraft } from './importArticle'

export interface SaveImportedArticleDependencies {
  now?: () => Date
  randomUUID?: () => string
}

export type SaveImportedArticleResult =
  | {
      kind: 'created'
      article: ArticleRecord
      attempt: ReadingAttempt
    }
  | {
      kind: 'duplicate'
      article: ArticleRecord
    }

export async function saveImportedArticle(
  repositories: LocalRepositories,
  draft: ImportedArticleDraft,
  dependencies: SaveImportedArticleDependencies = {},
): Promise<SaveImportedArticleResult> {
  const now = dependencies.now ?? (() => new Date())
  const randomUUID = dependencies.randomUUID ?? getRandomUUID

  return repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const existing = (await scope.articles.list()).find(article =>
      isUserImportedArticle(article) && article.contentHash === draft.contentHash)

    if (existing) {
      return { kind: 'duplicate', article: existing }
    }

    const timestamp = now().toISOString()
    const articleId = randomUUID()
    const sentences = namespaceSentences(articleId, draft.sentences)
    const source = {
      ...draft.source,
      label: normalizeSourceLabel(draft.source.label),
    }
    const article: ArticleRecord = {
      id: articleId,
      schemaVersion: YOMU_ENTITY_SCHEMA_VERSION,
      contentHash: draft.contentHash,
      title: normalizeTitle(draft.title),
      description: createDescription(sentences),
      language: 'en',
      level: 'unassessed',
      source,
      rights: {
        status: 'user-provided-unknown',
        note: '用户提供的内容；Yomu 未验证其版权状态，请确保你有权保存和处理。',
        ttsAllowed: true,
        translationAllowed: true,
        cacheAllowed: true,
      },
      capabilities: {
        sentenceTranslation: 'none',
        sentenceIpa: 'none',
        tokenMeaning: 'none',
      },
      sentences,
      factSources: source.url
        ? [{ title: source.label, url: source.url }]
        : [],
      wordCount: draft.wordCount,
      estimatedReadTimeMinutes: draft.estimatedReadTimeMinutes,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const attempt: ReadingAttempt = {
      id: randomUUID(),
      articleId,
      currentSentenceId: sentences[0]?.id,
      furthestSentenceOrdinal: 0,
      activeDurationSec: 0,
      progressRevision: 0,
      status: 'active',
      startedAt: timestamp,
      lastOpenedAt: timestamp,
    }

    await scope.articles.put(article)
    await scope.attempts.put(attempt)

    return { kind: 'created', article, attempt }
  })
}

function isUserImportedArticle(article: ArticleRecord): boolean {
  return article.source.kind === 'paste'
    || article.source.kind === 'file'
    || article.source.kind === 'url'
}

function namespaceSentences(
  articleId: string,
  sentences: readonly ArticleSentenceRecord[],
): ArticleSentenceRecord[] {
  return sentences.map((sentence) => {
    const sentenceId = `${articleId}:${sentence.id}`
    return {
      ...sentence,
      id: sentenceId,
      tokens: sentence.tokens.map((token, index) => ({
        ...token,
        id: `${sentenceId}:t${index + 1}`,
      })),
    }
  })
}

function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new Error('文章标题不能为空。')
  }
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized
}

function normalizeSourceLabel(sourceLabel: string): string {
  const normalized = sourceLabel.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new Error('内容来源不能为空。')
  }
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized
}

function createDescription(sentences: readonly ArticleSentenceRecord[]): string | undefined {
  const description = sentences.slice(0, 2).map(sentence => sentence.original).join(' ')
  if (!description) {
    return undefined
  }
  return description.length > 260
    ? `${description.slice(0, 257).trimEnd()}...`
    : description
}

function getRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('This platform cannot create a secure local article id.')
  }
  return globalThis.crypto.randomUUID()
}
