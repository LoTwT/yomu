import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ArticleRecord,
  ReadingAttempt,
  VocabularyContext,
  VocabularyTerm,
} from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories, RepositoryScope } from '@/data/repositories'
import {
  ArticleTitleRequiredError,
  normalizeArticleTitle,
} from '@/features/article/articleMetadata'
import {
  ArticleManagementNotFoundError,
  deleteArticle,
  getArticleManagementDetails,
  renameArticle,
} from '@/features/library/articleCommands'
import { createIndexedDbLocalRepositories } from '@/platform/web/indexedDbLocalRepositories'

const createdAt = '2026-08-10T08:00:00.000Z'
const renamedAt = '2026-08-11T09:30:00.000Z'

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
      databaseName: 'article-commands',
    }),
  },
]

describe('normalizeArticleTitle', () => {
  it('trims and collapses whitespace with the import title limit', () => {
    expect(normalizeArticleTitle('  A\n calm\treading session  '))
      .toBe('A calm reading session')
    expect(normalizeArticleTitle('A'.repeat(121)))
      .toBe(`${'A'.repeat(117)}...`)
  })

  it('rejects a title that contains only whitespace', () => {
    expect(() => normalizeArticleTitle(' \n\t ')).toThrow(ArticleTitleRequiredError)
  })
})

for (const repositoryCase of repositoryCases) {
  describe(`article commands with ${repositoryCase.label}`, () => {
    let repositories: LocalRepositories

    beforeEach(async () => {
      repositories = await repositoryCase.create()
    })

    afterEach(() => {
      repositories.close()
    })

    it('returns source-ready article details and deletion impact counts', async () => {
      const scenario = await seedScenario(repositories)

      await expect(getArticleManagementDetails(repositories, scenario.article.id))
        .resolves.toEqual({
          article: scenario.article,
          attemptCount: 2,
          vocabularyContextCount: 3,
          contextlessTermCount: 1,
        })
    })

    it('normalizes a renamed title and updates only article metadata', async () => {
      const scenario = await seedScenario(repositories)

      const renamed = await renameArticle(
        repositories,
        { articleId: scenario.article.id, title: '  A\n better\t title  ' },
        { now: () => new Date(renamedAt) },
      )

      expect(renamed).toEqual({
        ...scenario.article,
        title: 'A better title',
        updatedAt: renamedAt,
      })
      expect(await repositories.articles.get(scenario.article.id)).toEqual(renamed)
      expect(await repositories.attempts.listByArticle(scenario.article.id))
        .toEqual(scenario.articleAttempts)
    })

    it('deletes four-store article data while retaining terms with exact orphan counts', async () => {
      const scenario = await seedScenario(repositories)
      const transaction = vi.spyOn(repositories, 'transaction')

      const result = await deleteArticle(repositories, {
        articleId: scenario.article.id,
        deleteContextlessTerms: false,
      })

      expect(transaction).toHaveBeenCalledTimes(1)
      expect(transaction).toHaveBeenCalledWith(
        ['articles', 'attempts', 'vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        expect.any(Function),
      )
      transaction.mockRestore()
      expect(result).toEqual({
        article: scenario.article,
        deletedAttemptCount: 2,
        deletedContextCount: 3,
        updatedTermCount: 2,
        deletedTermCount: 0,
      })
      expect(await repositories.articles.get(scenario.article.id)).toBeNull()
      expect(await repositories.attempts.listByArticle(scenario.article.id)).toEqual([])
      expect(await repositories.vocabularyContexts.listByArticle(scenario.article.id)).toEqual([])
      expect(await repositories.vocabularyTerms.get(scenario.soloTerm.id)).toEqual({
        ...scenario.soloTerm,
        orphanedContextCount: scenario.soloTerm.orphanedContextCount + 2,
      })
      expect(await repositories.vocabularyTerms.get(scenario.sharedTerm.id)).toEqual({
        ...scenario.sharedTerm,
        orphanedContextCount: scenario.sharedTerm.orphanedContextCount + 1,
      })
      expect(await repositories.articles.get(scenario.otherArticle.id))
        .toEqual(scenario.otherArticle)
      expect(await repositories.attempts.listByArticle(scenario.otherArticle.id))
        .toEqual(scenario.otherArticleAttempts)
      expect(await repositories.vocabularyContexts.listByArticle(scenario.otherArticle.id))
        .toEqual(scenario.otherArticleContexts)
      expect(await repositories.vocabularyTerms.get(scenario.unaffectedTerm.id))
        .toEqual(scenario.unaffectedTerm)
    })

    it('optionally deletes only terms left without live contexts', async () => {
      const scenario = await seedScenario(repositories)

      const result = await deleteArticle(repositories, {
        articleId: scenario.article.id,
        deleteContextlessTerms: true,
      })

      expect(result).toMatchObject({
        deletedAttemptCount: 2,
        deletedContextCount: 3,
        updatedTermCount: 1,
        deletedTermCount: 1,
      })
      expect(await repositories.vocabularyTerms.get(scenario.soloTerm.id)).toBeNull()
      expect(await repositories.vocabularyTerms.get(scenario.sharedTerm.id)).toEqual({
        ...scenario.sharedTerm,
        orphanedContextCount: scenario.sharedTerm.orphanedContextCount + 1,
      })
      expect(await repositories.vocabularyContexts.listByTerm(scenario.sharedTerm.id))
        .toEqual([scenario.otherArticleContexts[0]])
      expect(await repositories.vocabularyTerms.get(scenario.unaffectedTerm.id))
        .toEqual(scenario.unaffectedTerm)
    })

    it('throws an article-specific error without changing data when the id is missing', async () => {
      const scenario = await seedScenario(repositories)
      const before = await readSnapshot(repositories)

      for (const operation of [
        () => getArticleManagementDetails(repositories, 'missing-article'),
        () => renameArticle(
          repositories,
          { articleId: 'missing-article', title: 'Missing' },
          { now: () => new Date(renamedAt) },
        ),
        () => deleteArticle(repositories, {
          articleId: 'missing-article',
          deleteContextlessTerms: false,
        }),
      ]) {
        const error = await operation().catch(value => value)
        expect(error).toBeInstanceOf(ArticleManagementNotFoundError)
        expect(error).toMatchObject({ articleId: 'missing-article' })
      }

      expect(await readSnapshot(repositories)).toEqual(before)
      expect(await repositories.articles.get(scenario.article.id)).toEqual(scenario.article)
    })

    it('rolls back every store when the final article deletion fails', async () => {
      const scenario = await seedScenario(repositories)
      const before = await readSnapshot(repositories)
      const failure = new Error('article delete failed')
      const failingRepositories = decorateTransactionScope(repositories, scope => ({
        ...scope,
        articles: {
          ...scope.articles,
          delete: async (articleId) => {
            await scope.articles.delete(articleId)
            throw failure
          },
        },
      }))

      await expect(deleteArticle(failingRepositories, {
        articleId: scenario.article.id,
        deleteContextlessTerms: true,
      })).rejects.toBe(failure)
      expect(await readSnapshot(repositories)).toEqual(before)
    })
  })
}

describe('article commands with corrupt IndexedDB records', () => {
  it('physically purges every attempt and context indexed to the deleted article', async () => {
    const factory = new IDBFactory()
    const databaseName = 'article-commands-corrupt-record-purge'
    const repositories = await createIndexedDbLocalRepositories({ factory, databaseName })
    const scenario = await seedScenario(repositories)
    const database = await openDatabase(factory, databaseName)

    await rawPut(database, 'attempts', {
      id: 'attempt-a-corrupt',
      articleId: scenario.article.id,
      currentSentenceId: `${scenario.article.id}:sentence-1`,
      status: 'active',
      lastOpenedAt: createdAt,
      privateProgress: 'must be removed',
    })
    await rawPut(database, 'attempts', {
      id: 'attempt-b-corrupt',
      articleId: scenario.otherArticle.id,
      currentSentenceId: `${scenario.otherArticle.id}:sentence-1`,
      status: 'active',
      lastOpenedAt: createdAt,
      privateProgress: 'must remain',
    })
    await rawPut(database, 'vocabularyContexts', {
      id: 'context-a-corrupt',
      termId: scenario.soloTerm.id,
      articleId: scenario.article.id,
      sentenceId: `${scenario.article.id}:corrupt-sentence`,
      sentenceText: 'Private corrupt sentence that must be removed.',
      displayTerm: scenario.soloTerm.displayTerm,
    })
    await rawPut(database, 'vocabularyContexts', {
      id: 'context-b-corrupt',
      termId: scenario.unaffectedTerm.id,
      articleId: scenario.otherArticle.id,
      sentenceId: `${scenario.otherArticle.id}:corrupt-sentence`,
      sentenceText: 'Private corrupt sentence that must remain.',
      displayTerm: scenario.unaffectedTerm.displayTerm,
    })
    database.close()

    const result = await deleteArticle(repositories, {
      articleId: scenario.article.id,
      deleteContextlessTerms: false,
    })

    const rawDatabase = await openDatabase(factory, databaseName)
    const rawState = {
      targetAttemptIds: await rawListIdsByIndex(
        rawDatabase,
        'attempts',
        'byArticleId',
        scenario.article.id,
      ),
      targetContextIds: await rawListIdsByIndex(
        rawDatabase,
        'vocabularyContexts',
        'byArticleId',
        scenario.article.id,
      ),
      otherAttemptIds: await rawListIdsByIndex(
        rawDatabase,
        'attempts',
        'byArticleId',
        scenario.otherArticle.id,
      ),
      otherContextIds: await rawListIdsByIndex(
        rawDatabase,
        'vocabularyContexts',
        'byArticleId',
        scenario.otherArticle.id,
      ),
    }
    rawDatabase.close()

    expect(rawState).toMatchObject({
      targetAttemptIds: [],
      targetContextIds: [],
      otherAttemptIds: expect.arrayContaining(['attempt-b-corrupt']),
      otherContextIds: expect.arrayContaining(['context-b-corrupt']),
    })
    expect(result).toMatchObject({
      deletedAttemptCount: 3,
      deletedContextCount: 4,
    })

    expect(await repositories.vocabularyTerms.get(scenario.soloTerm.id)).toEqual({
      ...scenario.soloTerm,
      orphanedContextCount: scenario.soloTerm.orphanedContextCount + 2,
    })
    expect(await repositories.vocabularyTerms.get(scenario.sharedTerm.id)).toEqual({
      ...scenario.sharedTerm,
      orphanedContextCount: scenario.sharedTerm.orphanedContextCount + 1,
    })
    repositories.close()
  })
})

interface ArticleScenario {
  article: ArticleRecord
  otherArticle: ArticleRecord
  articleAttempts: ReadingAttempt[]
  otherArticleAttempts: ReadingAttempt[]
  soloTerm: VocabularyTerm
  sharedTerm: VocabularyTerm
  unaffectedTerm: VocabularyTerm
  otherArticleContexts: VocabularyContext[]
}

async function seedScenario(repositories: LocalRepositories): Promise<ArticleScenario> {
  const article = createArticle('article-a')
  const otherArticle = createArticle('article-b')
  const articleAttempts = [
    createAttempt(article.id, 'attempt-a-active', 'active'),
    createAttempt(article.id, 'attempt-a-completed', 'completed'),
  ]
  const otherArticleAttempts = [
    createAttempt(otherArticle.id, 'attempt-b-active', 'active'),
  ]
  const soloTerm = createTerm('term-solo', 'reader', 3)
  const sharedTerm = createTerm('term-shared', 'practice', 1)
  const unaffectedTerm = createTerm('term-unaffected', 'calm', 2)
  const articleContexts = [
    createContext('context-a-solo-1', soloTerm, article, 0),
    createContext('context-a-solo-2', soloTerm, article, 1),
    createContext('context-a-shared', sharedTerm, article, 0),
  ]
  const otherArticleContexts = [
    createContext('context-b-shared', sharedTerm, otherArticle, 0),
    createContext('context-b-unaffected', unaffectedTerm, otherArticle, 1),
  ]

  await repositories.transaction(
    ['articles', 'attempts', 'vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      for (const record of [article, otherArticle]) {
        await scope.articles.put(record)
      }
      for (const record of [...articleAttempts, ...otherArticleAttempts]) {
        await scope.attempts.put(record)
      }
      for (const record of [soloTerm, sharedTerm, unaffectedTerm]) {
        await scope.vocabularyTerms.put(record)
      }
      for (const record of [...articleContexts, ...otherArticleContexts]) {
        await scope.vocabularyContexts.put(record)
      }
    },
  )

  return {
    article,
    otherArticle,
    articleAttempts,
    otherArticleAttempts,
    soloTerm,
    sharedTerm,
    unaffectedTerm,
    otherArticleContexts,
  }
}

function createArticle(id: string): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `hash-${id}`,
    title: `Article ${id}`,
    language: 'en',
    level: 'unassessed',
    source: {
      kind: 'url',
      label: 'Example source',
      url: 'https://example.com/story',
      author: 'Example Author',
      publicationYear: '2026',
    },
    rights: {
      status: 'user-provided-unknown',
      note: 'User supplied.',
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    capabilities: {
      sentenceTranslation: 'none',
      sentenceIpa: 'none',
      tokenMeaning: 'none',
    },
    sentences: [0, 1].map(index => ({
      id: `${id}:sentence-${index + 1}`,
      order: index,
      paragraphIndex: index,
      textHash: `hash-${id}-sentence-${index + 1}`,
      original: `Sentence ${index + 1} for ${id}.`,
      tokens: [{
        id: `${id}:sentence-${index + 1}:token-1`,
        text: 'Sentence',
        kind: 'word',
      }],
    })),
    factSources: [{ title: 'Example source', url: 'https://example.com/story' }],
    wordCount: 8,
    estimatedReadTimeMinutes: 1,
    createdAt,
    updatedAt: createdAt,
  }
}

function createAttempt(
  articleId: string,
  id: string,
  status: ReadingAttempt['status'],
): ReadingAttempt {
  return {
    id,
    articleId,
    currentSentenceId: `${articleId}:sentence-1`,
    furthestSentenceOrdinal: status === 'completed' ? 1 : 0,
    activeDurationSec: 30,
    status,
    startedAt: createdAt,
    lastOpenedAt: createdAt,
    ...(status === 'completed' ? { completedAt: createdAt } : {}),
  }
}

function createTerm(
  id: string,
  normalizedTerm: string,
  orphanedContextCount: number,
): VocabularyTerm {
  return {
    id,
    normalizedTerm,
    displayTerm: normalizedTerm[0]!.toUpperCase() + normalizedTerm.slice(1),
    orphanedContextCount,
    savedAt: createdAt,
    updatedAt: createdAt,
  }
}

function createContext(
  id: string,
  term: VocabularyTerm,
  article: ArticleRecord,
  sentenceIndex: number,
): VocabularyContext {
  const sentence = article.sentences[sentenceIndex]!
  return {
    id,
    termId: term.id,
    articleId: article.id,
    sentenceId: sentence.id,
    sentenceText: sentence.original,
    displayTerm: term.displayTerm,
    savedAt: createdAt,
  }
}

async function readSnapshot(repositories: LocalRepositories): Promise<{
  articles: ArticleRecord[]
  attempts: ReadingAttempt[]
  vocabularyTerms: VocabularyTerm[]
  vocabularyContexts: VocabularyContext[]
}> {
  const [articles, attempts, vocabularyTerms, vocabularyContexts] = await Promise.all([
    repositories.articles.list(),
    repositories.attempts.list(),
    repositories.vocabularyTerms.list(),
    repositories.vocabularyContexts.list(),
  ])
  return { articles, attempts, vocabularyTerms, vocabularyContexts }
}

function decorateTransactionScope(
  repositories: LocalRepositories,
  decorate: (scope: RepositoryScope) => RepositoryScope,
): LocalRepositories {
  return {
    persistence: repositories.persistence,
    articles: repositories.articles,
    attempts: repositories.attempts,
    vocabularyTerms: repositories.vocabularyTerms,
    vocabularyContexts: repositories.vocabularyContexts,
    migration: repositories.migration,
    transaction: (stores, mode, operation) => repositories.transaction(
      stores,
      mode,
      scope => operation(decorate(scope)),
    ),
    diagnose: () => repositories.diagnose(),
    exportData: (preferences, exportedAt) => repositories.exportData(preferences, exportedAt),
    clearAll: () => repositories.clearAll(),
    close: () => repositories.close(),
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

function rawListIdsByIndex(
  database: IDBDatabase,
  storeName: string,
  indexName: string,
  query: IDBValidKey,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).index(indexName).getAllKeys(query)
    request.onsuccess = () => resolve(request.result.map(String))
    request.onerror = () => reject(request.error ?? new Error('Raw index read failed.'))
  })
}
