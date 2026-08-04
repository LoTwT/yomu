import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  defaultExportPreferences,
  type ArticleRecord,
  type ReadingAttempt,
  type VocabularyContext,
  type VocabularyTerm,
} from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import {
  DataConstraintError,
  DataReadonlyTransactionError,
  type LocalRepositories,
} from '@/data/repositories'
import { createIndexedDbLocalRepositories } from '@/platform/web/indexedDbLocalRepositories'

const now = '2026-08-01T00:00:00.000Z'

defineRepositoryConformance('memory repositories', async () =>
  createMemoryLocalRepositories())

defineRepositoryConformance('IndexedDB repositories', async () =>
  createIndexedDbLocalRepositories({
    factory: new IDBFactory(),
    databaseName: 'repository-conformance',
  }))

describe('IndexedDB corrupt-record isolation', () => {
  it('filters invalid get/list results and reports the ignored physical record', async () => {
    const factory = new IDBFactory()
    const databaseName = 'corrupt-record-isolation'
    const repositories = await createIndexedDbLocalRepositories({ factory, databaseName })
    const validArticle = createArticle('article-valid')
    await repositories.articles.put(validArticle)

    const database = await openDatabase(factory, databaseName)
    await rawPut(database, 'articles', {
      id: 'article-corrupt',
      schemaVersion: 1,
      title: null,
    })
    database.close()

    expect(await repositories.articles.get('article-corrupt')).toBeNull()
    expect(await repositories.articles.list()).toEqual([validArticle])
    expect(await repositories.articles.count()).toBe(1)

    const diagnostics = await repositories.diagnose()
    expect(diagnostics.counts.articles).toBe(1)
    expect(diagnostics.issues).toContainEqual(expect.objectContaining({
      store: 'articles',
      key: 'article-corrupt',
      code: 'invalid-record',
    }))

    const exported = await repositories.exportData(defaultExportPreferences, now)
    expect(exported.articles).toEqual([validArticle])
    repositories.close()
  })
})

type RepositoryFactory = () => Promise<LocalRepositories>

function defineRepositoryConformance(label: string, factory: RepositoryFactory): void {
  describe(label, () => {
    let repositories: LocalRepositories

    beforeEach(async () => {
      repositories = await factory()
    })

    afterEach(() => {
      repositories.close()
    })

    it('supports the same CRUD and indexed-query contract', async () => {
      const article = createArticle('article-a')
      const attempt = createAttempt(article.id)
      const term = createTerm()
      const context = createContext(article, term)

      await repositories.transaction(
        ['articles', 'attempts', 'vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.articles.put(article)
          await scope.attempts.put(attempt)
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(context)
        },
      )

      expect(await repositories.articles.get(article.id)).toEqual(article)
      expect(await repositories.attempts.listByArticle(article.id)).toEqual([attempt])
      expect(await repositories.attempts.getActiveByArticle(article.id)).toEqual(attempt)
      expect(await repositories.vocabularyTerms.getByNormalizedTerm(term.normalizedTerm)).toEqual(term)
      expect(await repositories.vocabularyContexts.listByTerm(term.id)).toEqual([context])
      expect(await repositories.vocabularyContexts.listByArticle(article.id)).toEqual([context])
    })

    it('rolls back failed writes and rejects undeclared or empty scopes', async () => {
      const article = createArticle('article-a')

      await expect(repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(article)
        throw new Error('abort transaction')
      })).rejects.toThrow('abort transaction')
      expect(await repositories.articles.get(article.id)).toBeNull()

      const articleAfterAbort = createArticle('article-after-abort')
      await repositories.transaction(['articles'], 'readwrite', scope =>
        scope.articles.put(articleAfterAbort))
      expect(await repositories.articles.get(articleAfterAbort.id)).toEqual(articleAfterAbort)

      await expect(repositories.transaction(['articles'], 'readonly', scope =>
        scope.attempts.list(),
      )).rejects.toBeInstanceOf(DataConstraintError)
      await expect(repositories.transaction([], 'readonly', async () => undefined))
        .rejects.toBeInstanceOf(DataConstraintError)
    })

    it('rolls back when an async transaction fails after its writes become idle', async () => {
      const article = createArticle('article-late-abort')
      const writeCompleted = createDeferred()
      const releaseTransaction = createDeferred()
      const transaction = repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(article)
        writeCompleted.resolve()
        await releaseTransaction.promise
        throw new Error('late abort transaction')
      })

      await writeCompleted.promise
      await waitForMacrotask()
      releaseTransaction.resolve()

      await expect(transaction).rejects.toThrow('late abort transaction')
      expect(await repositories.articles.list()).toEqual([])
    })

    it('keeps readonly transaction scopes active across asynchronous work', async () => {
      const article = createArticle('article-readonly-async')
      await repositories.articles.put(article)

      await expect(repositories.transaction(['articles'], 'readonly', async (scope) => {
        const articles = await scope.articles.list()
        await waitForMacrotask()
        const count = await scope.articles.count()
        return { articles, count }
      })).resolves.toEqual({ articles: [article], count: 1 })
    })

    it('preserves writes from concurrent read-write transactions', async () => {
      const firstArticle = createArticle('article-concurrent-a')
      const secondArticle = createArticle('article-concurrent-b')
      const firstWriteCompleted = createDeferred()
      const releaseFirstTransaction = createDeferred()

      const firstTransaction = repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(firstArticle)
        firstWriteCompleted.resolve()
        await releaseFirstTransaction.promise
      })
      await firstWriteCompleted.promise

      const secondTransaction = repositories.transaction(['articles'], 'readwrite', scope =>
        scope.articles.put(secondArticle))
      releaseFirstTransaction.resolve()

      await Promise.all([firstTransaction, secondTransaction])
      expect(await repositories.articles.list()).toEqual([firstArticle, secondArticle])
    })

    it('preserves a top-level write started during a read-write transaction', async () => {
      const transactionArticle = createArticle('article-transaction')
      const topLevelArticle = createArticle('article-top-level')
      const transactionWriteCompleted = createDeferred()
      const releaseTransaction = createDeferred()

      const transaction = repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(transactionArticle)
        transactionWriteCompleted.resolve()
        await releaseTransaction.promise
      })
      await transactionWriteCompleted.promise

      const topLevelWrite = repositories.articles.put(topLevelArticle)
      releaseTransaction.resolve()

      await Promise.all([transaction, topLevelWrite])
      expect(await repositories.articles.list()).toEqual([topLevelArticle, transactionArticle])
    })

    it('orders migration behind an in-flight write and commits data with its version', async () => {
      const transactionArticle = createArticle('article-before-migration')
      const migratedArticle = createArticle('article-migrated')
      const transactionWriteCompleted = createDeferred()
      const releaseTransaction = createDeferred()

      const transaction = repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(transactionArticle)
        transactionWriteCompleted.resolve()
        await releaseTransaction.promise
      })
      await transactionWriteCompleted.promise

      const migration = repositories.migration.apply({
        targetVersion: 2,
        articles: [migratedArticle],
        attempts: [],
        vocabularyTerms: [],
        vocabularyContexts: [],
      })
      releaseTransaction.resolve()

      await Promise.all([transaction, migration])
      expect(await repositories.articles.list()).toEqual([transactionArticle, migratedArticle])
      expect(await repositories.migration.getVersion()).toBe(2)
    })

    it('orders clearAll after an in-flight write and resets migration state', async () => {
      await repositories.migration.apply({
        targetVersion: 2,
        articles: [createArticle('article-before-clear')],
        attempts: [],
        vocabularyTerms: [],
        vocabularyContexts: [],
      })
      const transactionWriteCompleted = createDeferred()
      const releaseTransaction = createDeferred()
      const transaction = repositories.transaction(['articles'], 'readwrite', async (scope) => {
        await scope.articles.put(createArticle('article-during-clear'))
        transactionWriteCompleted.resolve()
        await releaseTransaction.promise
      })
      await transactionWriteCompleted.promise

      const clear = repositories.clearAll()
      releaseTransaction.resolve()

      await Promise.all([transaction, clear])
      expect(await repositories.articles.count()).toBe(0)
      expect(await repositories.migration.getVersion()).toBe(0)
    })

    it('rejects put, delete, and clear inside readonly transactions without changing data', async () => {
      const article = createArticle('article-a')
      await repositories.articles.put(article)

      const operations = [
        {
          name: 'put' as const,
          run: () => repositories.transaction(['articles'], 'readonly', scope =>
            scope.articles.put(createArticle('article-b'))),
        },
        {
          name: 'delete' as const,
          run: () => repositories.transaction(['articles'], 'readonly', scope =>
            scope.articles.delete(article.id)),
        },
        {
          name: 'clear' as const,
          run: () => repositories.transaction(['articles'], 'readonly', scope =>
            scope.articles.clear()),
        },
      ]

      for (const operation of operations) {
        await expect(operation.run()).rejects.toMatchObject({
          name: 'DataReadonlyTransactionError',
          store: 'articles',
          operation: operation.name,
        } satisfies Partial<DataReadonlyTransactionError>)
      }

      expect(await repositories.articles.list()).toEqual([article])
    })

    it('enforces repository-level natural-key constraints', async () => {
      await repositories.attempts.put(createAttempt('article-a', 'attempt-a'))
      await expect(repositories.attempts.put(createAttempt('article-a', 'attempt-b')))
        .rejects.toBeInstanceOf(DataConstraintError)

      await repositories.vocabularyTerms.put(createTerm('term-a'))
      await expect(repositories.vocabularyTerms.put(createTerm('term-b')))
        .rejects.toBeInstanceOf(DataConstraintError)

      const article = createArticle('article-a')
      const term = createTerm('term-context')
      const context = createContext(article, term)
      await repositories.vocabularyContexts.put(context)
      await expect(repositories.vocabularyContexts.put({
        ...context,
        id: 'context-duplicate',
      })).rejects.toBeInstanceOf(DataConstraintError)
    })

    it('rejects concurrent active attempts atomically and accepts a later write', async () => {
      const firstAttempt = createAttempt('article-concurrent', 'attempt-concurrent-a')
      const duplicateAttempt = createAttempt('article-concurrent', 'attempt-concurrent-b')

      await expect(repositories.transaction(['attempts'], 'readwrite', async (scope) => {
        await Promise.all([
          scope.attempts.put(firstAttempt),
          scope.attempts.put(duplicateAttempt),
        ])
      })).rejects.toBeInstanceOf(DataConstraintError)
      expect(await repositories.attempts.list()).toEqual([])

      const laterAttempt = createAttempt('article-after-conflict', 'attempt-after-conflict')
      await repositories.attempts.put(laterAttempt)
      expect(await repositories.attempts.list()).toEqual([laterAttempt])
    })

    it('keeps migration versions monotonic when different targets race', async () => {
      const highVersionArticle = createArticle('article-migration-v2')
      const lowVersionArticle = createArticle('article-migration-v1')

      await Promise.all([
        repositories.migration.apply({
          targetVersion: 2,
          articles: [highVersionArticle],
          attempts: [],
          vocabularyTerms: [],
          vocabularyContexts: [],
        }),
        repositories.migration.apply({
          targetVersion: 1,
          articles: [lowVersionArticle],
          attempts: [],
          vocabularyTerms: [],
          vocabularyContexts: [],
        }),
      ])

      expect(await repositories.migration.getVersion()).toBe(2)
      expect(await repositories.articles.list()).toEqual([highVersionArticle])
    })

    it('applies migrations once, exports deterministically, and clears all state', async () => {
      const articleB = createArticle('article-b')
      const articleA = createArticle('article-a')
      await repositories.migration.apply({
        targetVersion: 2,
        articles: [articleB, articleA],
        attempts: [],
        vocabularyTerms: [],
        vocabularyContexts: [],
      })
      await repositories.migration.apply({
        targetVersion: 2,
        articles: [createArticle('article-ignored')],
        attempts: [],
        vocabularyTerms: [],
        vocabularyContexts: [],
      })

      const exported = await repositories.exportData(defaultExportPreferences, now)
      expect(exported.articles.map(article => article.id)).toEqual(['article-a', 'article-b'])
      expect(await repositories.migration.getVersion()).toBe(2)

      await repositories.clearAll()
      expect(await repositories.articles.count()).toBe(0)
      expect(await repositories.migration.getVersion()).toBe(0)
    })
  })
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function waitForMacrotask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function createArticle(id: string): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `hash-${id}`,
    title: `Article ${id}`,
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: 'Pasted text' },
    rights: {
      status: 'user-provided-unknown',
      note: 'User-provided content.',
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    capabilities: {
      sentenceTranslation: 'none',
      sentenceIpa: 'none',
      tokenMeaning: 'complete',
    },
    sentences: [{
      id: `${id}:sentence-1`,
      order: 0,
      paragraphIndex: 0,
      textHash: `sentence-hash-${id}`,
      original: 'A reader opens an article.',
      tokens: [{
        id: `${id}:token-1`,
        text: 'reader',
        kind: 'word',
        meaning: 'a person who reads',
      }],
    }],
    factSources: [],
    wordCount: 6,
    estimatedReadTimeMinutes: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function createAttempt(articleId: string, id = 'attempt-a'): ReadingAttempt {
  return {
    id,
    articleId,
    currentSentenceId: `${articleId}:sentence-1`,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 30,
    status: 'active',
    startedAt: now,
    lastOpenedAt: now,
  }
}

function createTerm(id = 'term-a'): VocabularyTerm {
  return {
    id,
    normalizedTerm: 'reader',
    displayTerm: 'Reader',
    meaning: 'a person who reads',
    orphanedContextCount: 0,
    savedAt: now,
    updatedAt: now,
  }
}

function createContext(article: ArticleRecord, term: VocabularyTerm): VocabularyContext {
  return {
    id: 'context-a',
    termId: term.id,
    articleId: article.id,
    sentenceId: article.sentences[0]!.id,
    sentenceText: article.sentences[0]!.original,
    displayTerm: term.displayTerm,
    savedAt: now,
  }
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open test database.'))
  })
}

function rawPut(database: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(value)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Raw test write aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Raw test write failed.'))
  })
}
