import type { DeleteArticleResult } from './articleCommands'
import {
  ArticleManagementNotFoundError,
  deleteArticle,
} from './articleCommands'
import {
  clearRetiredReadingProgressJournals,
  markReadingProgressArticleRetired,
  retryRetiredReadingProgressJournalCleanup,
} from '@/features/reader/progressJournal'
import type { PlatformServices, PreferencesStore } from '@/platform/contracts'

const articleDeletionIntentPrefix = 'article-deletion-intent:v1:'

export interface ArticleDeletionInput {
  articleId: string
  deleteContextlessTerms: boolean
}

interface ArticleDeletionIntent extends ArticleDeletionInput {
  schemaVersion: 1
  kind: 'article-deletion-intent'
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

export async function deleteArticleFromDevice(
  services: PlatformServices,
  input: ArticleDeletionInput,
): Promise<DeleteArticleFromDeviceResult> {
  if (!isBoundedIdentifier(input.articleId)) {
    throw new Error('Article deletion requires a valid article identifier.')
  }
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
          continue
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
  }
  await retryRetiredReadingProgressJournalCleanup(services.preferences).catch(() => {})
  return [...recoveredArticleIds]
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

function articleDeletionIntentKey(articleId: string): string {
  return `${articleDeletionIntentPrefix}${encodeURIComponent(articleId)}`
}

function isArticleDeletionIntent(value: unknown): value is ArticleDeletionIntent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && record.kind === 'article-deletion-intent'
    && isBoundedIdentifier(record.articleId)
    && typeof record.deleteContextlessTerms === 'boolean'
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
}
