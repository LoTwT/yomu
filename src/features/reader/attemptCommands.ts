import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import type { LocalRepositories } from '@/data/repositories'

export class ArticleNotFoundError extends Error {
  constructor(readonly articleId: string) {
    super(`Article ${articleId} was not found.`)
    this.name = 'ArticleNotFoundError'
  }
}

export class ReadingAttemptUnavailableError extends Error {
  constructor(readonly attemptId: string) {
    super(`Reading attempt ${attemptId} is no longer active.`)
    this.name = 'ReadingAttemptUnavailableError'
  }
}

export interface ReadingCommandDependencies {
  now?: () => Date
  randomUUID?: () => string
}

export interface OpenArticleResult {
  article: ArticleRecord
  attempt: ReadingAttempt
}

export async function openOrCreateActiveAttempt(
  repositories: LocalRepositories,
  articleId: string,
  dependencies: ReadingCommandDependencies = {},
): Promise<OpenArticleResult> {
  const now = dependencies.now ?? (() => new Date())
  const randomUUID = dependencies.randomUUID ?? getRandomUUID

  return repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const article = await scope.articles.get(articleId)
    if (!article) {
      throw new ArticleNotFoundError(articleId)
    }

    const timestamp = now().toISOString()
    const activeAttempt = await scope.attempts.getActiveByArticle(articleId)
    const currentSentenceId = resolveCurrentSentenceId(article, activeAttempt?.currentSentenceId)
    const attempt: ReadingAttempt = activeAttempt
      ? {
          ...activeAttempt,
          currentSentenceId,
          lastOpenedAt: timestamp,
        }
      : {
          id: randomUUID(),
          articleId,
          currentSentenceId,
          furthestSentenceOrdinal: 0,
          activeDurationSec: 0,
          status: 'active',
          startedAt: timestamp,
          lastOpenedAt: timestamp,
        }

    await scope.attempts.put(attempt)
    return { article, attempt }
  })
}

export async function flushReadingPosition(
  repositories: LocalRepositories,
  options: {
    articleId: string
    attemptId: string
    currentSentenceId: string
    activeDurationSec: number
    now?: () => Date
  },
): Promise<ReadingAttempt> {
  const now = options.now ?? (() => new Date())

  return repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const [article, latestAttempt] = await Promise.all([
      scope.articles.get(options.articleId),
      scope.attempts.get(options.attemptId),
    ])
    if (!article) {
      throw new ArticleNotFoundError(options.articleId)
    }
    if (!latestAttempt
      || latestAttempt.articleId !== article.id
      || latestAttempt.status !== 'active') {
      throw new ReadingAttemptUnavailableError(options.attemptId)
    }

    const currentSentenceId = resolveCurrentSentenceId(article, options.currentSentenceId)
    const currentOrdinal = resolveSentenceOrdinal(article, currentSentenceId)
    const activeDurationSec = Number.isFinite(options.activeDurationSec)
      ? Math.max(0, Math.floor(options.activeDurationSec))
      : 0
    const nextAttempt: ReadingAttempt = {
      ...latestAttempt,
      currentSentenceId,
      furthestSentenceOrdinal: Math.max(
        latestAttempt.furthestSentenceOrdinal,
        currentOrdinal,
      ),
      activeDurationSec: Math.max(latestAttempt.activeDurationSec, activeDurationSec),
      lastOpenedAt: now().toISOString(),
    }

    await scope.attempts.put(nextAttempt)
    return nextAttempt
  })
}

function resolveCurrentSentenceId(article: ArticleRecord, candidate?: string): string {
  if (candidate && article.sentences.some(sentence => sentence.id === candidate)) {
    return candidate
  }
  const firstSentence = [...article.sentences].sort((left, right) => left.order - right.order)[0]
  if (!firstSentence) {
    throw new ArticleNotFoundError(article.id)
  }
  return firstSentence.id
}

function resolveSentenceOrdinal(article: ArticleRecord, sentenceId: string): number {
  const sorted = [...article.sentences].sort((left, right) => left.order - right.order)
  return Math.max(0, sorted.findIndex(sentence => sentence.id === sentenceId))
}

function getRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('This platform cannot create a secure reading attempt id.')
  }
  return globalThis.crypto.randomUUID()
}
