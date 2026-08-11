import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ArticleRecord,
  VocabularyContext,
  VocabularyTerm,
} from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type {
  LocalRepositories,
  RepositoryScope,
} from '@/data/repositories'
import {
  deleteVocabularyTerm,
  removeVocabularyContext,
  saveVocabularyContext,
  VocabularyArticleNotFoundError,
  VocabularySentenceNotFoundError,
  VocabularyTokenNotFoundError,
  VocabularyTokenNotSaveableError,
  type VocabularyCommandDependencies,
  type VocabularySelectionIds,
} from '@/features/vocabulary/vocabularyCommands'
import { normalizeVocabularyTerm } from '@/features/vocabulary/normalizeVocabularyTerm'
import { createIndexedDbLocalRepositories } from '@/platform/web/indexedDbLocalRepositories'

const firstSavedAt = '2026-08-11T08:00:00.000Z'
const secondSavedAt = '2026-08-11T09:00:00.000Z'

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
      databaseName: 'vocabulary-commands',
    }),
  },
]

describe('normalizeVocabularyTerm', () => {
  it('uses one locale-stable NFKC representation for migration and commands', () => {
    expect(normalizeVocabularyTerm('  ＲＥＡＤＥＲ  ')).toBe('reader')
    expect(normalizeVocabularyTerm('ReadER')).toBe('reader')
  })
})

describe('IndexedDB vocabulary concurrency across connections', () => {
  it('serializes the same save from two repository connections', async () => {
    const factory = new IDBFactory()
    const firstRepositories = await createIndexedDbLocalRepositories({
      factory,
      databaseName: 'vocabulary-cross-connection',
    })
    const secondRepositories = await createIndexedDbLocalRepositories({
      factory,
      databaseName: 'vocabulary-cross-connection',
    })
    const article = createArticle('article-cross-connection', [
      sentence(
        'article-cross-connection',
        's1',
        'Reader.',
        'Reader',
      ),
    ])
    try {
      await firstRepositories.articles.put(article)

      const results = await Promise.all([
        saveVocabularyContext(
          firstRepositories,
          selectWord(article),
          dependencies(['term-first', 'context-first'], firstSavedAt),
        ),
        saveVocabularyContext(
          secondRepositories,
          selectWord(article),
          dependencies(['term-second', 'context-second'], secondSavedAt),
        ),
      ])

      expect(results.map(result => result.kind).sort()).toEqual(['created', 'existing'])
      expect(await firstRepositories.vocabularyTerms.count()).toBe(1)
      expect(await secondRepositories.vocabularyContexts.count()).toBe(1)
    }
    finally {
      firstRepositories.close()
      secondRepositories.close()
    }
  })
})

for (const repositoryCase of repositoryCases) {
  describe(`vocabulary commands with ${repositoryCase.label}`, () => {
    let repositories: LocalRepositories

    beforeEach(async () => {
      repositories = await repositoryCase.create()
    })

    afterEach(() => {
      repositories.close()
    })

    it('derives every persisted field from stable ids and the stored article', async () => {
      const article = createArticle('article-a', [
        sentence('article-a', 's1', 'A patient ＲＥＡＤＥＲ waits.', 'ＲＥＡＤＥＲ', '读者'),
      ])
      await repositories.articles.put(article)

      const result = await saveVocabularyContext(
        repositories,
        {
          ...selectWord(article),
          // Runtime callers cannot override persisted content even if excess fields leak in.
          displayTerm: 'forged',
          sentenceText: 'forged',
          meaning: 'forged',
        } as VocabularySelectionIds,
        dependencies(['term-a', 'context-a'], firstSavedAt),
      )

      expect(result).toEqual({
        kind: 'created',
        term: {
          id: 'term-a',
          normalizedTerm: 'reader',
          displayTerm: 'ＲＥＡＤＥＲ',
          meaning: '读者',
          orphanedContextCount: 0,
          savedAt: firstSavedAt,
          updatedAt: firstSavedAt,
        },
        context: {
          id: 'context-a',
          termId: 'term-a',
          articleId: article.id,
          sentenceId: article.sentences[0]!.id,
          sentenceText: article.sentences[0]!.original,
          displayTerm: 'ＲＥＡＤＥＲ',
          savedAt: firstSavedAt,
        },
      })
      expect(await repositories.vocabularyTerms.list()).toEqual([result.term])
      expect(await repositories.vocabularyContexts.list()).toEqual([result.context])
    })

    it('rejects stale or non-word ids without leaving partial vocabulary', async () => {
      const article = createArticle('article-a', [
        sentence('article-a', 's1', 'Reader.', 'Reader'),
      ])
      await repositories.articles.put(article)
      const valid = selectWord(article)

      await expect(saveVocabularyContext(repositories, {
        ...valid,
        articleId: 'missing-article',
      })).rejects.toBeInstanceOf(VocabularyArticleNotFoundError)
      await expect(saveVocabularyContext(repositories, {
        ...valid,
        sentenceId: 'missing-sentence',
      })).rejects.toBeInstanceOf(VocabularySentenceNotFoundError)
      await expect(saveVocabularyContext(repositories, {
        ...valid,
        tokenId: 'missing-token',
      })).rejects.toBeInstanceOf(VocabularyTokenNotFoundError)
      await expect(saveVocabularyContext(repositories, {
        ...valid,
        tokenId: article.sentences[0]!.tokens[1]!.id,
      })).rejects.toBeInstanceOf(VocabularyTokenNotSaveableError)

      expect(await repositories.vocabularyTerms.list()).toEqual([])
      expect(await repositories.vocabularyContexts.list()).toEqual([])
    })

    it('makes concurrent saves for the same context idempotent', async () => {
      const article = createArticle('article-a', [
        sentence('article-a', 's1', 'Reader.', 'Reader'),
      ])
      await repositories.articles.put(article)
      const selection = selectWord(article)

      const results = await Promise.all([
        saveVocabularyContext(
          repositories,
          selection,
          dependencies(['term-first', 'context-first'], firstSavedAt),
        ),
        saveVocabularyContext(
          repositories,
          selection,
          dependencies(['term-second', 'context-second'], secondSavedAt),
        ),
      ])

      expect(results.map(result => result.kind).sort()).toEqual(['created', 'existing'])
      expect(results[0]!.term.id).toBe(results[1]!.term.id)
      expect(results[0]!.context.id).toBe(results[1]!.context.id)
      expect(await repositories.vocabularyTerms.count()).toBe(1)
      expect(await repositories.vocabularyContexts.count()).toBe(1)
    })

    it('groups concurrent saves across articles under one normalized term', async () => {
      const firstArticle = createArticle('article-a', [
        sentence('article-a', 's1', 'A Ｒｅａｄｅｒ waits.', 'Ｒｅａｄｅｒ'),
      ])
      const secondArticle = createArticle('article-b', [
        sentence('article-b', 's1', 'The reader leaves.', 'reader', '读者'),
      ])
      await Promise.all([
        repositories.articles.put(firstArticle),
        repositories.articles.put(secondArticle),
      ])

      await Promise.all([
        saveVocabularyContext(
          repositories,
          selectWord(firstArticle),
          dependencies(['term-first', 'context-first'], firstSavedAt),
        ),
        saveVocabularyContext(
          repositories,
          selectWord(secondArticle),
          dependencies(['term-second', 'context-second'], secondSavedAt),
        ),
      ])

      const terms = await repositories.vocabularyTerms.list()
      const contexts = await repositories.vocabularyContexts.list()
      expect(terms).toHaveLength(1)
      expect(terms[0]).toMatchObject({
        normalizedTerm: 'reader',
        meaning: '读者',
      })
      expect(contexts).toHaveLength(2)
      expect(new Set(contexts.map(context => context.termId))).toEqual(new Set([terms[0]!.id]))
      expect(new Set(contexts.map(context => context.articleId)))
        .toEqual(new Set([firstArticle.id, secondArticle.id]))
    })

    it('rolls back a term when creating its context fails after the write', async () => {
      const article = createArticle('article-a', [
        sentence('article-a', 's1', 'Reader.', 'Reader'),
      ])
      await repositories.articles.put(article)
      const failure = new Error('context write failed')
      const failingRepositories = decorateTransactionScope(repositories, scope => ({
        ...scope,
        vocabularyContexts: {
          ...scope.vocabularyContexts,
          put: async (context) => {
            await scope.vocabularyContexts.put(context)
            throw failure
          },
        },
      }))

      await expect(saveVocabularyContext(
        failingRepositories,
        selectWord(article),
        dependencies(['term-a', 'context-a'], firstSavedAt),
      )).rejects.toBe(failure)
      expect(await repositories.vocabularyTerms.list()).toEqual([])
      expect(await repositories.vocabularyContexts.list()).toEqual([])
    })

    it('removes one context by id and only deletes the final un-orphaned term', async () => {
      const firstArticle = createArticle('article-a', [
        sentence('article-a', 's1', 'Reader.', 'Reader'),
      ])
      const secondArticle = createArticle('article-b', [
        sentence('article-b', 's1', 'Reader.', 'reader'),
      ])
      await Promise.all([
        repositories.articles.put(firstArticle),
        repositories.articles.put(secondArticle),
      ])
      const first = await saveVocabularyContext(
        repositories,
        selectWord(firstArticle),
        dependencies(['term-a', 'context-a'], firstSavedAt),
      )
      const second = await saveVocabularyContext(
        repositories,
        selectWord(secondArticle),
        dependencies(['context-b'], secondSavedAt),
      )

      await expect(removeVocabularyContext(repositories, {
        contextId: first.context.id,
      })).resolves.toMatchObject({
        kind: 'removed',
        context: { id: first.context.id },
        term: { id: first.term.id },
        termDeleted: false,
      })
      expect(await repositories.vocabularyContexts.list()).toEqual([second.context])
      expect(await repositories.vocabularyTerms.get(first.term.id)).not.toBeNull()

      await expect(removeVocabularyContext(repositories, {
        contextId: second.context.id,
      })).resolves.toMatchObject({
        kind: 'removed',
        termDeleted: true,
      })
      expect(await repositories.vocabularyContexts.list()).toEqual([])
      expect(await repositories.vocabularyTerms.list()).toEqual([])
      await expect(removeVocabularyContext(repositories, {
        contextId: second.context.id,
      })).resolves.toEqual({ kind: 'not-found' })
    })

    it('retains a term with orphaned history after its final live context is removed', async () => {
      const term = createTerm({ orphanedContextCount: 2 })
      const context = createContext(term, 'article-deleted', 'sentence-deleted', 'context-a')
      await repositories.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(context)
        },
      )

      const result = await removeVocabularyContext(repositories, { contextId: context.id })

      expect(result).toMatchObject({ kind: 'removed', termDeleted: false })
      expect(await repositories.vocabularyContexts.list()).toEqual([])
      expect(await repositories.vocabularyTerms.list()).toEqual([term])
    })

    it('serializes concurrent removal of the same context', async () => {
      const term = createTerm()
      const context = createContext(term, 'article-a', 'sentence-a', 'context-a')
      await repositories.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(context)
        },
      )

      const results = await Promise.all([
        removeVocabularyContext(repositories, { contextId: context.id }),
        removeVocabularyContext(repositories, { contextId: context.id }),
      ])

      expect(results.map(result => result.kind).sort()).toEqual(['not-found', 'removed'])
      expect(await repositories.vocabularyTerms.list()).toEqual([])
      expect(await repositories.vocabularyContexts.list()).toEqual([])
    })

    it('rolls back context removal when deleting the final term fails', async () => {
      const term = createTerm()
      const context = createContext(term, 'article-a', 'sentence-a', 'context-a')
      await repositories.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(context)
        },
      )
      const failure = new Error('term delete failed')
      const failingRepositories = decorateTransactionScope(repositories, scope => ({
        ...scope,
        vocabularyTerms: {
          ...scope.vocabularyTerms,
          delete: async (termId) => {
            await scope.vocabularyTerms.delete(termId)
            throw failure
          },
        },
      }))

      await expect(removeVocabularyContext(failingRepositories, {
        contextId: context.id,
      })).rejects.toBe(failure)
      expect(await repositories.vocabularyTerms.list()).toEqual([term])
      expect(await repositories.vocabularyContexts.list()).toEqual([context])
    })

    it('deletes a whole term and all of its contexts atomically', async () => {
      const term = createTerm({ orphanedContextCount: 3 })
      const firstContext = createContext(term, 'article-a', 'sentence-a', 'context-a')
      const secondContext = createContext(term, 'article-b', 'sentence-b', 'context-b')
      await repositories.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(firstContext)
          await scope.vocabularyContexts.put(secondContext)
        },
      )

      await expect(deleteVocabularyTerm(repositories, { termId: term.id })).resolves.toEqual({
        kind: 'deleted',
        term,
        deletedContexts: [firstContext, secondContext],
      })
      expect(await repositories.vocabularyTerms.list()).toEqual([])
      expect(await repositories.vocabularyContexts.list()).toEqual([])
      await expect(deleteVocabularyTerm(repositories, { termId: term.id }))
        .resolves.toEqual({ kind: 'not-found' })
    })

    it('rolls back a whole-term deletion when a later context delete fails', async () => {
      const term = createTerm()
      const firstContext = createContext(term, 'article-a', 'sentence-a', 'context-a')
      const secondContext = createContext(term, 'article-b', 'sentence-b', 'context-b')
      await repositories.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.vocabularyTerms.put(term)
          await scope.vocabularyContexts.put(firstContext)
          await scope.vocabularyContexts.put(secondContext)
        },
      )
      const failure = new Error('second context delete failed')
      let deletionCount = 0
      const failingRepositories = decorateTransactionScope(repositories, scope => ({
        ...scope,
        vocabularyContexts: {
          ...scope.vocabularyContexts,
          delete: async (contextId) => {
            await scope.vocabularyContexts.delete(contextId)
            deletionCount += 1
            if (deletionCount === 2) {
              throw failure
            }
          },
        },
      }))

      await expect(deleteVocabularyTerm(failingRepositories, { termId: term.id }))
        .rejects.toBe(failure)
      expect(await repositories.vocabularyTerms.list()).toEqual([term])
      expect(await repositories.vocabularyContexts.list()).toEqual([firstContext, secondContext])
    })
  })
}

function createArticle(
  id: string,
  sentences: ArticleRecord['sentences'],
): ArticleRecord {
  const wordTokens = sentences.flatMap(value => value.tokens.filter(token => token.kind === 'word'))
  const meaningCount = wordTokens.filter(token => token.meaning !== undefined).length
  return {
    id,
    schemaVersion: 2,
    contentHash: `hash-${id}`,
    title: `Article ${id}`,
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: '粘贴内容' },
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
      tokenMeaning: meaningCount === 0
        ? 'none'
        : meaningCount === wordTokens.length ? 'complete' : 'partial',
    },
    sentences,
    factSources: [],
    wordCount: wordTokens.length,
    estimatedReadTimeMinutes: 1,
    createdAt: firstSavedAt,
    updatedAt: firstSavedAt,
  }
}

function sentence(
  articleId: string,
  suffix: string,
  original: string,
  tokenText: string,
  meaning?: string,
): ArticleRecord['sentences'][number] {
  const sentenceId = `${articleId}:${suffix}`
  return {
    id: sentenceId,
    order: Number.parseInt(suffix.replace(/\D/g, ''), 10) || 0,
    paragraphIndex: 0,
    textHash: `hash-${sentenceId}`,
    original,
    tokens: [
      {
        id: `${sentenceId}:word`,
        text: tokenText,
        kind: 'word',
        meaning,
      },
      {
        id: `${sentenceId}:punctuation`,
        text: '.',
        kind: 'punctuation',
      },
    ],
  }
}

function selectWord(article: ArticleRecord, sentenceIndex = 0): VocabularySelectionIds {
  const selectedSentence = article.sentences[sentenceIndex]!
  return {
    articleId: article.id,
    sentenceId: selectedSentence.id,
    tokenId: selectedSentence.tokens[0]!.id,
  }
}

function dependencies(
  ids: string[],
  timestamp: string,
): VocabularyCommandDependencies {
  let index = 0
  return {
    now: () => new Date(timestamp),
    randomUUID: () => {
      const id = ids[index]
      index += 1
      if (!id) {
        throw new Error('Unexpected UUID request in vocabulary test.')
      }
      return id
    },
  }
}

function createTerm(
  overrides: Partial<VocabularyTerm> = {},
): VocabularyTerm {
  return {
    id: 'term-a',
    normalizedTerm: 'reader',
    displayTerm: 'Reader',
    meaning: '读者',
    orphanedContextCount: 0,
    savedAt: firstSavedAt,
    updatedAt: firstSavedAt,
    ...overrides,
  }
}

function createContext(
  term: VocabularyTerm,
  articleId: string,
  sentenceId: string,
  id: string,
): VocabularyContext {
  return {
    id,
    termId: term.id,
    articleId,
    sentenceId,
    sentenceText: `Context for ${sentenceId}.`,
    displayTerm: term.displayTerm,
    savedAt: firstSavedAt,
  }
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
