/** @vitest-environment jsdom */

import { createApp, shallowRef, type App as VueApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import { readReadingProgressJournal } from '@/features/reader/progressJournal'
import { useReadingSession } from '@/features/reader/useReadingSession'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import { MemoryPreferencesStore } from '@/platform/memoryStores'

type ReadingSession = ReturnType<typeof useReadingSession>

const mountedApps: VueApp[] = []
const timestamp = '2026-08-10T08:00:00.000Z'

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('useReadingSession completion', () => {
  it('stops playback, persists the final snapshot once, and freezes the completed attempt', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const article = createArticle()
    const mounted = mountReadingSession(article)
    await expectReady(mounted.session)
    const attemptId = mounted.session.attempt.value!.id
    mounted.session.selectSentence(`${article.id}:s3`)
    await mounted.session.togglePlayback()
    expect(mounted.session.isPlaying.value).toBe(true)

    now = 4_600
    const firstCompletion = mounted.session.completeReading()
    const duplicateCompletion = mounted.session.completeReading()

    expect(duplicateCompletion).toBe(firstCompletion)
    expect(mounted.session.completionState.value).toBe('saving')
    expect(mounted.session.isPlaying.value).toBe(false)
    expect(mounted.harness.speech.cancelCount).toBeGreaterThanOrEqual(1)
    expect(mounted.harness.speech.stopCount).toBeGreaterThanOrEqual(1)

    const completed = await firstCompletion
    expect(completed).toMatchObject({
      id: attemptId,
      currentSentenceId: `${article.id}:s3`,
      furthestSentenceOrdinal: 2,
      activeDurationSec: 3,
      status: 'completed',
    })
    expect(mounted.session.completionState.value).toBe('completed')
    expect(mounted.session.progress.value).toBe(100)
    expect(await mounted.repositories.attempts.get(completed!.id)).toEqual(completed)
    expect(await mounted.repositories.attempts.getActiveByArticle(article.id)).toBeNull()
    await vi.waitFor(async () => expect(await readReadingProgressJournal(
      mounted.harness.preferences,
      article.id,
      completed!.id,
      completed!.progressRevision ?? 0,
    )).toBeNull())

    const spokenCount = mounted.harness.speech.spoken.length
    mounted.session.selectSentence(`${article.id}:s1`)
    await mounted.session.togglePlayback()
    expect(mounted.session.currentSentenceId.value).toBe(`${article.id}:s3`)
    expect(mounted.harness.speech.spoken).toHaveLength(spokenCount)

    const transactionSpy = vi.spyOn(mounted.repositories, 'transaction')
    mounted.harness.lifecycle.emit('background')
    mounted.harness.lifecycle.emit('active')
    await Promise.resolve()
    expect(transactionSpy).toHaveBeenCalledTimes(1)
    expect(transactionSpy.mock.calls[0]?.[0]).toEqual(['articles'])
    expect(transactionSpy.mock.calls[0]?.[1]).toBe('readonly')
  })

  it('keeps a failed completion readable and lets a later retry finish it', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const mounted = mountReadingSession(article, repositories)
    await expectReady(mounted.session)

    const originalTransaction = repositories.transaction.bind(repositories)
    let transactionCount = 0
    let rejectCompletion = true
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (rejectCompletion && transactionCount === 2) {
        throw new Error('Completion transaction failed.')
      }
      return originalTransaction(stores, mode, operation)
    }

    await expect(mounted.session.completeReading()).resolves.toBeNull()
    expect(mounted.session.completionState.value).toBe('error')
    expect(mounted.session.completionErrorMessage.value).toContain('当前进度仍会保留')
    expect(mounted.session.attempt.value?.status).toBe('active')
    expect(await repositories.attempts.getActiveByArticle(article.id)).not.toBeNull()
    expect(mounted.session.isPlaying.value).toBe(false)

    transactionCount = 0
    rejectCompletion = false
    const completed = await mounted.session.completeReading()
    expect(completed?.status).toBe('completed')
    expect(mounted.session.completionState.value).toBe('completed')
  })

  it('uses the final snapshot even when the ordinary position flush is unavailable', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const mounted = mountReadingSession(article, repositories)
    await expectReady(mounted.session)
    mounted.session.selectSentence(`${article.id}:s3`)

    const originalTransaction = repositories.transaction.bind(repositories)
    let transactionCount = 0
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (transactionCount === 1) {
        throw new Error('Position flush is unavailable.')
      }
      return originalTransaction(stores, mode, operation)
    }

    const completed = await mounted.session.completeReading()

    expect(completed).toMatchObject({
      currentSentenceId: `${article.id}:s3`,
      furthestSentenceOrdinal: 2,
      status: 'completed',
    })
    expect(mounted.session.completionState.value).toBe('completed')
    expect(mounted.session.errorMessage.value).toBe('')
    expect(await repositories.attempts.get(completed!.id)).toEqual(completed)
  })

  it('returns the already completed attempt without scheduling another durable completion', async () => {
    const article = createArticle()
    const mounted = mountReadingSession(article)
    await expectReady(mounted.session)

    const completed = await mounted.session.completeReading()
    const transactionSpy = vi.spyOn(mounted.repositories, 'transaction')
    const repeated = await mounted.session.completeReading()

    expect(repeated).toEqual(completed)
    expect(transactionSpy).not.toHaveBeenCalled()
  })

  it('does not complete an attempt after a route transition has already started', async () => {
    const article = createArticle()
    const mounted = mountReadingSession(article)
    await expectReady(mounted.session)

    const transition = mounted.session.beginRouteTransition()
    await expect(mounted.session.completeReading()).resolves.toBeNull()
    await transition.ready

    expect(mounted.session.completionState.value).toBe('idle')
    expect(await mounted.repositories.attempts.getActiveByArticle(article.id)).not.toBeNull()
  })

  it('restores the completed terminal state without silently starting a reread', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const firstMount = mountReadingSession(article, repositories)
    await expectReady(firstMount.session)
    const completed = await firstMount.session.completeReading()
    expect(completed?.status).toBe('completed')

    firstMount.app.unmount()
    mountedApps.splice(mountedApps.indexOf(firstMount.app), 1)
    const restored = mountReadingSession(article, repositories)
    await expectReady(restored.session)

    expect(restored.session.attempt.value).toEqual(completed)
    expect(restored.session.completionState.value).toBe('completed')
    expect(restored.session.progress.value).toBe(100)
    expect(await repositories.attempts.count()).toBe(1)
    expect(await repositories.attempts.getActiveByArticle(article.id)).toBeNull()
  })

  it('completes from the final snapshot when the journal drain never settles', async () => {
    const article = createArticle()
    const mounted = mountReadingSession(article)
    await expectReady(mounted.session)
    mounted.session.selectSentence(`${article.id}:s3`)
    mounted.harness.services.preferences = new NeverSettlingPreferencesStore()

    const completed = await mounted.session.completeReading()

    expect(completed).toMatchObject({
      currentSentenceId: `${article.id}:s3`,
      furthestSentenceOrdinal: 2,
      status: 'completed',
    })
    expect(mounted.session.completionState.value).toBe('completed')
  }, 3_000)

  it('stops and adopts a completion published by another session', async () => {
    const article = createArticle()
    const mounted = mountReadingSession(article)
    await expectReady(mounted.session)
    await mounted.session.togglePlayback()
    expect(mounted.session.isPlaying.value).toBe(true)
    const activeAttempt = mounted.session.attempt.value!
    const completedAttempt: ReadingAttempt & {
      status: 'completed'
      completedAt: string
    } = {
      ...activeAttempt,
      status: 'completed',
      completedAt: timestamp,
      lastOpenedAt: timestamp,
    }
    await mounted.repositories.attempts.put(completedAttempt)

    mounted.harness.readingAttemptEvents.publishCompleted({ attempt: completedAttempt })

    expect(mounted.session.attempt.value).toEqual(completedAttempt)
    expect(mounted.session.completionState.value).toBe('completed')
    expect(mounted.session.isPlaying.value).toBe(false)
    expect(mounted.harness.speech.cancelCount).toBeGreaterThanOrEqual(1)
    expect(mounted.harness.speech.stopCount).toBeGreaterThanOrEqual(1)
  })

  it('does not downgrade an external completion when the local completion later fails', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const mounted = mountReadingSession(article, repositories)
    await expectReady(mounted.session)
    const activeAttempt = mounted.session.attempt.value!
    const originalTransaction = repositories.transaction.bind(repositories)
    let transactionCount = 0
    let rejectLocalCompletion!: (reason?: unknown) => void
    const localCompletionGate = new Promise<never>((_resolve, reject) => {
      rejectLocalCompletion = reject
    })
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (transactionCount === 2) {
        return localCompletionGate
      }
      return originalTransaction(stores, mode, operation)
    }

    const localCompletion = mounted.session.completeReading()
    await vi.waitFor(() => expect(transactionCount).toBe(2))
    const completedAttempt: ReadingAttempt & {
      status: 'completed'
      completedAt: string
    } = {
      ...activeAttempt,
      status: 'completed',
      completedAt: timestamp,
      lastOpenedAt: timestamp,
    }
    await originalTransaction(['attempts'], 'readwrite', scope =>
      scope.attempts.put(completedAttempt))
    mounted.harness.readingAttemptEvents.publishCompleted({ attempt: completedAttempt })

    expect(mounted.session.completionState.value).toBe('completed')
    rejectLocalCompletion(new Error('The local completion lost the cross-tab race.'))

    await expect(localCompletion).resolves.toEqual(completedAttempt)
    expect(mounted.session.attempt.value).toEqual(completedAttempt)
    expect(mounted.session.completionState.value).toBe('completed')
    expect(mounted.session.completionErrorMessage.value).toBe('')
    await expect(mounted.session.completeReading()).resolves.toEqual(completedAttempt)
  })
})

function mountReadingSession(
  article: ArticleRecord,
  repositories: LocalRepositories = createMemoryLocalRepositories({ articles: [article] }),
) {
  const harness = createFakePlatformServices({ repositories })
  const articleId = shallowRef(article.id)
  let session: ReadingSession | undefined
  const app = createApp({
    setup() {
      session = useReadingSession(articleId)
      return () => null
    },
  })
  app.provide(platformServicesKey, harness.services)
  app.mount(document.createElement('div'))
  mountedApps.push(app)
  if (!session) {
    throw new Error('Reading session did not initialize.')
  }
  return { app, articleId, harness, repositories, session }
}

async function expectReady(session: ReadingSession): Promise<void> {
  await vi.waitFor(() => expect(session.status.value).toBe('ready'))
}

function createArticle(): ArticleRecord {
  const id = 'article-completion'
  return {
    id,
    schemaVersion: 2,
    contentHash: `${id}-content-hash`,
    title: 'A completed local reading',
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
      textHash: `${id}-sentence-${index}`,
      original: `This is completion sentence ${index}.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

class NeverSettlingPreferencesStore extends MemoryPreferencesStore {
  override update<T>(): Promise<T | null> {
    return new Promise(() => {})
  }
}
