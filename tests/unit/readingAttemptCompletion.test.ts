import { describe, expect, it, vi } from 'vitest'

import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import {
  ArticleNotFoundError,
  completeReadingAttempt,
  ReadingAttemptUnavailableError,
} from '@/features/reader/attemptCommands'

const startedAt = '2026-08-04T08:00:00.000Z'
const completedAt = '2026-08-04T08:05:00.000Z'

describe('reading attempt completion command', () => {
  it('atomically completes an active attempt with its final progress snapshot', async () => {
    const article = createArticle('article-a')
    const activeAttempt = createAttempt(article.id, {
      furthestSentenceOrdinal: 1,
      activeDurationSec: 8,
      progressRevision: 3,
      progressJournalId: 'journal-operation-a',
      progressJournalEpochId: 'journal-epoch-a',
      progressJournalGeneration: 4,
    })
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })

    const result = await completeReadingAttempt(repositories, {
      articleId: article.id,
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 14.9,
      now: () => new Date(completedAt),
    })

    expect(result.completedNow).toBe(true)
    expect(result.attempt).toEqual({
      ...activeAttempt,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 14,
      progressRevision: 4,
      status: 'completed',
      lastOpenedAt: completedAt,
      completedAt,
    })
    expect(await repositories.attempts.get(activeAttempt.id)).toEqual(result.attempt)
    expect(await repositories.attempts.getActiveByArticle(article.id)).toBeNull()
  })

  it('uses the explicit final cursor while preserving durable furthest and duration maxima', async () => {
    const article = createArticle('article-a')
    const activeAttempt = createAttempt(article.id, {
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 30,
      progressRevision: 7,
    })
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })

    const result = await completeReadingAttempt(repositories, {
      articleId: article.id,
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 12,
      now: () => new Date(completedAt),
    })

    expect(result.attempt).toMatchObject({
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 30,
      progressRevision: 8,
      completedAt,
    })
  })

  it('returns the first completed record unchanged when completion is retried', async () => {
    const article = createArticle('article-a')
    const activeAttempt = createAttempt(article.id)
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })
    const first = await completeReadingAttempt(repositories, {
      articleId: article.id,
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
      now: () => new Date(completedAt),
    })
    const retryClock = vi.fn(() => new Date('2026-08-04T09:00:00.000Z'))

    const retried = await completeReadingAttempt(repositories, {
      articleId: article.id,
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 99,
      now: retryClock,
    })

    expect(retried).toEqual({ attempt: first.attempt, completedNow: false })
    expect(retryClock).not.toHaveBeenCalled()
    expect(await repositories.attempts.get(activeAttempt.id)).toEqual(first.attempt)
  })

  it('rejects a missing article without changing its attempt', async () => {
    const article = createArticle('article-a')
    const activeAttempt = createAttempt(article.id)
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })

    await expect(completeReadingAttempt(repositories, {
      articleId: 'missing-article',
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
    })).rejects.toBeInstanceOf(ArticleNotFoundError)
    expect(await repositories.attempts.get(activeAttempt.id)).toEqual(activeAttempt)
  })

  it.each([
    { label: 'missing', attemptId: 'missing-attempt' },
    { label: 'another article\'s', attemptId: 'attempt-a' },
  ])('rejects a $label attempt for the requested article', async ({ attemptId }) => {
    const articleA = createArticle('article-a')
    const articleB = createArticle('article-b')
    const activeAttempt = createAttempt(articleA.id)
    const repositories = createMemoryLocalRepositories({
      articles: [articleA, articleB],
      attempts: [activeAttempt],
    })

    await expect(completeReadingAttempt(repositories, {
      articleId: articleB.id,
      attemptId,
      currentSentenceId: 'article-b:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
    })).rejects.toMatchObject({
      name: 'ReadingAttemptUnavailableError',
      attemptId,
    } satisfies Partial<ReadingAttemptUnavailableError>)
    expect(await repositories.attempts.get(activeAttempt.id)).toEqual(activeAttempt)
  })

  it('rolls the completion back when the transactional attempt write fails', async () => {
    const article = createArticle('article-a')
    const activeAttempt = createAttempt(article.id, {
      furthestSentenceOrdinal: 1,
      activeDurationSec: 8,
    })
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })
    const failure = new Error('The completion transaction failed.')
    failAttemptWriteAfterStaging(repositories, failure)

    await expect(completeReadingAttempt(repositories, {
      articleId: article.id,
      attemptId: activeAttempt.id,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
      now: () => new Date(completedAt),
    })).rejects.toBe(failure)
    expect(await repositories.attempts.get(activeAttempt.id)).toEqual(activeAttempt)
    expect(await repositories.attempts.getActiveByArticle(article.id)).toEqual(activeAttempt)
  })
})

function failAttemptWriteAfterStaging(
  repositories: LocalRepositories,
  failure: Error,
): void {
  const originalTransaction = repositories.transaction.bind(repositories)
  repositories.transaction = async (stores, mode, operation) =>
    originalTransaction(stores, mode, scope => operation({
      ...scope,
      attempts: {
        ...scope.attempts,
        put: async (record) => {
          await scope.attempts.put(record)
          throw failure
        },
      },
    }))
}

function createArticle(id: string): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `${id}-content-hash`,
    title: 'A local reading article',
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: '粘贴文本' },
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
      tokenMeaning: 'none',
    },
    sentences: [1, 2, 3].map(index => ({
      id: `${id}:s${index}`,
      order: index - 1,
      paragraphIndex: 0,
      textHash: `${id}-sentence-hash-${index}`,
      original: `This is sentence number ${index}.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: startedAt,
    updatedAt: startedAt,
  }
}

function createAttempt(
  articleId: string,
  overrides: Partial<ReadingAttempt> = {},
): ReadingAttempt {
  return {
    id: 'attempt-a',
    articleId,
    currentSentenceId: `${articleId}:s1`,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 0,
    progressRevision: 0,
    status: 'active',
    startedAt,
    lastOpenedAt: startedAt,
    ...overrides,
  }
}
