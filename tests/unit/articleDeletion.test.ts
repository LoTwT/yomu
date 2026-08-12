import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import { getArticleDeletionFence } from '@/features/article/articleDeletionFence'
import { startBundledSampleReading } from '@/features/article/startBundledSampleReading'
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
  it('re-adds a successfully deleted bundled sample as a fresh journal-safe incarnation', async () => {
    const repositories = createMemoryLocalRepositories()
    const platform = createFakePlatformServices({ repositories })
    const first = await startBundledSampleReading(platform.services, {
      now: () => new Date('2026-08-12T08:00:00.000Z'),
      randomUUID: () => 'sample-first-attempt',
    })
    const staleDraft = createJournal(first.article.id, first.attempt.id)
    await storeReadingProgressJournal(platform.preferences, staleDraft)

    await expect(deleteArticleFromDevice(platform.services, {
      articleId: first.article.id,
      deleteContextlessTerms: false,
    })).resolves.toMatchObject({ kind: 'deleted' })

    const readded = await startBundledSampleReading(platform.services, {
      now: () => new Date('2026-08-12T09:00:00.000Z'),
      randomUUID: () => 'sample-readded-attempt',
    })

    expect.soft(readded.article.id).not.toBe(first.article.id)
    await expect.soft(storeReadingProgressJournal(
      platform.preferences,
      createJournal(readded.article.id, readded.attempt.id),
    )).resolves.toMatchObject({
      articleId: readded.article.id,
      attemptId: readded.attempt.id,
    })
    await expect(storeReadingProgressJournal(platform.preferences, {
      ...staleDraft,
      sequence: 2,
    })).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
  })

  it('does not let stale deletion recovery remove a re-added bundled sample', async () => {
    const repositories = createMemoryLocalRepositories()
    const platform = createFakePlatformServices({ repositories })
    const first = await startBundledSampleReading(platform.services, {
      now: () => new Date('2026-08-12T08:00:00.000Z'),
      randomUUID: () => 'sample-cleanup-first-attempt',
    })
    const preferences = failNextCompareAndRemoveForKey(
      platform.preferences,
      deletionIntentKey(first.article.id),
    )
    const services = { ...platform.services, preferences }

    await expect(deleteArticleFromDevice(services, {
      articleId: first.article.id,
      deleteContextlessTerms: false,
    })).rejects.toMatchObject({
      name: 'ArticleDeletionCleanupPendingError',
      articleId: first.article.id,
    })
    expect(await repositories.articles.get(first.article.id)).toBeNull()
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toHaveLength(1)

    const readded = await startBundledSampleReading(platform.services, {
      now: () => new Date('2026-08-12T09:00:00.000Z'),
      randomUUID: () => 'sample-cleanup-readded-attempt',
    })

    await expect(recoverPendingArticleDeletions(platform.services)).resolves.toEqual([
      first.article.id,
    ])
    expect(await repositories.articles.get(readded.article.id)).toEqual(readded.article)
    expect(await repositories.attempts.get(readded.attempt.id)).toEqual(readded.attempt)
    expect(await platform.preferences.listByPrefix(deletionIntentPrefix)).toEqual([])
  })

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

  it('rolls back a failed session-only deletion before another tab reopens the sample', async () => {
    const factory = new IDBFactory()
    const databaseName = 'article-deletion-session-only-cross-tab-rollback'
    const firstTab = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName,
      localStorage: null,
      migrateLegacy: false,
    })
    const secondTab = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName,
      localStorage: null,
      migrateLegacy: false,
    })
    try {
      const first = await startBundledSampleReading(firstTab.services, {
        now: () => new Date('2026-08-12T08:00:00.000Z'),
        randomUUID: () => 'session-cross-tab-attempt',
      })
      const firstDraft = createJournal(first.article.id, first.attempt.id)
      await storeReadingProgressJournal(firstTab.services.preferences, firstDraft)
      const repositoryFailure = new Error('session repository deletion failed')
      failNextArticleDeletionTransaction(
        firstTab.services.repositories,
        repositoryFailure,
      )

      const deletionError = await deleteArticleFromDevice(firstTab.services, {
        articleId: first.article.id,
        deleteContextlessTerms: false,
      }).catch((error: unknown) => error)

      expect.soft(deletionError).toMatchObject({
        name: 'ArticleDeletionPendingRetryError',
        articleId: first.article.id,
        progressRetired: false,
        automaticRetry: false,
      })
      expect.soft(await firstTab.services.repositories.articles.get(first.article.id))
        .toEqual(first.article)
      expect.soft(await firstTab.services.repositories.attempts.get(first.attempt.id))
        .toEqual(first.attempt)
      expect.soft(await firstTab.services.preferences.listByPrefix(deletionIntentPrefix))
        .toEqual([])
      expect.soft(await firstTab.services.preferences.listByPrefix(retiredArticlePrefix))
        .toEqual([])
      expect.soft(await getArticleDeletionFence(
        firstTab.services.preferences,
        first.article.id,
      )).toEqual({ deletionPending: false, progressRetired: false })
      await expect.soft(storeReadingProgressJournal(firstTab.services.preferences, {
        ...firstDraft,
        sequence: 2,
      })).resolves.toMatchObject({
        articleId: first.article.id,
        attemptId: first.attempt.id,
      })

      const reopened = await startBundledSampleReading(secondTab.services, {
        now: () => new Date('2026-08-12T09:00:00.000Z'),
        randomUUID: () => {
          throw new Error('the surviving incarnation and attempt must be reused')
        },
      })
      expect.soft(reopened).toMatchObject({
        articleCreated: false,
        attemptCreated: false,
        article: { id: first.article.id },
        attempt: { id: first.attempt.id, articleId: first.article.id },
      })

      expect.soft(await recoverPendingArticleDeletions(firstTab.services)).toEqual([])
      expect.soft(await secondTab.services.repositories.articles.get(reopened.article.id))
        .toEqual(reopened.article)
      expect(await secondTab.services.repositories.attempts.get(reopened.attempt.id))
        .toEqual(reopened.attempt)
    }
    finally {
      firstTab.services.repositories.close()
      secondTab.services.repositories.close()
    }
  })

  it('keeps a failed session rollback non-destructive and preserves both failure causes', async () => {
    const factory = new IDBFactory()
    const platform = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName: 'article-deletion-session-rollback-failure',
      localStorage: null,
      migrateLegacy: false,
    })
    const article = createReviewArticle('article-session-rollback-failure', 'Rollback failure')
    const attempt = createAttempt(article.id)
    try {
      await platform.services.repositories.articles.put(article)
      await platform.services.repositories.attempts.put(attempt)
      const draft = createJournal(article.id, attempt.id)
      await storeReadingProgressJournal(platform.services.preferences, draft)
      const repositoryFailure = new Error('repository delete failed before commit')
      const rollbackFailure = new Error('session intent rollback failed')
      failNextArticleDeletionTransaction(
        platform.services.repositories,
        repositoryFailure,
      )
      const preferences = failNextCompareAndRemoveForKey(
        platform.services.preferences,
        deletionIntentKey(article.id),
        rollbackFailure,
      )
      const services = { ...platform.services, preferences }

      const deletionError = await deleteArticleFromDevice(services, {
        articleId: article.id,
        deleteContextlessTerms: false,
      }).catch((error: unknown) => error)

      expect.soft(deletionError).toMatchObject({
        name: 'ArticleDeletionPendingRetryError',
        articleId: article.id,
        progressRetired: true,
        automaticRetry: false,
      })
      const cause = deletionError instanceof Error ? deletionError.cause : undefined
      expect.soft(cause).toBeInstanceOf(AggregateError)
      if (cause instanceof AggregateError) {
        expect.soft(cause.errors).toEqual([repositoryFailure, rollbackFailure])
      }
      expect.soft(await platform.services.repositories.articles.get(article.id)).toEqual(article)
      expect.soft(await platform.services.repositories.attempts.get(attempt.id)).toEqual(attempt)

      expect.soft(await recoverPendingArticleDeletions(services)).toEqual([])
      expect.soft(await getArticleDeletionFence(preferences, article.id))
        .toEqual({ deletionPending: false, progressRetired: false })
      expect.soft(await platform.services.repositories.articles.get(article.id)).toEqual(article)
      expect.soft(await platform.services.repositories.attempts.get(attempt.id)).toEqual(attempt)
      await expect.soft(storeReadingProgressJournal(preferences, {
        ...draft,
        sequence: 2,
      })).resolves.toMatchObject({ articleId: article.id, attemptId: attempt.id })

      await expect.soft(deleteArticleFromDevice(services, {
        articleId: article.id,
        deleteContextlessTerms: false,
      })).resolves.toMatchObject({ kind: 'deleted' })
      expect.soft(await platform.services.repositories.articles.get(article.id)).toBeNull()
      expect.soft(await platform.services.repositories.attempts.get(attempt.id)).toBeNull()
      expect.soft(await getArticleDeletionFence(preferences, article.id))
        .toEqual({ deletionPending: false, progressRetired: true })
      await expect(storeReadingProgressJournal(preferences, {
        ...draft,
        sequence: 3,
      })).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
    }
    finally {
      platform.services.repositories.close()
    }
  })

  it('does not let a failed concurrent session deletion remove a successful permanent fence', async () => {
    const factory = new IDBFactory()
    const platform = await createWebPlatformServices({
      indexedDbFactory: factory,
      databaseName: 'article-deletion-session-concurrent-delete',
      localStorage: null,
      migrateLegacy: false,
    })
    const article = createReviewArticle('article-session-concurrent-delete', 'Concurrent delete')
    const attempt = createAttempt(article.id)
    try {
      await platform.services.repositories.articles.put(article)
      await platform.services.repositories.attempts.put(attempt)
      const draft = createJournal(article.id, attempt.id)
      await storeReadingProgressJournal(platform.services.preferences, draft)
      const repositories = platform.services.repositories
      const originalTransaction = repositories.transaction.bind(repositories)
      let articleDeletionTransactionCount = 0
      let reportFirstDeletionStarted!: () => void
      let releaseFirstDeletion!: () => void
      const firstDeletionStarted = new Promise<void>((resolve) => {
        reportFirstDeletionStarted = resolve
      })
      const firstDeletionGate = new Promise<void>((resolve) => {
        releaseFirstDeletion = resolve
      })
      repositories.transaction = async (...args) => {
        if (isArticleDeletionTransaction(args[0], args[1])) {
          articleDeletionTransactionCount += 1
          if (articleDeletionTransactionCount === 1) {
            reportFirstDeletionStarted()
            await firstDeletionGate
            throw new Error('first concurrent delete failed')
          }
        }
        return originalTransaction(...args)
      }

      const firstDeletion = deleteArticleFromDevice(platform.services, {
        articleId: article.id,
        deleteContextlessTerms: false,
      })
      await firstDeletionStarted
      const secondDeletion = deleteArticleFromDevice(platform.services, {
        articleId: article.id,
        deleteContextlessTerms: false,
      })
      await Promise.race([
        secondDeletion.then(() => undefined, () => undefined),
        waitForMacrotask(),
      ])
      expect.soft(articleDeletionTransactionCount).toBe(1)
      releaseFirstDeletion()

      const [firstOutcome, secondOutcome] = await Promise.allSettled([
        firstDeletion,
        secondDeletion,
      ])
      expect.soft(firstOutcome).toMatchObject({
        status: 'rejected',
        reason: {
          name: 'ArticleDeletionPendingRetryError',
          articleId: article.id,
        },
      })
      expect.soft(secondOutcome).toMatchObject({
        status: 'fulfilled',
        value: { kind: 'deleted' },
      })
      expect.soft(await repositories.articles.get(article.id)).toBeNull()
      expect.soft(await repositories.attempts.get(attempt.id)).toBeNull()
      expect.soft(await getArticleDeletionFence(platform.services.preferences, article.id))
        .toEqual({ deletionPending: false, progressRetired: true })
      await expect(storeReadingProgressJournal(platform.services.preferences, {
        ...draft,
        sequence: 2,
      })).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
    }
    finally {
      platform.services.repositories.close()
    }
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

function failNextArticleDeletionTransaction(
  repositories: LocalRepositories,
  failure: Error,
): void {
  const originalTransaction = repositories.transaction.bind(repositories)
  let shouldFail = true
  repositories.transaction = async (...args) => {
    if (shouldFail && isArticleDeletionTransaction(args[0], args[1])) {
      shouldFail = false
      throw failure
    }
    return originalTransaction(...args)
  }
}

function isArticleDeletionTransaction(
  stores: readonly string[],
  mode: string,
): boolean {
  return mode === 'readwrite'
    && stores.includes('articles')
    && stores.includes('attempts')
    && stores.includes('vocabularyTerms')
    && stores.includes('vocabularyContexts')
}

function waitForMacrotask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
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

function failNextCompareAndRemoveForKey(
  base: PreferencesStore,
  failingKey: string,
  failure = new Error('intent compare-and-remove failed'),
): PreferencesStore {
  let shouldFail = true
  return {
    persistence: base.persistence,
    get: base.get.bind(base),
    getImmediately: base.getImmediately.bind(base),
    listByPrefix: base.listByPrefix.bind(base),
    set: base.set.bind(base),
    update: base.update.bind(base),
    updateImmediately: base.updateImmediately.bind(base),
    async compareAndRemove(key, expected) {
      if (shouldFail && key === failingKey) {
        shouldFail = false
        throw failure
      }
      return base.compareAndRemove(key, expected)
    },
    remove: base.remove.bind(base),
    clear: base.clear.bind(base),
  }
}
