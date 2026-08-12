import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isArticleRecord, type ArticleRecord } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import { publicDomainSampleArticle } from '@/features/article/publicDomainSample'
import {
  BundledSampleDeletionPendingError,
  BundledSampleIdentityConflictError,
  BundledSampleValidationError,
  createPublicDomainArticleIncarnationId,
  createPublicDomainArticleId,
  mapBundledSampleToArticleRecord,
  startBundledSampleReading,
} from '@/features/article/startBundledSampleReading'
import { articleDeletionIntentKey } from '@/features/article/articleDeletionFence'
import { markReadingProgressArticleRetired } from '@/features/reader/progressJournal'
import type { PreferencesStore } from '@/platform/contracts'
import { MemoryPreferencesStore } from '@/platform/memoryStores'
import { createIndexedDbLocalRepositories } from '@/platform/web/indexedDbLocalRepositories'

const firstStartedAt = '2026-08-12T08:00:00.000Z'
const reopenedAt = '2026-08-12T09:00:00.000Z'

describe('bundled public-domain sample mapping', () => {
  it('creates a valid canonical article with stable source identity and auditable rights', () => {
    const article = mapBundledSampleToArticleRecord(
      publicDomainSampleArticle,
      firstStartedAt,
    )
    const metadata = publicDomainSampleArticle.publicDomainMetadata!

    expect(isArticleRecord(article)).toBe(true)
    expect(article).toMatchObject({
      id: createPublicDomainArticleId(metadata.id, publicDomainSampleArticle.contentVersion),
      schemaVersion: 2,
      title: publicDomainSampleArticle.title,
      description: publicDomainSampleArticle.deck,
      level: publicDomainSampleArticle.level,
      source: {
        kind: 'public-domain',
        label: metadata.sourceLabel,
        url: metadata.sourceUrl,
        itemId: metadata.id,
        itemVersion: publicDomainSampleArticle.contentVersion,
        author: metadata.author,
        publicationYear: metadata.publicationYear,
      },
      rights: {
        status: 'public-domain',
        ttsAllowed: publicDomainSampleArticle.rights.ttsAllowed,
        translationAllowed: publicDomainSampleArticle.rights.translationAllowed,
        cacheAllowed: publicDomainSampleArticle.rights.cacheAllowed,
      },
      capabilities: {
        sentenceTranslation: 'none',
        sentenceIpa: 'none',
        tokenMeaning: 'none',
      },
      factSources: publicDomainSampleArticle.factSources,
      createdAt: firstStartedAt,
      updatedAt: firstStartedAt,
    })
    expect(article.rights.note).toContain(metadata.publicDomainBasis)
    expect(article.rights.note).toContain(metadata.regionPosture)
    expect(article.rights.note).toContain(metadata.excerptRange)
    expect(article.rights.note).toContain(metadata.retrievedAt)
    expect(article.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(article.sentences.every(sentence =>
      sentence.id.startsWith(`${article.id}:`)
      && sentence.tokens.every(token => token.id.startsWith(`${sentence.id}:`))))
      .toBe(true)
    expect(article.sentences.every(sentence =>
      !Object.hasOwn(sentence, 'translation')
      && !Object.hasOwn(sentence, 'sentenceIpa')))
      .toBe(true)
    expect(JSON.stringify(article)).not.toContain('audioRef')
    expect(JSON.stringify(article)).not.toContain('cacheKey')
  })

  it('rejects a draft or non-public-domain package instead of guessing provenance', () => {
    expect(() => mapBundledSampleToArticleRecord({
      ...publicDomainSampleArticle,
      qaStatus: 'draft',
    }, firstStartedAt)).toThrow(BundledSampleValidationError)
    expect(() => mapBundledSampleToArticleRecord({
      ...publicDomainSampleArticle,
      rights: {
        ...publicDomainSampleArticle.rights,
        sourceType: 'ai-generated',
      },
    }, firstStartedAt)).toThrow(BundledSampleValidationError)
  })
})

const repositoryCases: Array<{
  label: string
  create: () => Promise<LocalRepositories>
}> = [
  {
    label: 'memory repositories',
    create: async () => createMemoryLocalRepositories(),
  },
  {
    label: 'IndexedDB repositories',
    create: async () => createIndexedDbLocalRepositories({
      factory: new IDBFactory(),
      databaseName: 'bundled-sample-reading',
    }),
  },
]

for (const repositoryCase of repositoryCases) {
  describe(`bundled sample command with ${repositoryCase.label}`, () => {
    let repositories: LocalRepositories
    let preferences: PreferencesStore

    beforeEach(async () => {
      repositories = await repositoryCase.create()
      preferences = new MemoryPreferencesStore()
    })

    afterEach(() => {
      repositories.close()
    })

    it('atomically creates the article and first active attempt, then reuses both', async () => {
      const created = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'attempt-first',
      })
      const metadata = publicDomainSampleArticle.publicDomainMetadata!

      expect(created).toMatchObject({
        articleCreated: true,
        attemptCreated: true,
        article: {
          id: createPublicDomainArticleIncarnationId(
            metadata.id,
            publicDomainSampleArticle.contentVersion,
            'attempt-first',
          ),
          source: {
            itemId: metadata.id,
            itemVersion: publicDomainSampleArticle.contentVersion,
          },
        },
        attempt: {
          id: 'attempt-first',
          articleId: created.article.id,
          currentSentenceId: created.article.sentences[0]?.id,
          status: 'active',
          startedAt: firstStartedAt,
          lastOpenedAt: firstStartedAt,
        },
      })

      const reopened = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(reopenedAt),
        randomUUID: () => {
          throw new Error('must not allocate another active attempt')
        },
      })
      expect(reopened).toMatchObject({
        articleCreated: false,
        attemptCreated: false,
        article: { id: created.article.id },
        attempt: { id: 'attempt-first', lastOpenedAt: reopenedAt },
      })
      expect(await repositories.articles.count()).toBe(1)
      expect(await repositories.attempts.count()).toBe(1)
    })

    it('creates a fresh active attempt after the previous attempt is complete', async () => {
      const first = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'attempt-completed',
      })
      await repositories.attempts.put({
        ...first.attempt,
        status: 'completed',
        completedAt: reopenedAt,
        lastOpenedAt: reopenedAt,
      })

      const restarted = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date('2026-08-12T10:00:00.000Z'),
        randomUUID: () => 'attempt-restarted',
      })

      expect(restarted).toMatchObject({
        articleCreated: false,
        attemptCreated: true,
        article: { id: first.article.id },
        attempt: { id: 'attempt-restarted', status: 'active' },
      })
      expect(await repositories.articles.count()).toBe(1)
      expect(await repositories.attempts.count()).toBe(2)
    })

    it('rolls back the article when the attempt cannot be written', async () => {
      const originalTransaction = repositories.transaction.bind(repositories)
      repositories.transaction = async (...args) => originalTransaction(
        args[0],
        args[1],
        async (scope) => {
          if (args[1] === 'readwrite'
            && args[0].includes('articles')
            && args[0].includes('attempts')) {
            scope.attempts.put = async () => {
              throw new Error('attempt write failed')
            }
          }
          return args[2](scope)
        },
      )

      await expect(startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'rollback-incarnation',
      })).rejects.toThrow('attempt write failed')

      expect(await repositories.articles.count()).toBe(0)
      expect(await repositories.attempts.count()).toBe(0)
    })

    it('does not overwrite an unrelated article at the deterministic id', async () => {
      const expected = mapBundledSampleToArticleRecord(
        publicDomainSampleArticle,
        firstStartedAt,
      )
      const conflicting: ArticleRecord = {
        ...expected,
        source: { kind: 'paste', label: '用户已有文章' },
        rights: {
          ...expected.rights,
          status: 'user-provided-unknown',
          note: 'User-provided content.',
        },
      }
      await repositories.articles.put(conflicting)

      await expect(startBundledSampleReading({ repositories, preferences }, {
        randomUUID: () => 'must-not-be-used',
      })).rejects.toMatchObject({
        name: 'BundledSampleIdentityConflictError',
        articleId: expected.id,
        expectedItemId: expected.source.itemId,
        expectedItemVersion: expected.source.itemVersion,
      })
      expect(await repositories.articles.get(expected.id)).toEqual(conflicting)
      expect(await repositories.attempts.count()).toBe(0)
    })

    it('deduplicates by public-domain item and version rather than body hash', async () => {
      const expected = mapBundledSampleToArticleRecord(
        publicDomainSampleArticle,
        firstStartedAt,
      )
      const existing = moveArticleToId(expected, 'legacy-public-domain-id')
      await repositories.articles.put(existing)

      const result = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'legacy-attempt',
      })

      expect(result).toMatchObject({
        articleCreated: false,
        attemptCreated: true,
        article: { id: 'legacy-public-domain-id' },
        attempt: { articleId: 'legacy-public-domain-id' },
      })
      expect(await repositories.articles.count()).toBe(1)
    })

    it('does not merge a user article that happens to have the same body hash', async () => {
      const expected = mapBundledSampleToArticleRecord(
        publicDomainSampleArticle,
        firstStartedAt,
      )
      const userArticle = moveArticleToId({
        ...expected,
        source: { kind: 'paste', label: '粘贴文本' },
        rights: {
          ...expected.rights,
          status: 'user-provided-unknown',
          note: 'User-provided content.',
        },
      }, 'user-article-with-same-body')
      await repositories.articles.put(userArticle)

      const result = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'public-domain-attempt',
      })

      expect(result.article.id).not.toBe(userArticle.id)
      expect(result.article.contentHash).toBe(userArticle.contentHash)
      expect(result.articleCreated).toBe(true)
      expect(await repositories.articles.count()).toBe(2)
      expect(await repositories.attempts.count()).toBe(1)
    })

    it.each([
      {
        label: 'pending deletion intent',
        applyFence: async (store: PreferencesStore, articleId: string) => {
          await store.set(articleDeletionIntentKey(articleId), {
            schemaVersion: 1,
            kind: 'article-deletion-intent',
            articleId,
            deleteContextlessTerms: false,
          })
        },
      },
      {
        label: 'retired progress marker',
        applyFence: (store: PreferencesStore, articleId: string) =>
          markReadingProgressArticleRetired(store, articleId),
      },
    ])('rejects a live sample behind a $label', async ({ applyFence }) => {
      const created = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'fenced-incarnation',
      })
      await applyFence(preferences, created.article.id)

      await expect(startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(reopenedAt),
        randomUUID: () => {
          throw new Error('must not allocate through a live deletion fence')
        },
      })).rejects.toEqual(new BundledSampleDeletionPendingError(created.article.id))

      expect(await repositories.articles.list()).toEqual([created.article])
      expect(await repositories.attempts.list()).toEqual([created.attempt])
    })

    it('creates a fresh incarnation without clearing fences for a physically deleted one', async () => {
      const first = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'retired-incarnation',
      })
      await preferences.set(articleDeletionIntentKey(first.article.id), {
        schemaVersion: 1,
        kind: 'article-deletion-intent',
        articleId: first.article.id,
        deleteContextlessTerms: false,
      })
      await markReadingProgressArticleRetired(preferences, first.article.id)
      await repositories.transaction(['articles', 'attempts'], 'readwrite', async (scope) => {
        await scope.attempts.deleteByArticle(first.article.id)
        await scope.articles.delete(first.article.id)
      })

      const recreated = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(reopenedAt),
        randomUUID: () => 'fresh-incarnation',
      })
      const metadata = publicDomainSampleArticle.publicDomainMetadata!

      expect(recreated).toMatchObject({
        articleCreated: true,
        attemptCreated: true,
        article: {
          id: createPublicDomainArticleIncarnationId(
            metadata.id,
            publicDomainSampleArticle.contentVersion,
            'fresh-incarnation',
          ),
        },
        attempt: { id: 'fresh-incarnation' },
      })
      expect(recreated.article.id).not.toBe(first.article.id)
      await expect(preferences.get(articleDeletionIntentKey(first.article.id)))
        .resolves.not.toBeNull()
      await expect(startBundledSampleReading({ repositories, preferences }, {
        randomUUID: () => {
          throw new Error('must reuse the unfenced live incarnation')
        },
      })).resolves.toMatchObject({
        articleCreated: false,
        attemptCreated: false,
        article: { id: recreated.article.id },
      })
    })
  })
}

describe('bundled sample command concurrency', () => {
  it('serializes concurrent clicks in memory without duplicate records', async () => {
    const repositories = createMemoryLocalRepositories()
    const preferences = new MemoryPreferencesStore()
    try {
      const results = await Promise.all([
        startBundledSampleReading({ repositories, preferences }, {
          now: () => new Date(firstStartedAt),
          randomUUID: () => 'memory-attempt-a',
        }),
        startBundledSampleReading({ repositories, preferences }, {
          now: () => new Date(reopenedAt),
          randomUUID: () => 'memory-attempt-b',
        }),
      ])

      expect(new Set(results.map(result => result.article.id)).size).toBe(1)
      expect(new Set(results.map(result => result.attempt.id)).size).toBe(1)
      expect(results.filter(result => result.articleCreated)).toHaveLength(1)
      expect(results.filter(result => result.attemptCreated)).toHaveLength(1)
      expect(results[0]!.article.id).toContain(':incarnation:')
      expect(await repositories.articles.count()).toBe(1)
      expect(await repositories.attempts.count()).toBe(1)
    }
    finally {
      repositories.close()
    }
  })

  it('serializes concurrent clicks across IndexedDB connections', async () => {
    const factory = new IDBFactory()
    const databaseName = 'bundled-sample-cross-connection'
    const firstRepositories = await createIndexedDbLocalRepositories({ factory, databaseName })
    const secondRepositories = await createIndexedDbLocalRepositories({ factory, databaseName })
    const firstPreferences = new MemoryPreferencesStore()
    const secondPreferences = new MemoryPreferencesStore()
    try {
      const results = await Promise.all([
        startBundledSampleReading({
          repositories: firstRepositories,
          preferences: firstPreferences,
        }, {
          now: () => new Date(firstStartedAt),
          randomUUID: () => 'indexed-attempt-a',
        }),
        startBundledSampleReading({
          repositories: secondRepositories,
          preferences: secondPreferences,
        }, {
          now: () => new Date(reopenedAt),
          randomUUID: () => 'indexed-attempt-b',
        }),
      ])

      expect(new Set(results.map(result => result.article.id)).size).toBe(1)
      expect(new Set(results.map(result => result.attempt.id)).size).toBe(1)
      expect(results.filter(result => result.articleCreated)).toHaveLength(1)
      expect(results.filter(result => result.attemptCreated)).toHaveLength(1)
      expect(results[0]!.article.id).toContain(':incarnation:')
      expect(await firstRepositories.articles.count()).toBe(1)
      expect(await secondRepositories.attempts.count()).toBe(1)
    }
    finally {
      firstRepositories.close()
      secondRepositories.close()
    }
  })
})

describe('bundled sample command with corrupt IndexedDB records', () => {
  it('preserves an invalid deterministic-base record while creating a fresh incarnation', async () => {
    const factory = new IDBFactory()
    const databaseName = 'bundled-sample-corrupt-stable-id'
    const repositories = await createIndexedDbLocalRepositories({ factory, databaseName })
    const preferences = new MemoryPreferencesStore()
    const expected = mapBundledSampleToArticleRecord(
      publicDomainSampleArticle,
      firstStartedAt,
    )
    const database = await openDatabase(factory, databaseName)
    const invalidRecord = {
      id: expected.id,
      schemaVersion: 1,
      title: 'Recoverable quarantined content',
      privatePayload: 'must survive the identity conflict',
    }
    await rawPut(database, 'articles', invalidRecord)
    database.close()

    try {
      const created = await startBundledSampleReading({ repositories, preferences }, {
        now: () => new Date(firstStartedAt),
        randomUUID: () => 'valid-incarnation',
      })
      expect(created).toMatchObject({
        articleCreated: true,
        attemptCreated: true,
        article: {
          id: createPublicDomainArticleIncarnationId(
            expected.source.itemId!,
            expected.source.itemVersion!,
            'valid-incarnation',
          ),
        },
        attempt: { id: 'valid-incarnation' },
      })
      expect(await repositories.attempts.count()).toBe(1)

      const reopened = await openDatabase(factory, databaseName)
      try {
        await expect(rawGet(reopened, 'articles', expected.id)).resolves.toEqual(invalidRecord)
        await expect(rawGet(reopened, 'articles', created.article.id))
          .resolves.toEqual(created.article)
      }
      finally {
        reopened.close()
      }
    }
    finally {
      repositories.close()
    }
  })
})

function moveArticleToId(article: ArticleRecord, articleId: string): ArticleRecord {
  return {
    ...article,
    id: articleId,
    sentences: article.sentences.map((sentence) => {
      const sentenceId = sentence.id.replace(`${article.id}:`, `${articleId}:`)
      return {
        ...sentence,
        id: sentenceId,
        tokens: sentence.tokens.map(token => ({
          ...token,
          id: token.id.replace(`${article.id}:`, `${articleId}:`),
        })),
      }
    }),
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

function rawGet(database: IDBDatabase, storeName: string, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Raw test read failed.'))
  })
}
