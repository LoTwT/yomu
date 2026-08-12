import { describe, expect, it } from 'vitest'

import {
  clearRetiredReadingProgressJournals,
  createReadingProgressJournal,
  markReadingProgressArticleRetired,
  readReadingProgressJournal,
  ReadingProgressJournalArticleRetiredError,
  retireReadingProgressJournalsForArticle,
  retryRetiredReadingProgressJournalCleanup,
  storeReadingProgressJournal,
  storeReadingProgressJournalImmediately,
} from '@/features/reader/progressJournal'
import { MemoryPreferencesStore } from '@/platform/memoryStores'
import type { PreferencesStore } from '@/platform/contracts'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'

describe('reading progress journal article cleanup', () => {
  it('removes every journal generation for one article without touching another', async () => {
    const harness = createFakePlatformServices()
    const removedArticleId = 'article cleanup/one'
    const keptArticleId = 'article-cleanup-two'
    const removedPrefix = encodeURIComponent(removedArticleId)
    const seededKeys = [
      `reader-progress-journal:v1:${removedPrefix}`,
      `reader-progress-journal:v2:${removedPrefix}`,
      `reader-progress-journal:v3:${removedPrefix}:writer-a`,
      `reader-progress-journal:v4:${removedPrefix}:writer-a:1`,
      `reader-progress-journal-tombstone:v3:${removedPrefix}:writer-a`,
      `reader-progress-journal:v4:${encodeURIComponent(keptArticleId)}:writer-b:1`,
    ]
    await Promise.all(seededKeys.map(key => harness.preferences.set(key, { key })))

    await retireReadingProgressJournalsForArticle(harness.preferences, removedArticleId)

    await Promise.all(seededKeys.slice(0, 5).map(async key => {
      expect(await harness.preferences.get(key)).toBeNull()
    }))
    expect(await harness.preferences.get(seededKeys[5]!)).toEqual({ key: seededKeys[5] })
    expect(await harness.preferences.listByPrefix(
      'reader-progress-journal-retired-article:v1:',
    )).toHaveLength(1)
  })

  it('rejects an invalid article id before touching preferences', async () => {
    const harness = createFakePlatformServices()
    await expect(retireReadingProgressJournalsForArticle(harness.preferences, ''))
      .rejects.toThrow('valid article ID')
  })

  it('retires an article across a delayed writer and rejects every later write', async () => {
    const base = new MemoryPreferencesStore()
    const gate = gateNextJournalUpdate(base)
    const draft = createReadingProgressJournal({
      articleId: 'article-retired-race',
      attemptId: 'attempt-retired-race',
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'sentence-retired-race',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 12,
    }, {
      writerId: 'writer-retired-race',
      sequence: 1,
      writtenAt: '2026-08-11T00:00:00.000Z',
    })
    const delayedWrite = storeReadingProgressJournal(gate.preferences, draft)
    await gate.updateStarted

    await retireReadingProgressJournalsForArticle(base, draft.articleId)
    gate.releaseUpdate()

    await expect(delayedWrite).rejects.toBeInstanceOf(
      ReadingProgressJournalArticleRetiredError,
    )
    expect(await base.listByPrefix(
      `reader-progress-journal:v4:${encodeURIComponent(draft.articleId)}:`,
    )).toEqual([])
    expect(await readReadingProgressJournal(
      base,
      draft.articleId,
      draft.attemptId,
    )).toBeNull()
    await expect(storeReadingProgressJournal(base, {
      ...draft,
      sequence: 2,
    })).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
    expect(() => storeReadingProgressJournalImmediately(base, {
      ...draft,
      sequence: 3,
    })).toThrow(ReadingProgressJournalArticleRetiredError)
  })

  it('keeps a committed marker and retries an interrupted physical cleanup', async () => {
    const base = new MemoryPreferencesStore()
    const articleId = 'article-cleanup-retry'
    const operationKey = `reader-progress-journal:v4:${encodeURIComponent(articleId)}:writer:1`
    await base.set(operationKey, { articleId })
    await markReadingProgressArticleRetired(base, articleId)
    const failing = failRemoveForKey(base, operationKey)

    await expect(clearRetiredReadingProgressJournals(failing, articleId))
      .rejects.toThrow('remove failed')
    expect(await base.get(operationKey)).not.toBeNull()

    await retryRetiredReadingProgressJournalCleanup(base)
    expect(await base.get(operationKey)).toBeNull()
    await expect(storeReadingProgressJournal(base, createReadingProgressJournal({
      articleId,
      attemptId: 'attempt-cleanup-retry',
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'sentence-cleanup-retry',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 0,
    }, {
      writerId: 'writer-cleanup-retry',
      sequence: 1,
    }))).rejects.toBeInstanceOf(ReadingProgressJournalArticleRetiredError)
  })
})

function gateNextJournalUpdate(base: MemoryPreferencesStore): {
  preferences: PreferencesStore
  updateStarted: Promise<void>
  releaseUpdate: () => void
} {
  let reportUpdateStarted!: () => void
  let releaseUpdate!: () => void
  const updateStarted = new Promise<void>((resolve) => {
    reportUpdateStarted = resolve
  })
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve
  })
  let shouldGate = true
  const preferences: PreferencesStore = {
    persistence: base.persistence,
    get: base.get.bind(base),
    getImmediately: base.getImmediately.bind(base),
    listByPrefix: base.listByPrefix.bind(base),
    set: base.set.bind(base),
    async update(key, updater) {
      if (shouldGate && key.startsWith('reader-progress-journal:v4:')) {
        shouldGate = false
        reportUpdateStarted()
        await updateGate
      }
      return base.update(key, updater)
    },
    updateImmediately: base.updateImmediately.bind(base),
    compareAndRemove: base.compareAndRemove.bind(base),
    remove: base.remove.bind(base),
    clear: base.clear.bind(base),
  }
  return {
    preferences,
    updateStarted,
    releaseUpdate,
  }
}

function failRemoveForKey(
  base: MemoryPreferencesStore,
  failingKey: string,
): PreferencesStore {
  let shouldFail = true
  return {
    persistence: base.persistence,
    get: base.get.bind(base),
    getImmediately: base.getImmediately.bind(base),
    listByPrefix: base.listByPrefix.bind(base),
    set: base.set.bind(base),
    update: base.update.bind(base),
    updateImmediately: base.updateImmediately.bind(base),
    compareAndRemove: base.compareAndRemove.bind(base),
    async remove(key) {
      if (shouldFail && key === failingKey) {
        shouldFail = false
        throw new Error('remove failed')
      }
      await base.remove(key)
    },
    clear: base.clear.bind(base),
  }
}
