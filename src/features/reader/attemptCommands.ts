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

export interface FlushReadingPositionResult {
  attempt: ReadingAttempt
  cursorApplied: boolean
  journalSettled: boolean
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
          progressRevision: 0,
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
    baseAttemptRevision: number
    cursorMutation: boolean
    currentSentenceId: string
    furthestSentenceOrdinal: number
    activeDurationSec: number
    journalOperationId?: string
    journalEpochId?: string
    journalGeneration?: number
    now?: () => Date
  },
): Promise<FlushReadingPositionResult> {
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
    const requestedFurthestSentenceOrdinal = Number.isSafeInteger(
      options.furthestSentenceOrdinal,
    )
      ? Math.max(0, options.furthestSentenceOrdinal, currentOrdinal)
      : currentOrdinal
    const activeDurationSec = Number.isFinite(options.activeDurationSec)
      ? Math.max(0, Math.floor(options.activeDurationSec))
      : 0
    const latestRevision = latestAttempt.progressRevision ?? 0
    const hasJournalGeneration = typeof options.journalEpochId === 'string'
      && Number.isSafeInteger(options.journalGeneration)
      && (options.journalGeneration ?? -1) >= 0
    const sameJournalEpoch = hasJournalGeneration
      && latestAttempt.progressJournalEpochId === options.journalEpochId
    const journalIsNewer = hasJournalGeneration && (
      (sameJournalEpoch
        && (options.journalGeneration ?? 0)
          > (latestAttempt.progressJournalGeneration ?? -1))
      || (!sameJournalEpoch && options.baseAttemptRevision === latestRevision)
    )
    const journalAlreadyCovered = hasJournalGeneration
      && sameJournalEpoch
      && (latestAttempt.progressJournalGeneration ?? -1)
        >= (options.journalGeneration ?? 0)
    const journalRejectedAsStale = hasJournalGeneration
      && !sameJournalEpoch
      && options.baseAttemptRevision !== latestRevision
    const cursorApplied = options.cursorMutation && (
      journalIsNewer
      || (!hasJournalGeneration && options.baseAttemptRevision === latestRevision)
    )
    const cursorChanged = cursorApplied
      && currentSentenceId !== latestAttempt.currentSentenceId
    const furthestSentenceOrdinal = Math.max(
      latestAttempt.furthestSentenceOrdinal,
      requestedFurthestSentenceOrdinal,
    )
    const mergedActiveDurationSec = Math.max(
      latestAttempt.activeDurationSec,
      activeDurationSec,
    )
    const metricsChanged = furthestSentenceOrdinal !== latestAttempt.furthestSentenceOrdinal
      || mergedActiveDurationSec !== latestAttempt.activeDurationSec
    if (!cursorApplied && !journalIsNewer && !metricsChanged) {
      return {
        attempt: latestAttempt,
        cursorApplied: false,
        journalSettled: journalAlreadyCovered || journalRejectedAsStale,
      }
    }
    const timestamp = now().toISOString()
    const nextAttempt: ReadingAttempt = {
      ...latestAttempt,
      currentSentenceId: cursorApplied
        ? currentSentenceId
        : latestAttempt.currentSentenceId,
      furthestSentenceOrdinal,
      activeDurationSec: mergedActiveDurationSec,
      progressRevision: latestRevision + (cursorChanged ? 1 : 0),
      ...(options.journalOperationId && (cursorApplied || journalIsNewer)
        ? { progressJournalId: options.journalOperationId }
        : {}),
      ...(journalIsNewer
        ? {
            progressJournalEpochId: options.journalEpochId,
            progressJournalGeneration: options.journalGeneration,
          }
        : {}),
      lastOpenedAt: timestamp,
    }

    await scope.attempts.put(nextAttempt)
    return {
      attempt: nextAttempt,
      cursorApplied,
      journalSettled: journalIsNewer
        || journalAlreadyCovered
        || journalRejectedAsStale
        || (!hasJournalGeneration && cursorApplied),
    }
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
