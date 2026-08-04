import { describe, expect, it } from 'vitest'

import type {
  ArticleRecord,
  ReadingAttempt,
  VocabularyContext,
  VocabularyTerm,
} from '@/data/entities'
import { defaultExportPreferences } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import { DataConstraintError } from '@/data/repositories'

const now = '2026-08-01T00:00:00.000Z'

describe('local repositories', () => {
  it('stores and queries the four v2 entity types through typed repositories', async () => {
    const repositories = createMemoryLocalRepositories()
    const article = createArticle('article-b')
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
    expect(await repositories.attempts.getActiveByArticle(article.id)).toEqual(attempt)
    expect(await repositories.vocabularyTerms.getByNormalizedTerm('reader')).toEqual(term)
    expect(await repositories.vocabularyContexts.listByArticle(article.id)).toEqual([context])
  })

  it('rolls a failed read-write transaction back and restricts undeclared stores', async () => {
    const repositories = createMemoryLocalRepositories()
    const article = createArticle('article-a')

    await expect(repositories.transaction(['articles'], 'readwrite', async (scope) => {
      await scope.articles.put(article)
      throw new Error('abort')
    })).rejects.toThrow('abort')
    expect(await repositories.articles.get(article.id)).toBeNull()

    await expect(repositories.transaction(['articles'], 'readonly', async (scope) =>
      scope.attempts.list(),
    )).rejects.toBeInstanceOf(DataConstraintError)
  })

  it('enforces active-attempt and vocabulary natural-key constraints', async () => {
    const repositories = createMemoryLocalRepositories()
    await repositories.attempts.put(createAttempt('article-a', 'attempt-a'))
    await expect(repositories.attempts.put(createAttempt('article-a', 'attempt-b')))
      .rejects.toBeInstanceOf(DataConstraintError)

    await repositories.vocabularyTerms.put(createTerm('term-a'))
    await expect(repositories.vocabularyTerms.put(createTerm('term-b')))
      .rejects.toBeInstanceOf(DataConstraintError)
  })

  it('diagnoses orphaned records and emits a deterministic platform-neutral export', async () => {
    const articleA = createArticle('article-a')
    const articleB = createArticle('article-b')
    const repositories = createMemoryLocalRepositories({
      articles: [articleB, articleA],
      attempts: [createAttempt('missing-article')],
    })

    const diagnostics = await repositories.diagnose()
    expect(diagnostics.persistence).toBe('ephemeral')
    expect(diagnostics.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        store: 'attempts',
        code: 'orphaned-reference',
      }),
    ]))

    const exported = await repositories.exportData(
      defaultExportPreferences,
      '2026-08-01T12:00:00.000Z',
    )
    expect(exported).toMatchObject({
      format: 'yomu-export',
      formatVersion: 1,
      exportedAt: '2026-08-01T12:00:00.000Z',
    })
    expect(exported.articles.map(article => article.id)).toEqual(['article-a', 'article-b'])
    expect(JSON.stringify(exported)).not.toContain('apiKey')
  })

  it('applies migration payloads once and clears all repository state', async () => {
    const repositories = createMemoryLocalRepositories()
    const article = createArticle('article-a')
    await repositories.migration.apply({
      targetVersion: 2,
      articles: [article],
      attempts: [],
      vocabularyTerms: [],
      vocabularyContexts: [],
    })
    await repositories.migration.apply({
      targetVersion: 2,
      articles: [createArticle('article-b')],
      attempts: [],
      vocabularyTerms: [],
      vocabularyContexts: [],
    })

    expect(await repositories.articles.list()).toEqual([article])
    expect(await repositories.migration.getVersion()).toBe(2)

    await repositories.clearAll()
    expect(await repositories.articles.count()).toBe(0)
    expect(await repositories.migration.getVersion()).toBe(0)
  })
})

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
