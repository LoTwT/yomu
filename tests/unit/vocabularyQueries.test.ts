import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ArticleRecord,
  VocabularyContext,
  VocabularyTerm,
} from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories, RepositoryMode } from '@/data/repositories'
import {
  saveVocabularyContext,
  VocabularyTokenNotSaveableError,
} from '@/features/vocabulary/vocabularyCommands'
import {
  findVocabularyContext,
  listVocabulary,
} from '@/features/vocabulary/vocabularyQueries'
import { createIndexedDbLocalRepositories } from '@/platform/web/indexedDbLocalRepositories'

const olderTimestamp = '2026-08-10T08:00:00.000Z'
const newerTimestamp = '2026-08-11T08:00:00.000Z'

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
      databaseName: 'vocabulary-queries',
    }),
  },
]

for (const repositoryCase of repositoryCases) {
  describe(`vocabulary queries with ${repositoryCase.label}`, () => {
    let repositories: LocalRepositories

    beforeEach(async () => {
      repositories = await repositoryCase.create()
    })

    afterEach(() => {
      repositories.close()
    })

    it('aggregates valid contexts and hides unavailable stored source text', async () => {
      const firstArticle = createArticle('article-a', 'Alpha article', 'Reader waits.')
      const secondArticle = createArticle('article-b', 'Beta article', 'Reader leaves.')
      const reader = createTerm({
        id: 'term-reader',
        normalizedTerm: 'reader',
        displayTerm: 'Reader',
        orphanedContextCount: 1,
        savedAt: olderTimestamp,
        updatedAt: newerTimestamp,
      })
      const book = createTerm({
        id: 'term-book',
        normalizedTerm: 'book',
        displayTerm: 'Book',
        orphanedContextCount: 2,
        savedAt: newerTimestamp,
        updatedAt: olderTimestamp,
      })
      const contexts = [
        createContext(
          reader,
          firstArticle.id,
          firstArticle.sentences[0]!.id,
          'context-a',
          olderTimestamp,
        ),
        createContext(
          reader,
          secondArticle.id,
          secondArticle.sentences[0]!.id,
          'context-b',
          newerTimestamp,
        ),
        createContext(
          reader,
          'missing-article',
          'missing-article:s1',
          'context-missing-article',
          newerTimestamp,
          'Text from a deleted article must stay hidden.',
        ),
        createContext(
          reader,
          firstArticle.id,
          'article-a:missing-sentence',
          'context-missing-sentence',
          newerTimestamp,
          'Stale sentence text must stay hidden.',
        ),
        {
          ...createContext(
            reader,
            firstArticle.id,
            firstArticle.sentences[0]!.id,
            'context-missing-term',
            newerTimestamp,
          ),
          termId: 'missing-term',
        },
      ]
      await repositories.transaction(
        ['articles', 'vocabularyTerms', 'vocabularyContexts'],
        'readwrite',
        async (scope) => {
          await scope.articles.put(firstArticle)
          await scope.articles.put(secondArticle)
          await scope.vocabularyTerms.put(reader)
          await scope.vocabularyTerms.put(book)
          for (const context of contexts) {
            await scope.vocabularyContexts.put(context)
          }
        },
      )

      const result = await listVocabulary(repositories)

      expect(result.ignoredContextCount).toBe(3)
      expect(result.entries.map(entry => entry.term.id)).toEqual(['term-reader', 'term-book'])
      expect(result.entries[0]).toMatchObject({
        term: reader,
        unavailableContextCount: 3,
      })
      expect(result.entries[0]!.contexts.map(entry => entry.context.id))
        .toEqual(['context-b', 'context-a'])
      expect(result.entries[0]!.contexts.map(entry => entry.article)).toEqual([
        {
          id: secondArticle.id,
          title: secondArticle.title,
          source: secondArticle.source,
        },
        {
          id: firstArticle.id,
          title: firstArticle.title,
          source: firstArticle.source,
        },
      ])
      expect(result.entries[1]).toEqual({
        term: book,
        contexts: [],
        unavailableContextCount: 2,
      })
      expect(JSON.stringify(result)).not.toContain('deleted article')
      expect(JSON.stringify(result)).not.toContain('Stale sentence')
    })

    it('uses one readonly transaction and does not repair data as a query side effect', async () => {
      const term = createTerm()
      await repositories.vocabularyTerms.put(term)
      const modes: RepositoryMode[] = []
      const trackingRepositories = trackTransactionModes(repositories, modes)

      const before = await repositories.vocabularyTerms.list()
      await expect(listVocabulary(trackingRepositories)).resolves.toMatchObject({
        entries: [{ term }],
      })

      expect(modes).toEqual(['readonly'])
      expect(await repositories.vocabularyTerms.list()).toEqual(before)
    })

    it('finds the current saved selection without trusting caller-provided content', async () => {
      const article = createArticle('article-a', 'Alpha article', 'Ｒｅａｄｅｒ waits.', [
        {
          id: 'article-a:s2',
          order: 1,
          paragraphIndex: 0,
          textHash: 'hash-article-a:s2',
          original: 'Reader returns.',
          tokens: [
            { id: 'article-a:s2:word', text: 'Reader', kind: 'word' },
            { id: 'article-a:s2:punctuation', text: '.', kind: 'punctuation' },
          ],
        },
      ])
      await repositories.articles.put(article)
      const selection = selectWord(article)
      const saved = await saveVocabularyContext(repositories, selection, {
        now: () => new Date(newerTimestamp),
        randomUUID: sequence('term-a', 'context-a'),
      })

      await expect(findVocabularyContext(repositories, {
        ...selection,
        displayTerm: 'forged',
      } as typeof selection)).resolves.toEqual({
        term: saved.term,
        context: saved.context,
      })
      await expect(findVocabularyContext(repositories, {
        articleId: article.id,
        sentenceId: article.sentences[1]!.id,
        tokenId: article.sentences[1]!.tokens[0]!.id,
      })).resolves.toBeNull()
      await expect(findVocabularyContext(repositories, {
        articleId: article.id,
        sentenceId: article.sentences[0]!.id,
        tokenId: article.sentences[0]!.tokens[1]!.id,
      })).rejects.toBeInstanceOf(VocabularyTokenNotSaveableError)
      expect(await repositories.vocabularyTerms.count()).toBe(1)
      expect(await repositories.vocabularyContexts.count()).toBe(1)
    })
  })
}

function createArticle(
  id: string,
  title: string,
  firstSentenceText: string,
  additionalSentences: ArticleRecord['sentences'] = [],
): ArticleRecord {
  const firstSentenceId = `${id}:s1`
  return {
    id,
    schemaVersion: 2,
    contentHash: `hash-${id}`,
    title,
    language: 'en',
    level: 'unassessed',
    source: {
      kind: 'url',
      label: `${title} source`,
      url: `https://example.com/${id}`,
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
      tokenMeaning: 'complete',
    },
    sentences: [
      {
        id: firstSentenceId,
        order: 0,
        paragraphIndex: 0,
        textHash: `hash-${firstSentenceId}`,
        original: firstSentenceText,
        tokens: [
          {
            id: `${firstSentenceId}:word`,
            text: firstSentenceText.startsWith('Ｒ') ? 'Ｒｅａｄｅｒ' : 'Reader',
            kind: 'word',
            meaning: '读者',
          },
          { id: `${firstSentenceId}:punctuation`, text: '.', kind: 'punctuation' },
        ],
      },
      ...additionalSentences,
    ],
    factSources: [],
    wordCount: 1 + additionalSentences.length,
    estimatedReadTimeMinutes: 1,
    createdAt: olderTimestamp,
    updatedAt: newerTimestamp,
  }
}

function createTerm(overrides: Partial<VocabularyTerm> = {}): VocabularyTerm {
  return {
    id: 'term-reader',
    normalizedTerm: 'reader',
    displayTerm: 'Reader',
    meaning: '读者',
    orphanedContextCount: 0,
    savedAt: olderTimestamp,
    updatedAt: olderTimestamp,
    ...overrides,
  }
}

function createContext(
  term: VocabularyTerm,
  articleId: string,
  sentenceId: string,
  id: string,
  savedAt: string,
  sentenceText = `Context for ${sentenceId}.`,
): VocabularyContext {
  return {
    id,
    termId: term.id,
    articleId,
    sentenceId,
    sentenceText,
    displayTerm: term.displayTerm,
    savedAt,
  }
}

function selectWord(article: ArticleRecord) {
  return {
    articleId: article.id,
    sentenceId: article.sentences[0]!.id,
    tokenId: article.sentences[0]!.tokens[0]!.id,
  }
}

function sequence(...ids: string[]): () => string {
  let index = 0
  return () => {
    const id = ids[index]
    index += 1
    if (!id) {
      throw new Error('Unexpected UUID request in vocabulary query test.')
    }
    return id
  }
}

function trackTransactionModes(
  repositories: LocalRepositories,
  modes: RepositoryMode[],
): LocalRepositories {
  return {
    persistence: repositories.persistence,
    articles: repositories.articles,
    attempts: repositories.attempts,
    vocabularyTerms: repositories.vocabularyTerms,
    vocabularyContexts: repositories.vocabularyContexts,
    migration: repositories.migration,
    transaction: (stores, mode, operation) => {
      modes.push(mode)
      return repositories.transaction(stores, mode, operation)
    },
    diagnose: () => repositories.diagnose(),
    exportData: (preferences, exportedAt) => repositories.exportData(preferences, exportedAt),
    clearAll: () => repositories.clearAll(),
    close: () => repositories.close(),
  }
}
