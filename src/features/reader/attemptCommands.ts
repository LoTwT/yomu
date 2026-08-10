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

export interface CompleteReadingAttemptOptions {
  articleId: string
  attemptId: string
  currentSentenceId: string
  furthestSentenceOrdinal: number
  activeDurationSec: number
  now?: () => Date
}

export interface CompleteReadingAttemptResult {
  attempt: ReadingAttempt
  completedNow: boolean
}

export async function openOrCreateActiveAttempt(
  repositories: LocalRepositories,
  articleId: string,
  dependencies: ReadingCommandDependencies = {},
): Promise<OpenArticleResult> {
  return openReadingAttemptRecord(repositories, articleId, dependencies, true)
}

export async function openReadingAttempt(
  repositories: LocalRepositories,
  articleId: string,
  dependencies: ReadingCommandDependencies = {},
): Promise<OpenArticleResult> {
  return openReadingAttemptRecord(repositories, articleId, dependencies, false)
}

async function openReadingAttemptRecord(
  repositories: LocalRepositories,
  articleId: string,
  dependencies: ReadingCommandDependencies,
  createAfterCompletion: boolean,
): Promise<OpenArticleResult> {
  const now = dependencies.now ?? (() => new Date())
  const randomUUID = dependencies.randomUUID ?? getRandomUUID

  return repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const article = await scope.articles.get(articleId)
    if (!article) {
      throw new ArticleNotFoundError(articleId)
    }

    const activeAttempt = await scope.attempts.getActiveByArticle(articleId)
    if (activeAttempt) {
      const attempt: ReadingAttempt = {
        ...activeAttempt,
        currentSentenceId: resolveCurrentSentenceId(article, activeAttempt.currentSentenceId),
        lastOpenedAt: now().toISOString(),
      }
      await scope.attempts.put(attempt)
      return { article, attempt }
    }

    if (!createAfterCompletion) {
      const latestCompletedAttempt = (await scope.attempts.listByArticle(articleId))
        .filter((candidate): candidate is ReadingAttempt & { status: 'completed' } =>
          candidate.status === 'completed')
        .sort(compareCompletedAttemptsNewestFirst)[0]
      if (latestCompletedAttempt) {
        return { article, attempt: latestCompletedAttempt }
      }
    }

    const timestamp = now().toISOString()
    const attempt: ReadingAttempt = {
      id: randomUUID(),
      articleId,
      currentSentenceId: resolveCurrentSentenceId(article),
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

export async function completeReadingAttempt(
  repositories: LocalRepositories,
  options: CompleteReadingAttemptOptions,
): Promise<CompleteReadingAttemptResult> {
  const now = options.now ?? (() => new Date())

  return repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
    const [article, latestAttempt] = await Promise.all([
      scope.articles.get(options.articleId),
      scope.attempts.get(options.attemptId),
    ])
    if (!article) {
      throw new ArticleNotFoundError(options.articleId)
    }
    if (!latestAttempt || latestAttempt.articleId !== article.id) {
      throw new ReadingAttemptUnavailableError(options.attemptId)
    }
    switch (latestAttempt.status) {
      case 'completed':
        return { attempt: latestAttempt, completedNow: false }
      case 'active':
        break
      default:
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
    const timestamp = now().toISOString()
    const nextAttempt: ReadingAttempt = {
      ...latestAttempt,
      currentSentenceId,
      furthestSentenceOrdinal: Math.max(
        latestAttempt.furthestSentenceOrdinal,
        requestedFurthestSentenceOrdinal,
      ),
      activeDurationSec: Math.max(latestAttempt.activeDurationSec, activeDurationSec),
      progressRevision: (latestAttempt.progressRevision ?? 0)
        + (currentSentenceId === latestAttempt.currentSentenceId ? 0 : 1),
      status: 'completed',
      lastOpenedAt: timestamp,
      completedAt: timestamp,
    }

    await scope.attempts.put(nextAttempt)
    return { attempt: nextAttempt, completedNow: true }
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

function compareCompletedAttemptsNewestFirst(
  left: ReadingAttempt,
  right: ReadingAttempt,
): number {
  const leftTimestamp = Date.parse(left.completedAt ?? left.lastOpenedAt)
  const rightTimestamp = Date.parse(right.completedAt ?? right.lastOpenedAt)
  return rightTimestamp - leftTimestamp || right.id.localeCompare(left.id)
}

function getRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('This platform cannot create a secure reading attempt id.')
  }
  return globalThis.crypto.randomUUID()
}
