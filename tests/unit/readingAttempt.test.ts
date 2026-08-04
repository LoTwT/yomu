import { describe, expect, it } from 'vitest'

import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import {
  ArticleNotFoundError,
  flushReadingPosition,
  openOrCreateActiveAttempt,
} from '@/features/reader/attemptCommands'
import {
  clearReadingProgressJournal,
  readReadingProgressJournal,
  writeReadingProgressJournal,
} from '@/features/reader/progressJournal'
import { MemoryPreferencesStore } from '@/platform/memoryStores'

const firstOpenedAt = '2026-08-04T08:00:00.000Z'

describe('reading attempt commands', () => {
  it('creates one active attempt and reuses it on the next open', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const created = await openOrCreateActiveAttempt(repositories, article.id, {
      now: () => new Date(firstOpenedAt),
      randomUUID: () => 'attempt-a',
    })

    expect(created.attempt).toMatchObject({
      id: 'attempt-a',
      currentSentenceId: 'article-a:s1',
      status: 'active',
    })

    const reopened = await openOrCreateActiveAttempt(repositories, article.id, {
      now: () => new Date('2026-08-04T09:00:00.000Z'),
      randomUUID: () => 'attempt-must-not-be-used',
    })
    expect(reopened.attempt.id).toBe('attempt-a')
    expect(reopened.attempt.lastOpenedAt).toBe('2026-08-04T09:00:00.000Z')
    expect(await repositories.attempts.count()).toBe(1)
  })

  it('repairs an invalid saved sentence and keeps furthest progress monotonic', async () => {
    const article = createArticle()
    const active = createAttempt({
      currentSentenceId: 'missing-sentence',
      furthestSentenceOrdinal: 1,
    })
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [active],
    })
    const opened = await openOrCreateActiveAttempt(repositories, article.id, {
      now: () => new Date(firstOpenedAt),
    })
    expect(opened.attempt.currentSentenceId).toBe('article-a:s1')

    const forward = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: active.id,
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 12,
      now: () => new Date('2026-08-04T08:01:00.000Z'),
    })
    expect(forward.furthestSentenceOrdinal).toBe(2)
    expect(forward.activeDurationSec).toBe(12)

    const backward = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: active.id,
      currentSentenceId: 'article-a:s1',
      activeDurationSec: 15,
      now: () => new Date('2026-08-04T08:02:00.000Z'),
    })
    expect(backward.currentSentenceId).toBe('article-a:s1')
    expect(backward.furthestSentenceOrdinal).toBe(2)
    expect(backward.activeDurationSec).toBe(15)

    const replayed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: active.id,
      currentSentenceId: 'article-a:s1',
      activeDurationSec: 15,
      now: () => new Date('2026-08-04T08:03:00.000Z'),
    })
    expect(replayed.activeDurationSec).toBe(15)
  })

  it('validates a lightweight progress journal and only clears the snapshot it committed', async () => {
    const preferences = new MemoryPreferencesStore()
    const first = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s2',
      activeDurationSec: 12,
    })
    expect(await readReadingProgressJournal(preferences, 'article-a')).toEqual(first)

    const newer = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 13,
    })
    await clearReadingProgressJournal(preferences, first)
    expect(await readReadingProgressJournal(preferences, 'article-a')).toEqual(newer)

    await clearReadingProgressJournal(preferences, newer)
    expect(await readReadingProgressJournal(preferences, 'article-a')).toBeNull()
  })

  it('starts a new attempt after completion and fails explicitly for missing articles', async () => {
    const article = createArticle()
    const completed = createAttempt({
      status: 'completed',
      completedAt: firstOpenedAt,
    })
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
    })

    const opened = await openOrCreateActiveAttempt(repositories, article.id, {
      randomUUID: () => 'attempt-reread',
      now: () => new Date('2026-08-04T10:00:00.000Z'),
    })
    expect(opened.attempt.id).toBe('attempt-reread')
    expect(opened.attempt.status).toBe('active')
    expect(await repositories.attempts.count()).toBe(2)

    await expect(openOrCreateActiveAttempt(repositories, 'missing-article'))
      .rejects.toBeInstanceOf(ArticleNotFoundError)
  })
})

function createArticle(): ArticleRecord {
  return {
    id: 'article-a',
    schemaVersion: 2,
    contentHash: 'article-content-hash',
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
      id: `article-a:s${index}`,
      order: index - 1,
      paragraphIndex: 0,
      textHash: `sentence-hash-${index}`,
      original: `This is sentence number ${index}.`,
      tokens: [{
        id: `article-a:s${index}:t1`,
        text: 'sentence',
        kind: 'word',
      }],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: firstOpenedAt,
    updatedAt: firstOpenedAt,
  }
}

function createAttempt(overrides: Partial<ReadingAttempt> = {}): ReadingAttempt {
  return {
    id: 'attempt-a',
    articleId: 'article-a',
    currentSentenceId: 'article-a:s1',
    furthestSentenceOrdinal: 0,
    activeDurationSec: 0,
    status: 'active',
    startedAt: firstOpenedAt,
    lastOpenedAt: firstOpenedAt,
    ...overrides,
  }
}
