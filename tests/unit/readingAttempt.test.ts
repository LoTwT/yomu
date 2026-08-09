import { describe, expect, it, vi } from 'vitest'

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
  clearSelectedReadingProgressJournal,
  compactReadingProgressJournalSlots,
  createReadingProgressJournal,
  readReadingProgressJournal,
  readingProgressJournalOperationId,
  storeReadingProgressJournal,
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

  it('retires only the selected writer when an independent writer has a sequence gap', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 7,
    }, { writerId: 'writer-b', sequence: 3 })

    const merged = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(merged).toMatchObject({
      writerId: 'writer-a',
      sequence: 1,
      writerGapLineages: [{ writerId: 'writer-b', sequence: 3 }],
    })

    await expect(clearSelectedReadingProgressJournal(preferences, merged!))
      .resolves.toBeUndefined()
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-a',
    )).toMatchObject({
      sequence: 1,
      causalClosureSequence: 1,
    })
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-b',
    )).toBeNull()
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({
        writerId: 'writer-b',
        sequence: 3,
      })
  })

  it('ignores persisted runtime-only causal closure provenance', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    const key = 'reader-progress-journal:v4:article-a:writer-a:1'
    const operation = await preferences.get<Record<string, unknown>>(key)
    if (!operation || !operation.journal || typeof operation.journal !== 'object') {
      throw new Error('Expected a stored writer operation.')
    }
    await preferences.set(key, {
      ...operation,
      journal: {
        ...operation.journal,
        selectedCausalClosureLineages: [{ writerId: 'forged-writer', sequence: 9 }],
      },
    })

    const recovered = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(recovered).toMatchObject({ writerId: 'writer-a', sequence: 1 })
    expect(recovered).not.toHaveProperty('selectedCausalClosureLineages')
  })

  it('derives the selected causal gap without retiring an independent gap writer', async () => {
    const preferences = new MemoryPreferencesStore()
    const oldest = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 1,
    }, { writerId: 'writer-z', sequence: 1 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: false,
        currentSentenceId: 'article-a:s1',
        furthestSentenceOrdinal: 0,
        activeDurationSec: 2,
      }, { writerId: 'writer-b', sequence: 1 }),
      supersedes: oldest.sources,
    })
    const inheritedGap = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 3,
    }, { writerId: 'writer-b', sequence: 3 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 5,
      }, { writerId: 'writer-a', sequence: 1 }),
      supersedes: inheritedGap.sources,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 7,
    }, { writerId: 'writer-u', sequence: 3 })

    const merged = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(merged).toMatchObject({
      writerId: 'writer-a',
      writerGapLineages: [
        { writerId: 'writer-b', sequence: 3 },
        { writerId: 'writer-u', sequence: 3 },
      ],
      selectedCausalClosureLineages: [
        { writerId: 'writer-b', sequence: 3 },
        { writerId: 'writer-z', sequence: 1 },
      ],
    })
    if (!merged || merged.schemaVersion !== 2) {
      throw new Error('Expected a merged current progress journal.')
    }

    const originalUpdate = preferences.update.bind(preferences)
    let rejectOldestTombstone = true
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (rejectOldestTombstone
        && key === 'reader-progress-journal-tombstone:v3:article-a:writer-z') {
        throw new Error('Oldest selected source is temporarily unavailable.')
      }
      return originalUpdate(key, updater)
    }

    await expect(clearSelectedReadingProgressJournal(preferences, merged))
      .rejects.toThrow('selected reading progress journal could not be retired')
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-a',
    )).toBeNull()
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-b',
    )).toMatchObject({ sequence: 3 })
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-b',
    )).not.toHaveProperty('causalClosureSequence')
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-u',
    )).toBeNull()

    const retry = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
      0,
    )
    expect(retry).toMatchObject({
      writerId: 'writer-a',
      selectedCausalClosureLineages: [
        { writerId: 'writer-b', sequence: 3 },
        { writerId: 'writer-z', sequence: 1 },
      ],
    })
    if (!retry || retry.schemaVersion !== 2) {
      throw new Error('Expected a selected progress journal retry.')
    }

    rejectOldestTombstone = false
    await expect(clearSelectedReadingProgressJournal(preferences, retry))
      .resolves.toBeUndefined()
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-a',
    )).toMatchObject({ sequence: 1, causalClosureSequence: 1 })
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-b',
    )).toMatchObject({ sequence: 3, causalClosureSequence: 3 })
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-u',
    )).toBeNull()
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 0))
      .toMatchObject({ writerId: 'writer-u', sequence: 3 })
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

  it('keeps reusable v3 slots as migration inputs while newer writes use v4 operations', async () => {
    const preferences = new MemoryPreferencesStore()
    await preferences.set('reader-progress-journal:v3:article-a:writer-a', {
      schemaVersion: 3,
      epochId: 'legacy-writer-epoch',
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
      },
    })
    const legacy = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(legacy).toMatchObject({
      writerId: 'writer-a',
      sequence: 1,
      currentSentenceId: 'article-a:s2',
    })
    await clearReadingProgressJournal(preferences, legacy!)

    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(0)
    expect(await preferences.get(
      'reader-progress-journal:v3:article-a:writer-a',
    )).not.toBeNull()

    const newer = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 7,
    }, { writerId: 'writer-a', sequence: 2 })
    expect(newer.sources?.[0]).toMatchObject({
      slotVersion: 4,
      key: 'reader-progress-journal:v4:article-a:writer-a:2',
    })
    const duplicate = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
    }, { writerId: 'writer-a', sequence: 2 })
    expect(duplicate).toEqual(newer)
  })

  it('prunes a known predecessor without enumerating storage during writes', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    const listByPrefix = vi.spyOn(preferences, 'listByPrefix')

    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-a', sequence: 2 })
    storeReadingProgressJournalImmediately(preferences, createReadingProgressJournal({
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
    }, { writerId: 'writer-a', sequence: 3 }))

    expect(listByPrefix).not.toHaveBeenCalled()
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-a:1',
    )).toBeNull()
  })

  it('fails closed when any journal lineage scan is unavailable', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-a', sequence: 1 })
    const originalListByPrefix = preferences.listByPrefix.bind(preferences)
    preferences.listByPrefix = <T>(prefix: string) =>
      prefix === 'reader-progress-journal:v3:article-a:'
        ? Promise.reject(new Error('Legacy journal scan is unavailable.'))
        : originalListByPrefix<T>(prefix)

    await expect(readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )).rejects.toThrow('Legacy journal scan is unavailable.')
  })

  it('compacts retired writer slots in deterministic bounded batches', async () => {
    const preferences = new MemoryPreferencesStore()
    for (const [writerId, writtenAt] of [
      ['writer-c', '2000-01-01T00:00:00.000Z'],
      ['writer-a', '2099-01-01T00:00:00.000Z'],
      ['writer-b', '2026-08-04T08:00:00.000Z'],
    ] as const) {
      const journal = await writeReadingProgressJournal(preferences, {
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s2',
        furthestSentenceOrdinal: 1,
        activeDurationSec: 4,
      }, { writerId, sequence: 1, writtenAt })
      await clearReadingProgressJournal(preferences, journal)
    }
    const otherArticle = await writeReadingProgressJournal(preferences, {
      articleId: 'article-b',
      attemptId: 'attempt-b',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-b:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    await clearReadingProgressJournal(preferences, otherArticle)
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-live', sequence: 1 })

    const listByPrefix = vi.spyOn(preferences, 'listByPrefix')
    await expect(compactReadingProgressJournalSlots(
      preferences,
      'article-a',
      { maxRemovals: 2 },
    )).resolves.toBe(2)
    expect(listByPrefix).toHaveBeenCalledOnce()
    expect(listByPrefix).toHaveBeenCalledWith(
      'reader-progress-journal:v4:article-a:',
    )
    listByPrefix.mockRestore()

    expect((await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )).map(({ key }) => key)).toEqual([
      'reader-progress-journal:v4:article-a:writer-c:1',
      'reader-progress-journal:v4:article-a:writer-live:1',
    ])
    expect(await preferences.listByPrefix(
      'reader-progress-journal-tombstone:v3:article-a:',
    )).toHaveLength(3)
    expect(await preferences.listByPrefix(
      'reader-progress-journal:v4:article-b:',
    )).toHaveLength(1)

    await expect(compactReadingProgressJournalSlots(
      preferences,
      'article-a',
      { maxRemovals: 2 },
    )).resolves.toBe(1)
    await expect(compactReadingProgressJournalSlots(
      preferences,
      'article-a',
      { maxRemovals: 2 },
    )).resolves.toBe(0)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({ writerId: 'writer-live', sequence: 1 })
  })

  it('compacts tombstoned causal slots behind a live writer', async () => {
    const preferences = new MemoryPreferencesStore()
    const first = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 2,
    }, { writerId: 'writer-a', sequence: 1 })
    await clearReadingProgressJournal(preferences, first)

    const second = await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s2',
        furthestSentenceOrdinal: 1,
        activeDurationSec: 4,
      }, { writerId: 'writer-b', sequence: 1 }),
      supersedes: first.sources,
    })
    await clearReadingProgressJournal(preferences, second)

    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 6,
      }, { writerId: 'writer-c', sequence: 1 }),
      supersedes: second.sources?.filter(source => source.writerId === 'writer-b'),
    })
    const unrelated = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, { writerId: 'writer-d', sequence: 1 })
    await clearReadingProgressJournal(preferences, unrelated)

    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(3)
    expect((await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )).map(({ key }) => key)).toEqual([
      'reader-progress-journal:v4:article-a:writer-c:1',
    ])
  })

  it('keeps a causal anchor across a same-writer sequence gap', async () => {
    const preferences = new MemoryPreferencesStore()
    const recovered = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 2,
    }, { writerId: 'writer-z', sequence: 1 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 6,
      }, { writerId: 'writer-a', sequence: 1 }),
      supersedes: recovered.sources,
    })

    // Sequence 2 represents a failed write, so sequence 3 has no predecessor.
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, { writerId: 'writer-a', sequence: 3 })
    const latest = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-a', sequence: 4 })
    expect(latest.writerSequenceHasGap).toBe(true)

    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(0)
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-a:1',
    )).not.toBeNull()
    const merged = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(merged).toMatchObject({
      writerId: 'writer-a',
      sequence: 4,
      writerSequenceHasGap: true,
      currentSentenceId: 'article-a:s3',
    })

    await clearReadingProgressJournal(preferences, latest)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toBeNull()
    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(3)
  })

  it('carries every writer gap lineage through a multi-writer adoption', async () => {
    const preferences = new MemoryPreferencesStore()
    const recovered = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 2,
    }, { writerId: 'writer-z', sequence: 1 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s2',
        furthestSentenceOrdinal: 1,
        activeDurationSec: 4,
      }, { writerId: 'writer-a', sequence: 1 }),
      supersedes: recovered.sources,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 6,
    }, { writerId: 'writer-a', sequence: 3 })
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, { writerId: 'writer-zz', sequence: 1 })

    const merged = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(merged).toMatchObject({
      writerId: 'writer-zz',
      writerGapLineages: [{ writerId: 'writer-a', sequence: 3 }],
      selectedCausalClosureLineages: [],
    })
    if (!merged || merged.schemaVersion !== 2) {
      throw new Error('Expected a merged current progress journal.')
    }

    const adopted = await adoptReadingProgressJournal(preferences, merged, {
      writerId: 'writer-current',
      sequence: 1,
    })
    expect(adopted).toMatchObject({
      sourcesSettled: true,
      journal: {
        writerId: 'writer-current',
        writerGapLineages: [{ writerId: 'writer-a', sequence: 3 }],
      },
    })
    expect(adopted.journal).not.toHaveProperty('selectedCausalClosureLineages')
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-current:1',
    )).not.toHaveProperty('journal.selectedCausalClosureLineages')
    await clearReadingProgressJournal(preferences, adopted.journal)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toBeNull()
  })

  it('settles nested writer gap lineages before retiring their carrier', async () => {
    const preferences = new MemoryPreferencesStore()
    const oldest = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 1,
    }, { writerId: 'writer-z', sequence: 1 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s2',
        furthestSentenceOrdinal: 1,
        activeDurationSec: 2,
      }, { writerId: 'writer-b', sequence: 1 }),
      supersedes: oldest.sources,
    })
    const writerBGap = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 3,
    }, { writerId: 'writer-b', sequence: 3 })
    await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 4,
      }, { writerId: 'writer-a', sequence: 1 }),
      writerGapLineages: [{ writerId: 'writer-b', sequence: 3 }],
      supersedes: writerBGap.sources,
    })
    const writerAGap = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 5,
    }, { writerId: 'writer-a', sequence: 3 })
    const carrier = await storeReadingProgressJournal(preferences, {
      ...createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 6,
      }, { writerId: 'writer-current', sequence: 1 }),
      writerGapLineages: [{ writerId: 'writer-a', sequence: 3 }],
      supersedes: writerAGap.sources,
    })

    const originalUpdate = preferences.update.bind(preferences)
    let rejectOldestTombstone = true
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (rejectOldestTombstone
        && key === 'reader-progress-journal-tombstone:v3:article-a:writer-z') {
        throw new Error('Oldest causal source is temporarily unavailable.')
      }
      return originalUpdate(key, updater)
    }
    await expect(clearReadingProgressJournal(preferences, carrier))
      .rejects.toThrow('sources could not all be retired')
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-a',
    )).not.toHaveProperty('causalClosureSequence')
    expect(await preferences.get(
      'reader-progress-journal-tombstone:v3:article-a:writer-b',
    )).not.toHaveProperty('causalClosureSequence')
    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(2)
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-a:1',
    )).not.toBeNull()
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-b:1',
    )).not.toBeNull()

    const retry = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(retry).toMatchObject({
      writerId: 'writer-current',
      currentSentenceId: 'article-a:s3',
      writerGapLineages: [{ writerId: 'writer-a', sequence: 3 }],
    })
    if (!retry || retry.schemaVersion !== 2) {
      throw new Error('Expected a current progress journal retry.')
    }
    rejectOldestTombstone = false
    await clearReadingProgressJournal(preferences, retry)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toBeNull()
  })

  it('keeps repeated cross-writer adoption storage bounded', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-0', sequence: 1 })

    for (let index = 1; index <= 100; index += 1) {
      const recovered = await readReadingProgressJournal(
        preferences,
        'article-a',
        'attempt-a',
      )
      if (!recovered || recovered.schemaVersion !== 2) {
        throw new Error('Expected a current progress journal.')
      }
      const adopted = await adoptReadingProgressJournal(preferences, recovered, {
        writerId: `writer-${index}`,
        sequence: 1,
      })
      expect(adopted.sourcesSettled).toBe(true)
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
  })

  it('compacts an old operation without touching a newer concurrent sequence', async () => {
    const preferences = new NonLinearizableCompactionPreferencesStore()
    const first = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    await clearReadingProgressJournal(preferences, first)

    const interleaving = preferences.pauseNextCompareAndRemove()
    const compacting = compactReadingProgressJournalSlots(preferences, 'article-a')
    await interleaving.started
    const immediate = storeReadingProgressJournalImmediately(
      preferences,
      createReadingProgressJournal({
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 1,
        cursorMutation: true,
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 8,
      }, { writerId: 'writer-a', sequence: 2 }),
    )
    interleaving.release()

    await expect(compacting).resolves.toBe(1)
    expect(immediate).toMatchObject({ sequence: 2, generation: 2 })
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'writer-a',
        sequence: 2,
        currentSentenceId: 'article-a:s3',
      })
  })

  it('keeps unresolved same-writer storage bounded through a prolonged outage', async () => {
    const preferences = new MemoryPreferencesStore()
    for (let sequence = 1; sequence <= 1_100; sequence += 1) {
      await writeReadingProgressJournal(preferences, {
        articleId: 'article-a',
        attemptId: 'attempt-a',
        baseAttemptRevision: 0,
        cursorMutation: true,
        currentSentenceId: sequence % 2 === 0 ? 'article-a:s2' : 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: sequence,
      }, {
        writerId: 'outage-writer',
        sequence,
        writtenAt: '2026-08-04T08:00:00.000Z',
      })
    }

    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:outage-writer:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
    expect(await preferences.listByPrefix(
      'reader-progress-journal-tombstone:v3:article-a:',
    )).toHaveLength(0)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'outage-writer',
        sequence: 1_100,
        writerSequenceHighWater: 1_099,
        currentSentenceId: 'article-a:s2',
        activeDurationSec: 1_100,
      })
  })

  it('keeps same-writer storage bounded across repeated sequence gaps', async () => {
    const preferences = new MemoryPreferencesStore()
    const write = (sequence: number) => writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: sequence % 2 === 0 ? 'article-a:s2' : 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: sequence,
    }, {
      writerId: 'intermittent-writer',
      sequence,
      writtenAt: '2026-08-04T08:00:00.000Z',
    })

    await write(1)
    for (let cycle = 1; cycle <= 100; cycle += 1) {
      // Each skipped sequence models one failed write followed by two successes.
      await write(cycle * 3)
      await write(cycle * 3 + 1)
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:intermittent-writer:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'intermittent-writer',
        sequence: 301,
        writerSequenceHasGap: true,
        currentSentenceId: 'article-a:s3',
      })
  })

  it('keeps isolated same-writer successes bounded and fences delayed history', async () => {
    const preferences = new MemoryPreferencesStore()
    const write = (sequence: number) => writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: sequence === 1 ? 'article-a:s1' : 'article-a:s3',
      furthestSentenceOrdinal: sequence === 1 ? 0 : 2,
      activeDurationSec: sequence,
    }, {
      writerId: 'isolated-writer',
      sequence,
      writtenAt: '2026-08-04T08:00:00.000Z',
    })

    await write(1)
    const delayed = await preferences.get(
      'reader-progress-journal:v4:article-a:isolated-writer:1',
    )
    for (let sequence = 3; sequence <= 201; sequence += 2) {
      await write(sequence)
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    expect(await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:isolated-writer:',
    )).toHaveLength(1)
    await preferences.set(
      'reader-progress-journal:v4:article-a:isolated-writer:1',
      delayed,
    )
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'isolated-writer',
        sequence: 201,
        writerSequenceHighWater: 200,
        writerSequenceHasGap: true,
        currentSentenceId: 'article-a:s3',
      })
    await expect(compactReadingProgressJournalSlots(preferences, 'article-a'))
      .resolves.toBe(1)
  })

  it('keeps only the newest provider of duplicate external gap debt', async () => {
    const preferences = new MemoryPreferencesStore()
    const external = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 1,
    }, { writerId: 'external-writer', sequence: 1 })
    const writeWithExternalDebt = (sequence: number) =>
      storeReadingProgressJournal(preferences, {
        ...createReadingProgressJournal({
          articleId: 'article-a',
          attemptId: 'attempt-a',
          baseAttemptRevision: 0,
          cursorMutation: true,
          currentSentenceId: 'article-a:s3',
          furthestSentenceOrdinal: 2,
          activeDurationSec: sequence,
        }, {
          writerId: 'gap-writer',
          sequence,
          writtenAt: '2026-08-04T08:00:00.000Z',
        }),
        supersedes: external.sources,
      })

    await writeWithExternalDebt(1)
    for (let cycle = 1; cycle <= 100; cycle += 1) {
      await writeWithExternalDebt(cycle * 3)
      await writeWithExternalDebt(cycle * 3 + 1)
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    expect(await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:gap-writer:',
    )).toHaveLength(1)
    expect(await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )).toHaveLength(2)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'gap-writer',
        sequence: 301,
        currentSentenceId: 'article-a:s3',
      })
  })

  it('discards unique external gap debt after every source is settled', async () => {
    const preferences = new MemoryPreferencesStore()
    const snapshot = (activeDurationSec: number) => ({
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec,
    })
    await writeReadingProgressJournal(
      preferences,
      snapshot(1),
      { writerId: 'gap-writer', sequence: 1 },
    )

    for (let cycle = 1; cycle <= 100; cycle += 1) {
      const external = await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 - 1),
        { writerId: `external-writer-${cycle}`, sequence: 1 },
      )
      const adopted = await adoptReadingProgressJournal(preferences, external, {
        writerId: 'gap-writer',
        sequence: cycle * 3,
        writtenAt: '2026-08-04T08:00:00.000Z',
      })
      expect(adopted).toMatchObject({
        sourcesSettled: true,
        journal: { sequence: cycle * 3 },
      })
      await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 + 1),
        { writerId: 'gap-writer', sequence: cycle * 3 + 1 },
      )
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    const gapOperations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:gap-writer:',
    )
    expect(gapOperations).toHaveLength(1)
    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a'))
      .toMatchObject({
        writerId: 'gap-writer',
        sequence: 301,
        currentSentenceId: 'article-a:s3',
      })
  })

  it('discards external gap lineages only after carrier closure is proven', async () => {
    const preferences = new MemoryPreferencesStore()
    const snapshot = (activeDurationSec: number) => ({
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec,
    })
    await writeReadingProgressJournal(
      preferences,
      snapshot(1),
      { writerId: 'gap-writer', sequence: 1 },
    )

    for (let cycle = 1; cycle <= 100; cycle += 1) {
      const externalWriterId = `external-gap-writer-${cycle}`
      const external = await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 - 1),
        { writerId: externalWriterId, sequence: 3 },
      )
      expect(external.writerSequenceHasGap).toBe(true)
      const adopted = await adoptReadingProgressJournal(preferences, external, {
        writerId: 'gap-writer',
        sequence: cycle * 3,
        writtenAt: '2026-08-04T08:00:00.000Z',
      })
      expect(adopted.sourcesSettled).toBe(true)
      expect(await preferences.get(
        `reader-progress-journal-tombstone:v3:article-a:${externalWriterId}`,
      )).toMatchObject({
        sequence: 3,
        causalClosureSequence: 3,
      })
      await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 + 1),
        { writerId: 'gap-writer', sequence: cycle * 3 + 1 },
      )
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
    const recovered = await readReadingProgressJournal(
      preferences,
      'article-a',
      'attempt-a',
    )
    expect(recovered).toMatchObject({
      writerId: 'gap-writer',
      sequence: 301,
      writerGapLineages: [{ writerId: 'gap-writer', sequence: 301 }],
      currentSentenceId: 'article-a:s3',
    })
  })

  it('proves inherited gap lineages after a later carrier settles them', async () => {
    const preferences = new MemoryPreferencesStore()
    const snapshot = (activeDurationSec: number) => ({
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec,
    })
    await writeReadingProgressJournal(
      preferences,
      snapshot(1),
      { writerId: 'gap-writer', sequence: 1 },
    )
    const originalUpdate = preferences.update.bind(preferences)
    let blockedTombstoneKey: string | null = null
    preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      if (key === blockedTombstoneKey) {
        blockedTombstoneKey = null
        throw new Error('Initial lineage settlement was interrupted.')
      }
      return originalUpdate(key, updater)
    }

    for (let cycle = 1; cycle <= 50; cycle += 1) {
      const externalWriterId = `inherited-gap-writer-${cycle}`
      const external = await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 - 1),
        { writerId: externalWriterId, sequence: 3 },
      )
      blockedTombstoneKey
        = `reader-progress-journal-tombstone:v3:article-a:${externalWriterId}`
      const interrupted = await adoptReadingProgressJournal(preferences, external, {
        writerId: `intermediate-carrier-${cycle}`,
        sequence: 1,
      })
      expect(interrupted.sourcesSettled).toBe(false)

      const settled = await adoptReadingProgressJournal(
        preferences,
        interrupted.journal,
        { writerId: 'gap-writer', sequence: cycle * 3 },
      )
      expect(settled.sourcesSettled).toBe(true)
      expect(await preferences.get(
        `reader-progress-journal-tombstone:v3:article-a:${externalWriterId}`,
      )).toMatchObject({
        sequence: 3,
        causalClosureSequence: 3,
      })
      await writeReadingProgressJournal(
        preferences,
        snapshot(cycle * 3 + 1),
        { writerId: 'gap-writer', sequence: cycle * 3 + 1 },
      )
      let removed = 0
      do {
        removed = await compactReadingProgressJournalSlots(preferences, 'article-a')
      } while (removed > 0)
    }

    const operations = await preferences.listByPrefix(
      'reader-progress-journal:v4:article-a:',
    )
    expect(operations).toHaveLength(1)
    expect(JSON.stringify(operations).length).toBeLessThan(5_000)
  })

  it('keeps a delayed absorbed operation from reviving an older cursor', async () => {
    const preferences = new MemoryPreferencesStore()
    await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, { writerId: 'writer-a', sequence: 1 })
    const delayed = await preferences.get(
      'reader-progress-journal:v4:article-a:writer-a:1',
    )
    const latest = await writeReadingProgressJournal(preferences, {
      articleId: 'article-a',
      attemptId: 'attempt-a',
      baseAttemptRevision: 1,
      cursorMutation: false,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
    }, { writerId: 'writer-a', sequence: 2 })
    expect(await preferences.get(
      'reader-progress-journal:v4:article-a:writer-a:1',
    )).toBeNull()

    await preferences.set(
      'reader-progress-journal:v4:article-a:writer-a:1',
      delayed,
    )
    expect(await readReadingProgressJournal(preferences, 'article-a', 'attempt-a', 1))
      .toMatchObject({
        writerId: 'writer-a',
        sequence: 2,
        writerSequenceHighWater: 1,
        cursorMutation: false,
        currentSentenceId: latest.currentSentenceId,
      })
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
    expect(await preferences.listByPrefix('reader-progress-journal:v4:article-a:'))
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

class NonLinearizableCompactionPreferencesStore extends MemoryPreferencesStore {
  private pauseCompareAndRemove = false
  private resolveStarted: (() => void) | null = null
  private resumeCompareAndRemove: Promise<void> = Promise.resolve()
  private resolveResume: (() => void) | null = null

  pauseNextCompareAndRemove(): { started: Promise<void>, release: () => void } {
    this.pauseCompareAndRemove = true
    const started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve
    })
    this.resumeCompareAndRemove = new Promise<void>((resolve) => {
      this.resolveResume = resolve
    })
    return {
      started,
      release: () => this.resolveResume?.(),
    }
  }

  override async compareAndRemove<T>(key: string, expected: T): Promise<boolean> {
    if (!this.pauseCompareAndRemove) {
      return super.compareAndRemove(key, expected)
    }
    this.pauseCompareAndRemove = false
    const matched = JSON.stringify(this.getImmediately(key)) === JSON.stringify(expected)
    this.resolveStarted?.()
    await this.resumeCompareAndRemove
    if (!matched) {
      return false
    }
    await this.remove(key)
    return true
  }
}
