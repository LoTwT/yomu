import type { DeleteArticleResult } from './articleCommands'
import {
  ArticleManagementNotFoundError,
  deleteArticle,
} from './articleCommands'
import {
  clearRetiredReadingProgressJournals,
  markReadingProgressArticleRetired,
  readingProgressArticleIsRetired,
  rollbackReadingProgressArticleRetirement,
  retryRetiredReadingProgressJournalCleanup,
} from '@/features/reader/progressJournal'
import type { PlatformServices, PreferencesStore } from '@/platform/contracts'
import {
  articleDeletionIntentKey,
  articleDeletionIntentPrefix,
  isArticleDeletionIntent,
  isBoundedArticleIdentifier,
  type ArticleDeletionIntent,
} from '@/features/article/articleDeletionFence'

export interface ArticleDeletionInput {
  articleId: string
  deleteContextlessTerms: boolean
}

export class ArticleDeletionCleanupPendingError extends Error {
  constructor(
    readonly articleId: string,
    readonly result: DeleteArticleResult | null,
    readonly automaticRetry: boolean,
    options?: ErrorOptions,
  ) {
    super('The article was deleted, but related progress cleanup requires another attempt.', options)
    this.name = 'ArticleDeletionCleanupPendingError'
  }
}

export class ArticleDeletionPendingRetryError extends Error {
  constructor(
    readonly articleId: string,
    readonly progressRetired: boolean,
    readonly automaticRetry: boolean,
    options?: ErrorOptions,
  ) {
    super('Article deletion is incomplete and requires another attempt.', options)
    this.name = 'ArticleDeletionPendingRetryError'
  }
}

export type DeleteArticleFromDeviceResult =
  | { kind: 'deleted', result: DeleteArticleResult }
  | { kind: 'already-deleted' }

const articleDeletionQueues = new WeakMap<
  PreferencesStore,
  Map<string, Promise<void>>
>()

export async function deleteArticleFromDevice(
  services: PlatformServices,
  input: ArticleDeletionInput,
): Promise<DeleteArticleFromDeviceResult> {
  if (!isBoundedArticleIdentifier(input.articleId)) {
    throw new Error('Article deletion requires a valid article identifier.')
  }
  return serializeArticleDeletion(
    services.preferences,
    input.articleId,
    () => deleteArticleFromDeviceSerialized(services, input),
  )
}

async function deleteArticleFromDeviceSerialized(
  services: PlatformServices,
  input: ArticleDeletionInput,
): Promise<DeleteArticleFromDeviceResult> {
  await services.legacyImportedContent.deleteArticle(input.articleId)
  const intent = await storeArticleDeletionIntent(
    services.preferences,
    input,
  )
  try {
    await markReadingProgressArticleRetired(
      services.preferences,
      intent.articleId,
    )
  }
  catch (error) {
    if (usesSplitSessionDeletionState(services)) {
      const rollback = await rollbackSessionDeletionFence(
        services.preferences,
        intent,
      )
      throw new ArticleDeletionPendingRetryError(
        intent.articleId,
        rollback.progressRetired,
        false,
        { cause: combineDeletionAndRollbackErrors(error, rollback.error) },
      )
    }
    throw new ArticleDeletionPendingRetryError(
      intent.articleId,
      false,
      services.preferences.persistence === 'device',
      { cause: error },
    )
  }

  let result: DeleteArticleResult
  try {
    result = await deleteArticle(services.repositories, intent)
  }
  catch (error) {
    if (error instanceof ArticleManagementNotFoundError) {
      publishArticleDeleted(services, intent.articleId)
      try {
        await finalizeArticleDeletion(services.preferences, intent)
      }
      catch (cleanupError) {
        throw new ArticleDeletionCleanupPendingError(
          intent.articleId,
          null,
          services.preferences.persistence === 'device',
          { cause: cleanupError },
        )
      }
      return { kind: 'already-deleted' }
    }
    if (usesSplitSessionDeletionState(services)) {
      const rollback = await rollbackSessionDeletionFence(
        services.preferences,
        intent,
      )
      throw new ArticleDeletionPendingRetryError(
        intent.articleId,
        rollback.progressRetired,
        false,
        { cause: combineDeletionAndRollbackErrors(error, rollback.error) },
      )
    }
    throw new ArticleDeletionPendingRetryError(
      intent.articleId,
      true,
      services.preferences.persistence === 'device',
      { cause: error },
    )
  }

  publishArticleDeleted(services, intent.articleId)
  try {
    await finalizeArticleDeletion(services.preferences, intent)
  }
  catch (error) {
    throw new ArticleDeletionCleanupPendingError(
      intent.articleId,
      result,
      services.preferences.persistence === 'device',
      { cause: error },
    )
  }
  return { kind: 'deleted', result }
}

export async function recoverPendingArticleDeletions(
  services: Pick<PlatformServices, 'preferences' | 'repositories' | 'articleEvents'>,
): Promise<string[]> {
  const entries = await services.preferences.listByPrefix<unknown>(
    articleDeletionIntentPrefix,
  )
  const recoveredArticleIds = new Set<string>()
  for (const { key, value } of entries) {
    if (!isArticleDeletionIntent(value)
      || key !== articleDeletionIntentKey(value.articleId)) {
      continue
    }
    await serializeArticleDeletion(
      services.preferences,
      value.articleId,
      async () => {
        if (usesSplitSessionDeletionState(services)) {
          await recoverSessionDeletionFence(services, value)
          return
        }
        try {
          await markReadingProgressArticleRetired(
            services.preferences,
            value.articleId,
          )
          try {
            await deleteArticle(services.repositories, value)
          }
          catch (error) {
            if (!(error instanceof ArticleManagementNotFoundError)) {
              return
            }
          }
          publishArticleDeleted(services, value.articleId)
          recoveredArticleIds.add(value.articleId)
          try {
            await clearRetiredReadingProgressJournals(services.preferences, value.articleId)
            await services.preferences.compareAndRemove(key, value)
          }
          catch {}
        }
        catch {}
      },
    )
  }
  if (!usesSplitSessionDeletionState(services)) {
    await retryRetiredReadingProgressJournalCleanup(services.preferences).catch(() => {})
  }
  return [...recoveredArticleIds]
}

async function recoverSessionDeletionFence(
  services: Pick<PlatformServices, 'preferences' | 'repositories' | 'articleEvents'>,
  intent: ArticleDeletionIntent,
): Promise<void> {
  try {
    if (await services.repositories.articles.get(intent.articleId)) {
      await rollbackSessionDeletionFence(services.preferences, intent)
      return
    }
    publishArticleDeleted(services, intent.articleId)
    await finalizeArticleDeletion(services.preferences, intent)
  }
  catch {}
}

function publishArticleDeleted(
  services: Pick<PlatformServices, 'articleEvents'>,
  articleId: string,
): void {
  try {
    services.articleEvents?.publishDeleted({ articleId })
  }
  catch {}
}

async function finalizeArticleDeletion(
  preferences: PreferencesStore,
  intent: ArticleDeletionIntent,
): Promise<void> {
  await clearRetiredReadingProgressJournals(preferences, intent.articleId)
  await preferences.compareAndRemove(articleDeletionIntentKey(intent.articleId), intent)
}

async function storeArticleDeletionIntent(
  preferences: PreferencesStore,
  input: ArticleDeletionInput,
): Promise<ArticleDeletionIntent> {
  const next = await preferences.update<ArticleDeletionIntent>(
    articleDeletionIntentKey(input.articleId),
    (current) => {
      if (isArticleDeletionIntent(current) && current.articleId === input.articleId) {
        // The first durable confirmation owns the destructive option. Every
        // concurrent/retry path resumes that exact decision.
        return current
      }
      return {
        schemaVersion: 1,
        kind: 'article-deletion-intent',
        articleId: input.articleId,
        deleteContextlessTerms: input.deleteContextlessTerms,
      }
    },
  )
  if (!isArticleDeletionIntent(next) || next.articleId !== input.articleId) {
    throw new Error('Article deletion intent could not be stored.')
  }
  return next
}

async function rollbackSessionDeletionFence(
  preferences: PreferencesStore,
  intent: ArticleDeletionIntent,
): Promise<{ progressRetired: boolean, error?: unknown }> {
  try {
    const removedIntent = await preferences.compareAndRemove(
      articleDeletionIntentKey(intent.articleId),
      intent,
    )
    if (removedIntent) {
      await rollbackReadingProgressArticleRetirement(
        preferences,
        intent.articleId,
      )
    }
    return {
      progressRetired: await readingProgressArticleIsRetired(
        preferences,
        intent.articleId,
      ),
    }
  }
  catch (error) {
    return {
      progressRetired: await readingProgressArticleIsRetired(
        preferences,
        intent.articleId,
      ).catch(() => true),
      error,
    }
  }
}

function combineDeletionAndRollbackErrors(
  deletionError: unknown,
  rollbackError: unknown,
): unknown {
  return rollbackError === undefined
    ? deletionError
    : new AggregateError(
        [deletionError, rollbackError],
        'Article deletion failed and its session fence could not be fully rolled back.',
      )
}

function serializeArticleDeletion<T>(
  preferences: PreferencesStore,
  articleId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queues = articleDeletionQueues.get(preferences)
  if (!queues) {
    queues = new Map()
    articleDeletionQueues.set(preferences, queues)
  }
  const preceding = queues.get(articleId) ?? Promise.resolve()
  const result = preceding.then(operation, operation)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queues.set(articleId, tail)
  void tail.then(() => {
    if (queues?.get(articleId) === tail) {
      queues.delete(articleId)
    }
  })
  return result
}

function usesSplitSessionDeletionState(
  services: Pick<PlatformServices, 'preferences' | 'repositories'>,
): boolean {
  return services.preferences.persistence === 'session'
    && services.repositories.persistence === 'persistent'
}
