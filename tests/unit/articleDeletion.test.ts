import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import {
  deleteArticleFromDevice,
  recoverPendingArticleDeletions,
} from '@/features/library/articleDeletion'
import {
  createReadingProgressJournal,
  ReadingProgressJournalArticleRetiredError,
  storeReadingProgressJournal,
} from '@/features/reader/progressJournal'
import type { PreferencesStore } from '@/platform/contracts'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import { createWebPlatformServices } from '@/platform/web/createWebPlatformServices'
import { createReviewArticle } from './readingReviewTestFixtures'

const deletionIntentPrefix = 'article-deletion-intent:v1:'
const retiredArticlePrefix = 'reader-progress-journal-retired-article:v1:'

describe('article deletion orchestration', () => {
  it('deletes canonical and legacy data while permanently fencing late journals', async () => {
    const article = createReviewArticle('article-delete-device', 'Delete from device')
    const attempt = createAttempt(article.id)
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [attempt],
    })
    const platform = createFakePlatformServices({ repositories })
    const deletedArticleIds: string[] = []
    platform.articleEvents.subscribeDeleted(event => deletedArticleIds.push(event.articleId))
    const draft = createJournal(article.id, attempt.id)
    await storeReadingProgressJournal(platform.preferences, draft)

    const outcome = await deleteArticleFromDevice(platform.services, {
      articleId: article.id,
      deleteContextlessTerms: false,
    })

    expect(outcome).toMatchObject({
      kind: 'deleted',
      result: { deletedAttemptCount: 1 },
    })
    expect(await repositories.articles.get(article.id)).toBeNull()
    expect(await repositories.attempts.get(attempt.id)).toBeNull()
    expect(platform.legacyImportedContent.deletedArticleIds).toEqual([article.id])
    expect(await platform.preferences.listByPrefix(
      `reader-progress-journal:v4:${encodeURIComponent(article.id)}:`,
    )).toEqual([])
    expect(await platform.preferences.listByPrefix('article-deletion-intent:v1:')).toEqual([])
    expect(await platform.preferences.listByPrefix(
      'reader-progress-journal-retired-article:v1:',
    )).toHaveLength(1)
    expect(deletedArticleIds).toEqual([article.id])
    await expect(storeReadingProgressJournal(platform.preferences, {
      ...draft,
      sequence: 2,
    })).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
  })

  it('durably resumes a confirmed deletion after the repository transaction fails', async () => {
    const article = createReviewArticle('article-delete-recovery', 'Recover deletion')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const deletedArticleIds: string[] = []
    platform.articleEvents.subscribeDeleted(event => deletedArticleIds.push(event.articleId))
    const originalTransaction = repositories.transaction.bind(repositories)
    let failNextDelete = true
    repositories.transaction = async (...args) => {
      if (failNextDelete && args[1] === 'readwrite' && args[0].includes('articles')) {
        failNextDelete = false
        throw new Error('transient delete failure')
      }
      return originalTransaction(...args)
    }

    const deletion = deleteArticleFromDevice(platform.services, {
      articleId: article.id,
      deleteContextlessTerms: false,
    })
    await expect(deletion).rejects.toMatchObject({
      name: 'ArticleDeletionPendingRetryError',
      articleId: article.id,
      progressRetired: true,
      automaticRetry: false,
    })
    expect(await repositories.articles.get(article.id)).not.toBeNull()
    expect(deletedArticleIds).toEqual([])
    expect(await platform.preferences.listByPrefix('article-deletion-intent:v1:'))
      .toHaveLength(1)
    await expect(storeReadingProgressJournal(
      platform.preferences,
      createJournal(article.id, 'attempt-delete-recovery'),
    )).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)

    await expect(recoverPendingArticleDeletions(platform.services)).resolves.toEqual([
      article.id,
    ])
    expect(await repositories.articles.get(article.id)).toBeNull()
    expect(deletedArticleIds).toEqual([article.id])
    expect(await platform.preferences.listByPrefix('article-deletion-intent:v1:')).toEqual([])
  })

  it('does not promise restart recovery when durable articles use session-only preferences', async () => {
    const factory = new IDBFactory()
    const databaseName = 'article-deletion-session-only-intent'
    const firstStartup = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName,
      localStorage: null,
      migrateLegacy: false,
    })
    const article = createReviewArticle('article-session-intent', 'Session-only delete intent')
    await firstStartup.services.repositories.articles.put(article)
    const repositories = firstStartup.services.repositories
    const originalTransaction = repositories.transaction.bind(repositories)
    let failNextDelete = true
    repositories.transaction = async (...args) => {
      if (failNextDelete && args[1] === 'readwrite' && args[0].includes('articles')) {
        failNextDelete = false
        throw new Error('transient delete failure')
      }
      return originalTransaction(...args)
    }

    await expect(deleteArticleFromDevice(firstStartup.services, {
      articleId: article.id,
      deleteContextlessTerms: false,
    })).rejects.toMatchObject({
      name: 'ArticleDeletionPendingRetryError',
      progressRetired: true,
      automaticRetry: false,
    })
    firstStartup.services.repositories.close()

    const nextStartup = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName,
      localStorage: null,
      migrateLegacy: false,
    })
    await expect(recoverPendingArticleDeletions(nextStartup.services)).resolves.toEqual([])
    expect(await nextStartup.services.repositories.articles.get(article.id)).not.toBeNull()
    nextStartup.services.repositories.close()
  })

  it('retries from the durable intent when writing the retirement marker fails', async () => {
    const article = createReviewArticle('article-marker-recovery', 'Recover marker write')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const preferences = failNextUpdateForPrefix(
      platform.preferences,
      retiredArticlePrefix,
    )
    const services = { ...platform.services, preferences }

    await expect(deleteArticleFromDevice(services, {
      articleId: article.id,
      deleteContextlessTerms: false,
    })).rejects.toMatchObject({
      name: 'ArticleDeletionPendingRetryError',
      articleId: article.id,
      progressRetired: false,
      automaticRetry: false,
    })
    expect(await repositories.articles.get(article.id)).not.toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toHaveLength(1)
    expect(await platform.preferences.listByPrefix(retiredArticlePrefix)).toEqual([])

    await expect(recoverPendingArticleDeletions(services)).resolves.toEqual([article.id])
    expect(await repositories.articles.get(article.id)).toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toEqual([])
    expect(await platform.preferences.listByPrefix(retiredArticlePrefix)).toHaveLength(1)
  })

  it('ignores corrupt bounded identifiers while completing a valid intent', async () => {
    const article = createReviewArticle('article-valid-intent', 'Valid recovery intent')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const whitespaceId = '   '
    const overlongId = 'x'.repeat(513)
    await platform.preferences.set(
      deletionIntentKey(whitespaceId),
      createDeletionIntent(whitespaceId),
    )
    await platform.preferences.set(
      deletionIntentKey(overlongId),
      createDeletionIntent(overlongId),
    )
    await platform.preferences.set(
      deletionIntentKey(article.id),
      createDeletionIntent(article.id),
    )

    await expect(recoverPendingArticleDeletions(platform.services)).resolves.toEqual([
      article.id,
    ])
    expect(await repositories.articles.get(article.id)).toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toEqual([
      {
        key: deletionIntentKey(whitespaceId),
        value: createDeletionIntent(whitespaceId),
      },
      {
        key: deletionIntentKey(overlongId),
        value: createDeletionIntent(overlongId),
      },
    ])
  })

  it('overwrites a mismatched valid intent instead of deleting the wrong article', async () => {
    const requested = createReviewArticle('article-requested-delete', 'Requested deletion')
    const unrelated = createReviewArticle('article-unrelated-delete', 'Unrelated article')
    const repositories = createMemoryLocalRepositories({ articles: [requested, unrelated] })
    const platform = createFakePlatformServices({ repositories })
    await platform.preferences.set(
      deletionIntentKey(requested.id),
      createDeletionIntent(unrelated.id),
    )

    await expect(deleteArticleFromDevice(platform.services, {
      articleId: requested.id,
      deleteContextlessTerms: false,
    })).resolves.toMatchObject({ kind: 'deleted' })

    expect(await repositories.articles.get(requested.id)).toBeNull()
    expect(await repositories.articles.get(unrelated.id)).not.toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toEqual([])
  })

  it('reports a terminal article while cleanup fails and leaves its intent retryable', async () => {
    const article = createReviewArticle('article-terminal-cleanup', 'Terminal cleanup retry')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const journalKey = `reader-progress-journal:v4:${encodeURIComponent(article.id)}:writer-fault:1`
    await platform.preferences.set(
      deletionIntentKey(article.id),
      createDeletionIntent(article.id),
    )
    await platform.preferences.set(journalKey, { articleId: article.id })
    const preferences = failRemoveForKey(platform.preferences, journalKey)
    const services = { ...platform.services, preferences }

    await expect(recoverPendingArticleDeletions(services)).resolves.toEqual([article.id])
    expect(await repositories.articles.get(article.id)).toBeNull()
    expect(await platform.preferences.get(journalKey)).not.toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toHaveLength(1)

    await expect(recoverPendingArticleDeletions(platform.services)).resolves.toEqual([
      article.id,
    ])
    expect(await platform.preferences.get(journalKey)).toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toEqual([])
  })
})

function createAttempt(articleId: string): ReadingAttempt {
  return {
    id: `attempt:${articleId}`,
    articleId,
    currentSentenceId: `${articleId}:sentence-1`,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 12,
    status: 'active',
    startedAt: '2026-08-11T00:00:00.000Z',
    lastOpenedAt: '2026-08-11T00:00:00.000Z',
  }
}

function createJournal(articleId: string, attemptId: string) {
  return createReadingProgressJournal({
    articleId,
    attemptId,
    baseAttemptRevision: 0,
    cursorMutation: true,
    currentSentenceId: `${articleId}:sentence-1`,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 12,
  }, {
    writerId: `writer:${articleId}`,
    sequence: 1,
    writtenAt: '2026-08-11T00:00:00.000Z',
  })
}

function deletionIntentKey(articleId: string): string {
  return `${deletionIntentPrefix}${encodeURIComponent(articleId)}`
}

function createDeletionIntent(articleId: string) {
  return {
    schemaVersion: 1 as const,
    kind: 'article-deletion-intent' as const,
    articleId,
    deleteContextlessTerms: false,
  }
}

function failNextUpdateForPrefix(
  base: PreferencesStore,
  failingPrefix: string,
): PreferencesStore {
  let shouldFail = true
  return {
    persistence: base.persistence,
    get: base.get.bind(base),
    getImmediately: base.getImmediately.bind(base),
    listByPrefix: base.listByPrefix.bind(base),
    set: base.set.bind(base),
    async update(key, updater) {
      if (shouldFail && key.startsWith(failingPrefix)) {
        shouldFail = false
        throw new Error('marker update failed')
      }
      return base.update(key, updater)
    },
    updateImmediately: base.updateImmediately.bind(base),
    compareAndRemove: base.compareAndRemove.bind(base),
    remove: base.remove.bind(base),
    clear: base.clear.bind(base),
  }
}

function failRemoveForKey(
  base: PreferencesStore,
  failingKey: string,
): PreferencesStore {
  return {
    persistence: base.persistence,
    get: base.get.bind(base),
    getImmediately: base.getImmediately.bind(base),
    listByPrefix: base.listByPrefix.bind(base),
    set: base.set.bind(base),
    update: base.update.bind(base),
    updateImmediately: base.updateImmediately.bind(base),
    compareAndRemove: base.compareAndRemove.bind(base),
    async remove(key) {
      if (key === failingKey) {
        throw new Error('journal remove failed')
      }
      await base.remove(key)
    },
    clear: base.clear.bind(base),
  }
}
