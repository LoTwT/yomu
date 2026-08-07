import { describe, expect, it } from 'vitest'

import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import {
  ArticleNotFoundError,
  flushReadingPosition,
  openOrCreateActiveAttempt,
} from '@/features/reader/attemptCommands'
import {
  adoptReadingProgressJournal,
  clearReadingProgressJournal,
  createReadingProgressJournal,
  readReadingProgressJournal,
  readingProgressJournalOperationId,
  storeReadingProgressJournalImmediately,
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
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 12,
      now: () => new Date('2026-08-04T08:01:00.000Z'),
    })
    expect(forward.attempt.furthestSentenceOrdinal).toBe(2)
    expect(forward.attempt.activeDurationSec).toBe(12)

    const backward = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: active.id,
      baseAttemptRevision: 1,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
      now: () => new Date('2026-08-04T08:02:00.000Z'),
    })
    expect(backward.attempt.currentSentenceId).toBe('article-a:s1')
    expect(backward.attempt.furthestSentenceOrdinal).toBe(2)
    expect(backward.attempt.activeDurationSec).toBe(15)

    const replayed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: active.id,
      baseAttemptRevision: 2,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
      now: () => new Date('2026-08-04T08:03:00.000Z'),
    })
    expect(replayed.attempt.activeDurationSec).toBe(15)
  })

  it('validates a lightweight progress journal and only clears the snapshot it committed', async () => {
    const preferences = new MemoryPreferencesStore()
    const first = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 12,
    }, {
      writerId: 'writer-a',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toEqual(first)

    const newer = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 13,
    }, {
      writerId: 'writer-a',
      sequence: 2,
      writtenAt: '2026-08-04T08:00:02.000Z',
    })
    await clearReadingProgressJournal(preferences, first)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toEqual(newer)

    const samePayloadFromAnotherWriter = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 13,
    }, {
      writerId: 'writer-b',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:03.000Z',
    })
    await clearReadingProgressJournal(preferences, newer)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'writer-b',
        sequence: 1,
        currentSentenceId: 'article-a:s3',
      })

    await clearReadingProgressJournal(preferences, samePayloadFromAnotherWriter)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()
  })

  it('recovers a new legacy checkpoint through an empty v2 tombstone at revision zero', async () => {
    const preferences = new MemoryPreferencesStore()
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toBeNull()
    await preferences.set('reader-progress-journal:v1:article-a', {
      schemaVersion: 1,
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 9,
    })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        schemaVersion: 2,
        currentSentenceId: 'article-a:s3',
        activeDurationSec: 9,
      })
  })

  it('replaces another attempt v2 tombstone when migrating the active attempt legacy journal', async () => {
    const preferences = new MemoryPreferencesStore()
    await preferences.set('reader-progress-journal:v2:article-a', {
      schemaVersion: 2,
      epochId: 'completed-attempt-epoch',
      attemptId: 'completed-attempt',
      generation: 4,
      journal: null,
    })
    await preferences.set('reader-progress-journal:v1:article-a', {
      schemaVersion: 1,
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s2',
      activeDurationSec: 6,
    })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        currentSentenceId: 'article-a:s2',
        activeDurationSec: 6,
      })
  })

  it('does not replay a legacy journal when aggregate migration fails after revision zero', async () => {
    const preferences = new MemoryPreferencesStore()
    await preferences.set('reader-progress-journal:v1:article-a', {
      schemaVersion: 1,
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s1',
      activeDurationSec: 3,
    })
    const originalUpdate = preferences.update.bind(preferences)
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (key === 'reader-progress-journal:v2:article-a') {
        throw new Error('Aggregate storage is temporarily unavailable.')
      }
      return originalUpdate(key, updater)
    }

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 4))
      .toBeNull()
  })

  it('merges independent writer slots and tombstones only the committed snapshots', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'writer-a',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, {
      writerId: 'writer-b',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:02.000Z',
    })

    const merged = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(merged).toMatchObject({
      schemaVersion: 2,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    })
    expect(merged?.schemaVersion === 2 ? merged.sources : []).toHaveLength(2)

    await clearReadingProgressJournal(preferences, merged!)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()
    const slots = await preferences.listByPrefix<{ sequence: number }>(
      'reader-progress-journal-tombstone:v3:article-a:',
    )
    expect(slots).toHaveLength(2)
    expect(slots.map(({ value }) => value.sequence).sort()).toEqual([1, 1])
  })

  it('keeps each writer tombstone as a high-water mark without blocking a newer sequence', async () => {
    const preferences = new MemoryPreferencesStore()
    const committed = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 2 })
    await clearReadingProgressJournal(preferences, committed)

    await expect(writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 2,
    }, { writerId: 'writer-a', sequence: 1 })).rejects.toThrow(
      'invalid writer slot',
    )
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()

    const newer = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-a', sequence: 3 })
    expect(newer).toMatchObject({ sequence: 3, currentSentenceId: 'article-a:s3' })
  })

  it('migrates a v2 aggregate journal into its writer slot exactly once', async () => {
    const preferences = new MemoryPreferencesStore()
    await preferences.set('reader-progress-journal:v2:article-a', {
      schemaVersion: 2,
      epochId: 'aggregate-epoch',
      attemptId: 'attempt-a',
      generation: 7,
      journal: {
        writerId: 'aggregate-writer',
        sequence: 3,
        writtenAt: '2026-08-04T08:00:03.000Z',
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 8,
      },
    })

    const migrated = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(migrated).toMatchObject({
      epochId: 'aggregate-epoch',
      generation: 7,
      writerId: 'aggregate-writer',
      sequence: 3,
    })
    expect(await preferences.listByPrefix('reader-progress-journal:v3:article-a:'))
      .toHaveLength(1)
    expect(await preferences.get<{ journal: unknown | null }>(
      'reader-progress-journal:v2:article-a',
    )).toMatchObject({ journal: null })
  })

  it('does not resurrect a stale v2 aggregate through a writer tombstone', async () => {
    const preferences = new MemoryPreferencesStore()
    const aggregate = {
      schemaVersion: 2,
      epochId: 'aggregate-epoch',
      attemptId: 'attempt-a',
      generation: 4,
      journal: {
        writerId: 'aggregate-writer',
        sequence: 3,
        writtenAt: '2026-08-04T08:00:03.000Z',
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 8,
      },
    } as const
    await preferences.set('reader-progress-journal:v2:article-a', aggregate)
    const migrated = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    await clearReadingProgressJournal(preferences, migrated!)

    await preferences.set('reader-progress-journal:v2:article-a', aggregate)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()
    expect(await preferences.get<{ journal: unknown | null }>(
      'reader-progress-journal:v2:article-a',
    )).toMatchObject({ journal: null })
  })

  it('repairs an invalid journal slot before accepting the next snapshot', async () => {
    const preferences = new MemoryPreferencesStore()
    const key = 'reader-progress-journal:v2:article-a'
    await preferences.set(key, { schemaVersion: 2, truncated: true })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toBeNull()
    const next = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 13,
    }, { writerId: 'writer-b', sequence: 3 })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toEqual(next)
  })

  it('ignores corrupted supersession sources without touching another article', async () => {
    const preferences = new MemoryPreferencesStore()
    const other = await writeReadingProgressJournal(preferences, {
      articleId: 'article-b',
      attemptId: 'attempt-b',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-b:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 5,
    }, { writerId: 'writer-b', sequence: 1 })
    await preferences.set('reader-progress-journal:v3:article-a:writer-a', {
      schemaVersion: 3,
      epochId: 'corrupted-epoch',
      articleId: 'article-a',
      attemptId: 'attempt-a',
      writerId: 'writer-a',
      sequence: 1,
      generation: 1,
      journal: {
        writerId: 'writer-a',
        sequence: 1,
        writtenAt: '2026-08-04T08:00:01.000Z',
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s2',
        furthestSentenceOrdinal: 1,
        activeDurationSec: 4,
        supersedes: [{
          slotVersion: 3,
          key: 'reader-progress-journal:v3:article-b:writer-b',
          articleId: 'article-b',
          attemptId: 'attempt-b',
          writerId: 'writer-b',
          sequence: 1,
          epochId: other.epochId,
          generation: other.generation,
        }, {
          slotVersion: 3,
          key: 'reader-progress-journal:v3:article-b:writer-b',
          articleId: 'article-a',
          attemptId: 'attempt-a',
          writerId: 'writer-a',
          sequence: 1,
          epochId: 'corrupted-epoch',
          generation: 1,
        }],
      },
    })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toBeNull()
    expect(await readReadingProgressJournal(preferences, 'article-b', 'attempt-b', 0))
      .toMatchObject({
        writerId: 'writer-b',
        sequence: 1,
        currentSentenceId: 'article-b:s2',
      })
  })

  it('bootstraps a legacy v1 journal once and keeps its tombstone', async () => {
    const preferences = new MemoryPreferencesStore()
    const legacyJournal = {
      schemaVersion: 1,
      articleId: 'article-a',
      attemptId: 'attempt-a',
      currentSentenceId: 'article-a:s2',
      activeDurationSec: 12,
    } as const
    await preferences.set('reader-progress-journal:v1:article-a', legacyJournal)

    const migrated = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      currentSentenceId: 'article-a:s2',
      activeDurationSec: 12,
    })
    await clearReadingProgressJournal(preferences, migrated!)
    await preferences.set('reader-progress-journal:v1:article-a', legacyJournal)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()
  })

  it('prevents a stale generation and a generationless fallback from replacing the cursor', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })

    const latest = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 15,
      journalOperationId: 'writer-b:2',
      journalEpochId: 'epoch-a',
      journalGeneration: 2,
    })
    expect(latest.attempt).toMatchObject({
      currentSentenceId: 'article-a:s3',
      progressJournalEpochId: 'epoch-a',
      progressJournalGeneration: 2,
    })

    const staleGeneration = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 10,
      journalOperationId: 'writer-a:1',
      journalEpochId: 'epoch-a',
      journalGeneration: 1,
    })
    const failedJournalFallback = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 16,
      journalOperationId: 'writer-a:2',
    })

    expect(staleGeneration.attempt.currentSentenceId).toBe('article-a:s3')
    expect(staleGeneration.journalSettled).toBe(true)
    expect(failedJournalFallback.attempt.currentSentenceId).toBe('article-a:s3')
    expect(failedJournalFallback.cursorApplied).toBe(false)
    expect(failedJournalFallback.attempt.activeDurationSec).toBe(16)
  })

  it('increments the cursor revision only when a cursor mutation is applied', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })

    const metricsOnly = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 10,
    })
    expect(metricsOnly.attempt).toMatchObject({
      progressRevision: 0,
      furthestSentenceOrdinal: 2,
      activeDurationSec: 10,
    })

    const cursor = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 10,
    })
    expect(cursor.attempt).toMatchObject({
      progressRevision: 1,
      currentSentenceId: 'article-a:s2',
    })
  })

  it('rejects a journal from a future cursor revision', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })

    const future = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 99,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
      journalOperationId: 'writer-a:1',
      journalEpochId: 'future-epoch',
      journalGeneration: 1,
    })

    expect(future).toMatchObject({
      cursorApplied: false,
      journalSettled: true,
      attempt: {
        currentSentenceId: 'article-a:s1',
        progressRevision: 0,
        furthestSentenceOrdinal: 2,
        activeDurationSec: 9,
      },
    })
  })

  it('accepts a later sequence from the same writer after the first commit is slow', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })

    const first = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
      journalOperationId: 'writer-a:1',
      journalEpochId: 'writer-epoch',
      journalGeneration: 1,
    })
    const second = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
      journalOperationId: 'writer-a:2',
      journalEpochId: 'writer-epoch',
      journalGeneration: 2,
    })

    expect(first.attempt.progressRevision).toBe(1)
    expect(second.attempt).toMatchObject({
      currentSentenceId: 'article-a:s3',
      progressRevision: 2,
      progressJournalGeneration: 2,
    })
  })

  it('settles a duplicate cursor generation without advancing the cursor revision', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })

    const first = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
      journalOperationId: 'writer-a:1',
      journalEpochId: 'writer-epoch',
      journalGeneration: 1,
    })
    const duplicate = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 5,
      journalOperationId: 'writer-a:2',
      journalEpochId: 'writer-epoch',
      journalGeneration: 2,
    })

    expect(first.attempt.progressRevision).toBe(1)
    expect(duplicate).toMatchObject({
      cursorApplied: true,
      journalSettled: true,
      attempt: {
        currentSentenceId: 'article-a:s2',
        progressRevision: 1,
        progressJournalId: 'writer-a:2',
        progressJournalGeneration: 2,
        activeDurationSec: 5,
      },
    })
  })

  it('keeps a merged writer epoch stable while one writer advances behind a slow commit', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 2,
    }, {
      writerId: 'duration-writer',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:00.000Z',
    })
    const first = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'cursor-writer',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    const second = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, {
      writerId: 'cursor-writer',
      sequence: 2,
      writtenAt: '2026-08-04T08:00:02.000Z',
    })
    expect(first.schemaVersion).toBe(2)
    expect(second.schemaVersion).toBe(2)
    expect(second.epochId).toBe(first.epochId)
    expect(second.generation).toBeGreaterThan(first.generation)
    expect(second.sequence).toBeGreaterThan(first.sequence)

    const firstCommit = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: first.baseAttemptRevision,
      cursorMutation: first.cursorMutation,
      currentSentenceId: first.currentSentenceId,
      furthestSentenceOrdinal: first.furthestSentenceOrdinal,
      activeDurationSec: first.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(first),
      journalEpochId: first.epochId,
      journalGeneration: first.generation,
    })
    const secondCommit = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: second.baseAttemptRevision,
      cursorMutation: second.cursorMutation,
      currentSentenceId: second.currentSentenceId,
      furthestSentenceOrdinal: second.furthestSentenceOrdinal,
      activeDurationSec: second.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(second),
      journalEpochId: second.epochId,
      journalGeneration: second.generation,
    })

    expect(firstCommit.attempt.currentSentenceId).toBe('article-a:s2')
    expect(secondCommit.attempt).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
      progressRevision: 2,
    })
  })

  it('does not turn a stale cursor into a newer operation when another writer adds duration', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    const committedCursor = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 5,
    }, { writerId: 'writer-b', sequence: 1 })
    const committed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: committedCursor.baseAttemptRevision,
      cursorMutation: committedCursor.cursorMutation,
      currentSentenceId: committedCursor.currentSentenceId,
      furthestSentenceOrdinal: committedCursor.furthestSentenceOrdinal,
      activeDurationSec: committedCursor.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(committedCursor),
      journalEpochId: committedCursor.epochId,
      journalGeneration: committedCursor.generation,
    })
    expect(committed.attempt.currentSentenceId).toBe('article-a:s3')

    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    await clearReadingProgressJournal(preferences, committedCursor)
    const durationCheckpoint = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 12,
    }, { writerId: 'writer-b', sequence: 2 })
    expect(durationCheckpoint).toMatchObject({
      writerId: 'writer-b',
      sequence: 2,
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 12,
    })

    const staleCursorWithDuration = await readReadingProgressJournal(
      preferences,
      article.id,
      'attempt-a',
      1,
    )
    expect(staleCursorWithDuration).toMatchObject({
      writerId: 'writer-a',
      sequence: 1,
      currentSentenceId: 'article-a:s2',
      activeDurationSec: 12,
    })
    if (!staleCursorWithDuration || staleCursorWithDuration.schemaVersion !== 2) {
      throw new Error('Expected a merged current progress journal.')
    }
    expect(staleCursorWithDuration.epochId).not.toBe(committedCursor.epochId)

    const replayed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: staleCursorWithDuration.baseAttemptRevision,
      cursorMutation: staleCursorWithDuration.cursorMutation,
      currentSentenceId: staleCursorWithDuration.currentSentenceId,
      furthestSentenceOrdinal: staleCursorWithDuration.furthestSentenceOrdinal,
      activeDurationSec: staleCursorWithDuration.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(staleCursorWithDuration),
      journalEpochId: staleCursorWithDuration.epochId,
      journalGeneration: staleCursorWithDuration.generation,
    })
    expect(replayed).toMatchObject({
      cursorApplied: false,
      journalSettled: true,
      attempt: {
        currentSentenceId: 'article-a:s3',
        progressRevision: 1,
        activeDurationSec: 12,
      },
    })
  })

  it('merges new duration from another writer after the cursor journal is covered', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    const cursor = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 5,
    }, { writerId: 'cursor-writer', sequence: 1 })
    await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: cursor.baseAttemptRevision,
      cursorMutation: cursor.cursorMutation,
      currentSentenceId: cursor.currentSentenceId,
      furthestSentenceOrdinal: cursor.furthestSentenceOrdinal,
      activeDurationSec: cursor.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(cursor),
      journalEpochId: cursor.epochId,
      journalGeneration: cursor.generation,
    })

    const durationCheckpoint = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 12,
    }, { writerId: 'duration-writer', sequence: 1 })
    expect(durationCheckpoint).toMatchObject({
      writerId: 'duration-writer',
      cursorMutation: false,
      activeDurationSec: 12,
    })
    const coveredCursorWithDuration = await readReadingProgressJournal(
      preferences,
      article.id,
      'attempt-a',
      1,
    )
    expect(coveredCursorWithDuration).toMatchObject({
      epochId: cursor.epochId,
      generation: cursor.generation,
      writerId: cursor.writerId,
      sequence: cursor.sequence,
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 12,
    })
    if (!coveredCursorWithDuration || coveredCursorWithDuration.schemaVersion !== 2) {
      throw new Error('Expected a merged current progress journal.')
    }

    const merged = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: coveredCursorWithDuration.baseAttemptRevision,
      cursorMutation: coveredCursorWithDuration.cursorMutation,
      currentSentenceId: coveredCursorWithDuration.currentSentenceId,
      furthestSentenceOrdinal: coveredCursorWithDuration.furthestSentenceOrdinal,
      activeDurationSec: coveredCursorWithDuration.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(coveredCursorWithDuration),
      journalEpochId: coveredCursorWithDuration.epochId,
      journalGeneration: coveredCursorWithDuration.generation,
    })
    expect(merged).toMatchObject({
      cursorApplied: false,
      journalSettled: true,
      attempt: {
        currentSentenceId: 'article-a:s3',
        progressRevision: 1,
        activeDurationSec: 12,
      },
    })
  })

  it('persists a new local selection after journal recovery initially fails', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const unavailableRepositories = {
      ...repositories,
      transaction: async () => {
        throw new Error('IndexedDB is temporarily unavailable.')
      },
    } as typeof repositories
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'zz-old-writer', sequence: 1 })
    const recovered = await readReadingProgressJournal(
      preferences,
      article.id,
      'attempt-a',
      0,
    )
    if (!recovered || recovered.schemaVersion !== 2) {
      throw new Error('Expected a current progress journal.')
    }
    await expect(flushReadingPosition(unavailableRepositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: recovered.baseAttemptRevision,
      cursorMutation: recovered.cursorMutation,
      currentSentenceId: recovered.currentSentenceId,
      furthestSentenceOrdinal: recovered.furthestSentenceOrdinal,
      activeDurationSec: recovered.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(recovered),
      journalEpochId: recovered.epochId,
      journalGeneration: recovered.generation,
    })).rejects.toThrow('IndexedDB is temporarily unavailable.')

    const selected = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 6,
    }, { writerId: 'aa-current-writer', sequence: 1 })
    expect(selected).toMatchObject({
      writerId: 'aa-current-writer',
      currentSentenceId: 'article-a:s3',
    })
    expect(await readReadingProgressJournal(preferences, article.id, 'attempt-a', 0))
      .toMatchObject({
        writerId: 'zz-old-writer',
        currentSentenceId: 'article-a:s2',
      })

    const persisted = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: selected.baseAttemptRevision,
      cursorMutation: selected.cursorMutation,
      currentSentenceId: selected.currentSentenceId,
      furthestSentenceOrdinal: selected.furthestSentenceOrdinal,
      activeDurationSec: selected.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(selected),
      journalEpochId: selected.epochId,
      journalGeneration: selected.generation,
    })
    expect(persisted.attempt).toMatchObject({
      currentSentenceId: 'article-a:s3',
      progressRevision: 1,
    })
    await clearReadingProgressJournal(preferences, selected)

    const staleRecovery = await readReadingProgressJournal(
      preferences,
      article.id,
      'attempt-a',
      1,
    )
    if (!staleRecovery || staleRecovery.schemaVersion !== 2) {
      throw new Error('Expected the stale recovery journal to remain for fencing.')
    }
    const fenced = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: staleRecovery.baseAttemptRevision,
      cursorMutation: staleRecovery.cursorMutation,
      currentSentenceId: staleRecovery.currentSentenceId,
      furthestSentenceOrdinal: staleRecovery.furthestSentenceOrdinal,
      activeDurationSec: staleRecovery.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(staleRecovery),
      journalEpochId: staleRecovery.epochId,
      journalGeneration: staleRecovery.generation,
    })
    expect(fenced).toMatchObject({
      cursorApplied: false,
      journalSettled: true,
      attempt: {
        currentSentenceId: 'article-a:s3',
        progressRevision: 1,
      },
    })
  })

  it('keeps an adopted recovery causally newer when source cleanup is interrupted', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'zz-recovered-writer', sequence: 1 })
    const recovered = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    if (!recovered || recovered.schemaVersion !== 2) {
      throw new Error('Expected a current progress journal.')
    }
    const originalUpdate = preferences.update.bind(preferences)
    let interruptCleanup = true
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (interruptCleanup
        && key.startsWith('reader-progress-journal-tombstone:v3:')) {
        interruptCleanup = false
        throw new Error('The app closed before source cleanup completed.')
      }
      return originalUpdate(key, updater)
    }

    const adopted = await adoptReadingProgressJournal(preferences, recovered, {
      writerId: 'aa-current-writer',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    expect(adopted).toMatchObject({
      sourcesSettled: false,
      journal: {
        writerId: 'aa-current-writer',
        sequence: 1,
        currentSentenceId: 'article-a:s2',
      },
    })
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        writerId: 'aa-current-writer',
        currentSentenceId: 'article-a:s2',
      })

    const selected = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 6,
    }, {
      writerId: 'aa-current-writer',
      sequence: adopted.journal.sequence + 1,
      writtenAt: '2026-08-04T08:00:02.000Z',
    })
    expect(selected.sequence).toBe(2)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        writerId: 'aa-current-writer',
        sequence: 2,
        currentSentenceId: 'article-a:s3',
      })

    const committed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: selected.baseAttemptRevision,
      cursorMutation: selected.cursorMutation,
      currentSentenceId: selected.currentSentenceId,
      furthestSentenceOrdinal: selected.furthestSentenceOrdinal,
      activeDurationSec: selected.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(selected),
      journalEpochId: selected.epochId,
      journalGeneration: selected.generation,
    })
    expect(committed.attempt.currentSentenceId).toBe('article-a:s3')
    const duration = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
    }, {
      writerId: 'aa-current-writer',
      sequence: selected.sequence + 1,
    })
    expect(duration).toMatchObject({
      sequence: 3,
      cursorMutation: false,
      baseAttemptRevision: 1,
    })
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toMatchObject({
        writerId: 'aa-current-writer',
        sequence: 3,
        cursorMutation: false,
      })
    interruptCleanup = true
    await expect(clearReadingProgressJournal(preferences, duration))
      .rejects.toThrow('could not all be retired')
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toMatchObject({
        writerId: 'aa-current-writer',
        sequence: 3,
        currentSentenceId: 'article-a:s3',
      })
    await clearReadingProgressJournal(preferences, duration)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toBeNull()
  })

  it('adopts above the recovered high-water mark of the current writer', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'session-writer', sequence: 9 })
    const recovered = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    if (!recovered || recovered.schemaVersion !== 2) {
      throw new Error('Expected a current progress journal.')
    }

    const adopted = await adoptReadingProgressJournal(preferences, recovered, {
      writerId: 'session-writer',
      sequence: 1,
    })
    expect(adopted).toMatchObject({
      sourcesSettled: true,
      journal: {
        writerId: 'session-writer',
        sequence: 10,
      },
    })
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({ writerId: 'session-writer', sequence: 10 })
  })

  it('removes superseded candidates before ordering unrelated causal maxima', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'zz-recovered-writer', sequence: 1 })
    const recovered = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    if (!recovered || recovered.schemaVersion !== 2) {
      throw new Error('Expected a current progress journal.')
    }
    const originalUpdate = preferences.update.bind(preferences)
    let interruptCleanup = true
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (interruptCleanup
        && key.startsWith('reader-progress-journal-tombstone:v3:')) {
        interruptCleanup = false
        throw new Error('Cleanup interrupted.')
      }
      return originalUpdate(key, updater)
    }
    const adopted = await adoptReadingProgressJournal(preferences, recovered, {
      writerId: 'aa-adopted-writer',
      sequence: 1,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 6,
    }, {
      writerId: 'aa-adopted-writer',
      sequence: adopted.journal.sequence + 1,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 5,
    }, { writerId: 'mm-unrelated-writer', sequence: 1 })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        writerId: 'mm-unrelated-writer',
        currentSentenceId: 'article-a:s1',
      })
  })

  it('does not let an async clear overwrite a newer immediate writer generation', async () => {
    const preferences = new InterleavedMemoryPreferencesStore()
    const first = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    const interleaving = preferences.pauseNextUpdate()
    const clearing = clearReadingProgressJournal(preferences, first)
    await interleaving.started

    const immediate = storeReadingProgressJournalImmediately(
      preferences,
      createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 7,
      }, { writerId: 'writer-a', sequence: 2 }),
    )
    expect(immediate).toMatchObject({ sequence: 2, generation: 2 })
    interleaving.release()
    await clearing

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        writerId: 'writer-a',
        sequence: 2,
        generation: 2,
        currentSentenceId: 'article-a:s3',
      })
  })

  it('drops a covered cursor before a later duration-only generation', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    const cursor = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: cursor.baseAttemptRevision,
      cursorMutation: cursor.cursorMutation,
      currentSentenceId: cursor.currentSentenceId,
      furthestSentenceOrdinal: cursor.furthestSentenceOrdinal,
      activeDurationSec: cursor.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(cursor),
      journalEpochId: cursor.epochId,
      journalGeneration: cursor.generation,
    })

    const duration = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 9,
    }, { writerId: 'writer-a', sequence: 2 })
    expect(duration).toMatchObject({
      baseAttemptRevision: 1,
      cursorMutation: false,
      sequence: 2,
      generation: 2,
    })
    const durationCommit = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: duration.baseAttemptRevision,
      cursorMutation: duration.cursorMutation,
      currentSentenceId: duration.currentSentenceId,
      furthestSentenceOrdinal: duration.furthestSentenceOrdinal,
      activeDurationSec: duration.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(duration),
      journalEpochId: duration.epochId,
      journalGeneration: duration.generation,
    })
    expect(durationCommit.attempt.progressRevision).toBe(1)

    const otherWriter = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
      journalOperationId: 'writer-b:1',
      journalEpochId: 'writer-b-epoch',
      journalGeneration: 1,
    })
    expect(otherWriter).toMatchObject({
      cursorApplied: true,
      attempt: {
        currentSentenceId: 'article-a:s3',
        progressRevision: 2,
      },
    })
  })

  it('commits a merged multi-writer journal with monotonic metrics', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [createAttempt()],
    })
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 5,
    }, { writerId: 'writer-a', sequence: 1, writtenAt: firstOpenedAt })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, {
      writerId: 'writer-b',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    const merged = await readReadingProgressJournal(
      preferences,
      article.id,
      'attempt-a',
      0,
    )
    if (!merged || merged.schemaVersion !== 2) {
      throw new Error('Expected a merged current progress journal.')
    }

    const committed = await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: 'attempt-a',
      baseAttemptRevision: merged.baseAttemptRevision,
      cursorMutation: merged.cursorMutation,
      currentSentenceId: merged.currentSentenceId,
      furthestSentenceOrdinal: merged.furthestSentenceOrdinal,
      activeDurationSec: merged.activeDurationSec,
      journalOperationId: readingProgressJournalOperationId(merged),
      journalEpochId: merged.epochId,
      journalGeneration: merged.generation,
    })

    expect(committed.attempt).toMatchObject({
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
      progressRevision: 0,
    })
    await clearReadingProgressJournal(preferences, merged)
    expect(await readReadingProgressJournal(preferences, article.id, 'attempt-a', 1))
      .toBeNull()
  })

  it('selects a merged cursor by operation order instead of writer clocks', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'writer-a',
      sequence: 1,
      writtenAt: '2099-01-01T00:00:00.000Z',
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, {
      writerId: 'writer-b',
      sequence: 1,
      writtenAt: '2000-01-01T00:00:00.000Z',
    })

    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 7,
      })
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
    progressRevision: 0,
    status: 'active',
    startedAt: firstOpenedAt,
    lastOpenedAt: firstOpenedAt,
    ...overrides,
  }
}

class InterleavedMemoryPreferencesStore extends MemoryPreferencesStore {
  private pauseUpdate = false
  private resolveStarted: (() => void) | null = null
  private resumeUpdate: Promise<void> = Promise.resolve()
  private resolveResume: (() => void) | null = null

  pauseNextUpdate(): { started: Promise<void>, release: () => void } {
    this.pauseUpdate = true
    const started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve
    })
    this.resumeUpdate = new Promise<void>((resolve) => {
      this.resolveResume = resolve
    })
    return {
      started,
      release: () => this.resolveResume?.(),
    }
  }

  override async update<T>(
    key: string,
    updater: (current: unknown | null) => T | null,
  ): Promise<T | null> {
    if (!this.pauseUpdate) {
      return super.update(key, updater)
    }
    this.pauseUpdate = false
    const next = updater(this.getImmediately(key))
    this.resolveStarted?.()
    await this.resumeUpdate
    return super.update(key, () => next)
  }
}
