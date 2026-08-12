import { readingProgressArticleIsRetired } from '@/features/reader/progressJournal'
import type { PreferencesStore } from '@/platform/contracts'

export const articleDeletionIntentPrefix = 'article-deletion-intent:v1:'

export interface ArticleDeletionIntent {
  schemaVersion: 1
  kind: 'article-deletion-intent'
  articleId: string
  deleteContextlessTerms: boolean
}

export interface ArticleDeletionFence {
  deletionPending: boolean
  progressRetired: boolean
}

export async function getArticleDeletionFence(
  preferences: PreferencesStore,
  articleId: string,
): Promise<ArticleDeletionFence> {
  if (!isBoundedArticleIdentifier(articleId)) {
    throw new Error('Article deletion fence requires a valid article identifier.')
  }

  const [intent, progressRetired] = await Promise.all([
    preferences.get<unknown>(articleDeletionIntentKey(articleId)),
    readingProgressArticleIsRetired(preferences, articleId),
  ])
  return {
    deletionPending: isArticleDeletionIntent(intent)
      && intent.articleId === articleId,
    progressRetired,
  }
}

export function articleDeletionIntentKey(articleId: string): string {
  return `${articleDeletionIntentPrefix}${encodeURIComponent(articleId)}`
}

export function isArticleDeletionIntent(value: unknown): value is ArticleDeletionIntent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && record.kind === 'article-deletion-intent'
    && isBoundedArticleIdentifier(record.articleId)
    && typeof record.deleteContextlessTerms === 'boolean'
}

export function isBoundedArticleIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
}
