import { createApp, shallowRef, type App as VueApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import { flushReadingPosition } from '@/features/reader/attemptCommands'
import {
  readReadingProgressJournal,
  writeReadingProgressJournal,
} from '@/features/reader/progressJournal'
import { useReadingSession } from '@/features/reader/useReadingSession'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import { MemoryPreferencesStore } from '@/platform/memoryStores'
import type { SpeechPlaybackHandle, SpeechRequest } from '@/platform/contracts'

type ReadingSession = ReturnType<typeof useReadingSession>

const mountedApps: VueApp[] = []
const timestamp = '2026-08-04T08:00:00.000Z'

afterEach(() => {
  vi.useRealTimers()
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('useReadingSession', () => {
  it('restores the saved reading sentence without restoring playback', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article, { currentSentenceId: 'article-a:s2' })
    const { session, harness } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
    })

    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBeNull()
    expect(session.isPlaying.value).toBe(false)
    expect(harness.speech.spoken).toHaveLength(0)
  })

  it('advances reading and playback together until the final sentence ends', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    await session.togglePlayback()

    expect(harness.speech.spoken.map(request => request.text)).toEqual([
      article.sentences[0]!.original,
    ])
    expect(session.currentSentenceId.value).toBe('article-a:s1')
    expect(session.playingSentenceId.value).toBe('article-a:s1')
    expect(session.isPlaying.value).toBe(true)

    harness.speech.finishActive()
    await vi.waitFor(() => expect(harness.speech.spoken).toHaveLength(2))
    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBe('article-a:s2')

    harness.speech.finishActive()
    await vi.waitFor(() => expect(harness.speech.spoken).toHaveLength(3))
    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.playingSentenceId.value).toBe('article-a:s3')

    harness.speech.finishActive()
    await vi.waitFor(() => expect(session.isPlaying.value).toBe(false))
    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.playingSentenceId.value).toBeNull()
  })

  it('restarts from a manually selected sentence and ignores stale speech callbacks', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    await session.togglePlayback()
    const staleEnd = harness.speech.spoken[0]!.onEnd
    const staleError = harness.speech.spoken[0]!.onError

    session.nextSentence()
    await vi.waitFor(() => expect(harness.speech.spoken).toHaveLength(2))

    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBe('article-a:s2')
    expect(harness.speech.cancelCount).toBeGreaterThanOrEqual(1)

    staleEnd?.()
    staleError?.(new Error('Cancelled speech callback.'))
    await Promise.resolve()
    expect(harness.speech.spoken).toHaveLength(2)
    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBe('article-a:s2')
    expect(session.errorMessage.value).toBe('')

    await session.togglePlayback()
    expect(session.isPlaying.value).toBe(false)
    expect(session.playingSentenceId.value).toBeNull()
    expect(session.currentSentenceId.value).toBe('article-a:s2')
  })

  it('does not revive or late-cancel playback when speech ends before its handle resolves', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    session.selectSentence('article-a:s3')

    let activeRequest: SpeechRequest | null = null
    let resolveHandle!: (handle: SpeechPlaybackHandle) => void
    let cancelCount = 0
    harness.speech.speak = (request) => {
      activeRequest = request
      request.onStart?.()
      return new Promise((resolve) => {
        resolveHandle = resolve
      })
    }

    const pendingPlayback = session.togglePlayback()
    await vi.waitFor(() => expect(activeRequest).not.toBeNull())
    const completedRequest = activeRequest as SpeechRequest | null
    completedRequest?.onEnd?.()
    resolveHandle({
      pause: () => {},
      resume: () => {},
      cancel: () => {
        cancelCount += 1
      },
    })
    await pendingPlayback

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.playingSentenceId.value).toBeNull()
    expect(session.isPlaying.value).toBe(false)
    expect(cancelCount).toBe(0)
  })

  it('starts the successor when an early-ended speech promise never settles', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const originalSpeak = harness.speech.speak.bind(harness.speech)
    let firstRequest: SpeechRequest | null = null
    let speakCount = 0
    harness.speech.speak = (request) => {
      speakCount += 1
      if (speakCount > 1) {
        return originalSpeak(request)
      }
      firstRequest = request
      request.onStart?.()
      return new Promise(() => {})
    }

    const firstPlayback = session.togglePlayback()
    await vi.waitFor(() => expect(firstRequest).not.toBeNull())
    const completedRequest = firstRequest as SpeechRequest | null
    completedRequest?.onEnd?.()
    await firstPlayback
    await vi.waitFor(() => expect(speakCount).toBe(2))
    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBe('article-a:s2')
  })

  it('does not let a late terminal handle cancel its successor', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const originalSpeak = harness.speech.speak.bind(harness.speech)
    let firstRequest: SpeechRequest | null = null
    let resolveFirstHandle!: (handle: SpeechPlaybackHandle) => void
    let speakCount = 0
    let lateCancelCount = 0
    harness.speech.speak = (request) => {
      speakCount += 1
      if (speakCount > 1) {
        return originalSpeak(request)
      }
      firstRequest = request
      request.onStart?.()
      return new Promise((resolve) => {
        resolveFirstHandle = resolve
      })
    }

    const firstPlayback = session.togglePlayback()
    await vi.waitFor(() => expect(firstRequest).not.toBeNull())
    const completedRequest = firstRequest as SpeechRequest | null
    completedRequest?.onEnd?.()
    await firstPlayback
    await vi.waitFor(() => expect(speakCount).toBe(2))

    resolveFirstHandle({
      pause: () => {},
      resume: () => {},
      cancel: () => {
        lateCancelCount += 1
        harness.speech.stop()
      },
    })
    await Promise.resolve()

    expect(lateCancelCount).toBe(0)
    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.playingSentenceId.value).toBe('article-a:s2')
  })

  it('unblocks the speech queue when an early error precedes a never-settling promise', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const originalSpeak = harness.speech.speak.bind(harness.speech)
    let firstRequest: SpeechRequest | null = null
    let speakCount = 0
    harness.speech.speak = (request) => {
      speakCount += 1
      if (speakCount > 1) {
        return originalSpeak(request)
      }
      firstRequest = request
      request.onStart?.()
      return new Promise(() => {})
    }

    const firstPlayback = session.togglePlayback()
    await vi.waitFor(() => expect(firstRequest).not.toBeNull())
    const failedRequest = firstRequest as SpeechRequest | null
    failedRequest?.onError?.(new Error('Early speech failure.'))
    await firstPlayback

    expect(session.isPlaying.value).toBe(false)
    await session.togglePlayback()
    expect(speakCount).toBe(2)
    expect(session.playingSentenceId.value).toBe('article-a:s1')
  })

  it('coalesces rapid speech restarts behind an unresolved handle', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const originalSpeak = harness.speech.speak.bind(harness.speech)
    let resolveFirstHandle!: (handle: SpeechPlaybackHandle) => void
    let speakCount = 0
    harness.speech.speak = (request) => {
      speakCount += 1
      if (speakCount > 1) {
        return originalSpeak(request)
      }
      request.onStart?.()
      return new Promise((resolve) => {
        resolveFirstHandle = resolve
      })
    }

    const firstPlayback = session.togglePlayback()
    await vi.waitFor(() => expect(speakCount).toBe(1))
    await session.togglePlayback()
    void session.togglePlayback()
    await session.togglePlayback()
    void session.togglePlayback()
    for (let index = 0; index < 48; index += 1) {
      session.selectSentence(index % 2 === 0 ? 'article-a:s2' : 'article-a:s3')
    }

    resolveFirstHandle({
      pause: () => {},
      resume: () => {},
      cancel: () => {},
    })
    await firstPlayback
    await Promise.resolve()

    expect(speakCount).toBe(2)
    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.playingSentenceId.value).toBe('article-a:s3')
  })

  it('starts the latest speech request even when a cancelled adapter promise never settles', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const originalSpeak = harness.speech.speak.bind(harness.speech)
    let speakCount = 0
    harness.speech.speak = (request) => {
      speakCount += 1
      if (speakCount === 1) {
        request.onStart?.()
        return new Promise(() => {})
      }
      return originalSpeak(request)
    }

    void session.togglePlayback()
    await vi.waitFor(() => expect(speakCount).toBe(1))
    await session.togglePlayback()
    await session.togglePlayback()

    await vi.waitFor(() => expect(speakCount).toBe(2))
    expect(session.isPlaying.value).toBe(true)
    expect(session.playingSentenceId.value).toBe('article-a:s1')
  })

  it('stops and persists on background, then stays paused when active again', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const article = createArticle('article-a')
    const { session, harness, repositories } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    session.selectSentence('article-a:s3')
    await session.togglePlayback()

    now = 3_500
    harness.lifecycle.emit('background')

    expect(session.isPlaying.value).toBe(false)
    expect(session.playingSentenceId.value).toBeNull()
    await session.suspend()
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 2,
    })

    harness.lifecycle.emit('active')
    await Promise.resolve()
    expect(session.isPlaying.value).toBe(false)
    expect(session.playingSentenceId.value).toBeNull()
    expect(harness.speech.spoken).toHaveLength(1)

    now = 5_500
    await session.suspend()
    expect(await repositories.attempts.getActiveByArticle(article.id))
      .toMatchObject({ activeDurationSec: 4 })
  })

  it.each([
    ['pagehide', 'pagehide'],
    ['system suspension', 'system'],
    ['window close', 'window-close'],
  ] as const)('writes a synchronous checkpoint during %s', async (_label, reason) => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    harness.preferences.update = <T>() => new Promise<T | null>(() => {})
    session.selectSentence('article-a:s2')
    const immediateUpdate = vi.spyOn(harness.preferences, 'updateImmediately')

    harness.lifecycle.emit('suspended', reason)

    expect(immediateUpdate).toHaveBeenCalledTimes(1)
    expect(session.isPlaying.value).toBe(false)
  })

  it('still writes a terminal checkpoint when speech cleanup throws', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    session.selectSentence('article-a:s2')
    harness.speech.speak = async (request) => {
      request.onStart?.()
      return {
        pause: () => {},
        resume: () => {},
        cancel: () => {
          throw new Error('Shell handle cleanup failed.')
        },
      }
    }
    await session.togglePlayback()
    const immediateUpdate = vi.spyOn(harness.preferences, 'updateImmediately')
    harness.speech.stop = () => {
      throw new Error('Shell speech cleanup failed.')
    }

    expect(() => harness.lifecycle.emit('suspended', 'pagehide')).not.toThrow()
    expect(immediateUpdate).toHaveBeenCalledTimes(1)
    expect(session.isPlaying.value).toBe(false)
  })

  it('latches a route transition, bounds its wait, and resumes without restarting speech', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    await session.togglePlayback()
    vi.useFakeTimers()
    harness.preferences.update = <T>() => new Promise<T | null>(() => {})

    const transition = session.beginRouteTransition()
    const sentenceAtTransition = session.currentSentenceId.value
    session.selectSentence('article-a:s3')
    await session.togglePlayback()

    expect(session.currentSentenceId.value).toBe(sentenceAtTransition)
    expect(session.isPlaying.value).toBe(false)
    await vi.advanceTimersByTimeAsync(750)
    await transition.ready

    session.resumeAfterFailedRouteTransition(transition.token)
    expect(session.isPlaying.value).toBe(false)
    session.selectSentence('article-a:s3')
    expect(session.currentSentenceId.value).toBe('article-a:s3')
    await session.togglePlayback()
    expect(session.playingSentenceId.value).toBe('article-a:s3')
  })

  it('repeats synchronous cleanup and counts foreground time while a prior save is pending', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const article = createArticle('article-a')
    const { session, harness, repositories } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    const transactionSpy = vi.spyOn(repositories, 'transaction')

    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const originalUpdate = harness.preferences.update.bind(harness.preferences)
    let blockedFirstWrite = false
    harness.preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      const result = await originalUpdate(key, updater)
      if (key.startsWith('reader-progress-journal:') && !blockedFirstWrite) {
        blockedFirstWrite = true
        markWriteStarted()
        await writeGate
      }
      return result
    }

    session.selectSentence('article-a:s2')
    await writeStarted
    now = 2_000
    harness.lifecycle.emit('background')
    now = 3_000
    harness.lifecycle.emit('active')
    await session.togglePlayback()
    expect(session.isPlaying.value).toBe(true)
    const cancelCountBeforeSecondBackground = harness.speech.cancelCount

    now = 5_000
    harness.lifecycle.emit('background')
    for (let index = 0; index < 24; index += 1) {
      harness.lifecycle.emit('background')
    }
    const stoppedOnSecondBackground = !session.isPlaying.value
    const cancelCountAfterSecondBackground = harness.speech.cancelCount
    releaseWrite()
    await session.suspend()

    expect(stoppedOnSecondBackground).toBe(true)
    expect(cancelCountAfterSecondBackground)
      .toBeGreaterThan(cancelCountBeforeSecondBackground)
    expect(transactionSpy).toHaveBeenCalledTimes(2)
    expect(await repositories.attempts.getActiveByArticle(article.id))
      .toMatchObject({ activeDurationSec: 3 })
  })

  it('reports an active speech error without moving the reading sentence', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    await session.togglePlayback()

    harness.speech.failActive()

    expect(session.currentSentenceId.value).toBe('article-a:s1')
    expect(session.playingSentenceId.value).toBeNull()
    expect(session.isPlaying.value).toBe(false)
    expect(session.errorMessage.value).toContain('朗读没有成功启动')
  })

  it('stops on unmount and ignores callbacks from the disposed reader', async () => {
    const article = createArticle('article-a')
    const { app, session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    await session.togglePlayback()
    const staleEnd = harness.speech.spoken[0]!.onEnd
    const staleError = harness.speech.spoken[0]!.onError

    mountedApps.splice(mountedApps.indexOf(app), 1)
    app.unmount()

    expect(session.playingSentenceId.value).toBeNull()
    expect(session.isPlaying.value).toBe(false)
    staleEnd?.()
    staleError?.(new Error('Late unmount callback.'))
    await Promise.resolve()
    expect(harness.speech.spoken).toHaveLength(1)
    expect(session.errorMessage.value).toBe('')
  })

  it('invalidates the previous article playback before loading another article', async () => {
    const firstArticle = createArticle('article-a')
    const secondArticle = createArticle('article-b')
    const { articleId, session, harness } = mountReadingSession({
      articles: [firstArticle, secondArticle],
    })
    await expectReady(session)
    await session.togglePlayback()
    const staleEnd = harness.speech.spoken[0]!.onEnd

    articleId.value = secondArticle.id
    await vi.waitFor(() => expect(session.article.value?.id).toBe(secondArticle.id))

    expect(session.currentSentenceId.value).toBe('article-b:s1')
    expect(session.playingSentenceId.value).toBeNull()
    expect(session.isPlaying.value).toBe(false)

    staleEnd?.()
    await Promise.resolve()
    expect(harness.speech.spoken).toHaveLength(1)
    expect(session.currentSentenceId.value).toBe('article-b:s1')
    expect(session.playingSentenceId.value).toBeNull()
  })

  it('freezes the previous article while its transition save is pending', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const firstArticle = createArticle('article-a')
    const secondArticle = createArticle('article-b')
    const { articleId, session, harness, repositories } = mountReadingSession({
      articles: [firstArticle, secondArticle],
    })
    await expectReady(session)

    let releaseRepository!: () => void
    let markRepositoryBlocked!: () => void
    const repositoryGate = new Promise<void>((resolve) => {
      releaseRepository = resolve
    })
    const repositoryBlocked = new Promise<void>((resolve) => {
      markRepositoryBlocked = resolve
    })
    const blockingTransaction = repositories.transaction(
      ['attempts'],
      'readwrite',
      async () => {
        markRepositoryBlocked()
        await repositoryGate
      },
    )
    await repositoryBlocked

    now = 11_000
    articleId.value = secondArticle.id
    await vi.waitFor(() => expect(session.status.value).toBe('loading'))
    const transitionSentenceId = session.currentSentenceId.value
    session.selectSentence('article-a:s3')
    await session.togglePlayback()

    expect(session.currentSentenceId.value).toBe(transitionSentenceId)
    expect(harness.speech.spoken).toHaveLength(0)

    releaseRepository()
    await blockingTransaction
    await vi.waitFor(() => expect(session.article.value?.id).toBe(secondArticle.id))
    expect(await repositories.attempts.getActiveByArticle(secondArticle.id))
      .toMatchObject({ activeDurationSec: 0 })
  })

  it('does not leak a stale journal recovery warning into the next article', async () => {
    const firstArticle = createArticle('article-a')
    const secondArticle = createArticle('article-b')
    const thirdArticle = createArticle('article-c')
    const secondAttempt = createAttempt(secondArticle)
    const { articleId, session, harness, repositories } = mountReadingSession({
      articles: [firstArticle, secondArticle, thirdArticle],
      attempts: [secondAttempt],
    })
    await expectReady(session)
    await writeReadingProgressJournal(harness.preferences, {
      articleId: secondArticle.id,
      attemptId: secondAttempt.id,
      baseAttemptRevision: secondAttempt.progressRevision ?? 0,
      cursorMutation: true,
      currentSentenceId: 'article-b:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 2,
    })

    let transactionCount = 0
    let releaseRecovery!: () => void
    let markRecoveryBlocked!: () => void
    let markRecoveryFailed!: () => void
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve
    })
    const recoveryBlocked = new Promise<void>((resolve) => {
      markRecoveryBlocked = resolve
    })
    const recoveryFailed = new Promise<void>((resolve) => {
      markRecoveryFailed = resolve
    })
    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (transactionCount === 3) {
        markRecoveryBlocked()
        await recoveryGate
        markRecoveryFailed()
        throw new Error('Delayed article B recovery failed.')
      }
      return originalTransaction(stores, mode, operation)
    }

    articleId.value = secondArticle.id
    await recoveryBlocked
    articleId.value = thirdArticle.id
    await vi.waitFor(() => expect(session.article.value?.id).toBe(thirdArticle.id))

    releaseRecovery()
    await recoveryFailed
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(session.article.value?.id).toBe(thirdArticle.id)
    expect(session.errorMessage.value).toBe('')
  })

  it('serializes refresh-protection writes so rapid selection cannot restore an older sentence', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    const writtenSentenceIds: string[] = []
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const originalUpdate = harness.preferences.update.bind(harness.preferences)
    harness.preferences.update = async <T>(key: string, updater: (
      current: unknown | null,
    ) => T | null) => {
      const result = await originalUpdate(key, (current) => {
        const next = updater(current)
        if (key.startsWith('reader-progress-journal:') && next) {
          const slot = next as { journal?: { currentSentenceId?: string } | null }
          writtenSentenceIds.push(slot.journal?.currentSentenceId ?? '')
        }
        return next
      })
      if (key.startsWith('reader-progress-journal:')) {
        if (writtenSentenceIds.length === 1) {
          await firstWriteGate
        }
      }
      return result
    }

    session.selectSentence('article-a:s2')
    await vi.waitFor(() => expect(writtenSentenceIds).toEqual(['article-a:s2']))
    session.selectSentence('article-a:s3')
    session.selectSentence('article-a:s1')
    session.selectSentence('article-a:s3')
    await Promise.resolve()
    expect(writtenSentenceIds).toEqual(['article-a:s2'])

    releaseFirstWrite()
    await vi.waitFor(() => expect(writtenSentenceIds).toEqual([
      'article-a:s2',
      'article-a:s3',
    ]))
  })

  it('keeps furthest progress monotonic when the cursor returns before debounce', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    session.selectSentence('article-a:s3')
    session.selectSentence('article-a:s1')

    expect(session.currentSentenceId.value).toBe('article-a:s1')
    expect(session.progress.value).toBe(99)
    await vi.waitFor(async () => expect(await readReadingProgressJournal(
      harness.preferences,
      article.id,
      session.attempt.value!.id,
    )).toMatchObject({
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 2,
    }))
  })

  it('keeps a post-recovery selection across a second database outage and reload', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article)
    const preferences = new MemoryPreferencesStore()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [attempt],
    })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'zz-recovered-writer',
      sequence: 1,
      writtenAt: timestamp,
    })

    let transactionCount = 0
    let rejectProgressTransactions = true
    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (rejectProgressTransactions && transactionCount > 1) {
        throw new Error('IndexedDB is temporarily unavailable.')
      }
      return originalTransaction(stores, mode, operation)
    }

    const first = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await expectReady(first.session)
    expect(first.session.currentSentenceId.value).toBe('article-a:s2')

    first.session.selectSentence('article-a:s3')
    await first.session.suspend()
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      0,
    )).toMatchObject({ currentSentenceId: 'article-a:s3' })

    rejectProgressTransactions = false
    const reloaded = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await expectReady(reloaded.session)

    expect(reloaded.session.currentSentenceId.value).toBe('article-a:s3')
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      progressRevision: 1,
    })
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      1,
    )).toBeNull()
  })

  it('blocks interaction with an unverified future-revision journal until storage recovers', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article)
    const preferences = new MemoryPreferencesStore()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [attempt],
    })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 99,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
    }, {
      writerId: 'future-writer',
      sequence: 1,
      writtenAt: timestamp,
    })

    let transactionCount = 0
    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (transactionCount > 1) {
        throw new Error('IndexedDB is temporarily unavailable.')
      }
      return originalTransaction(stores, mode, operation)
    }

    const { session } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await vi.waitFor(() => expect(session.status.value).toBe('error'))

    expect(session.article.value).toBeNull()
    expect(session.attempt.value).toBeNull()
    expect(session.currentSentenceId.value).toBe('')
    expect(session.errorMessage.value).toContain('暂时无法打开')
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      0,
    )).toMatchObject({
      writerId: 'future-writer',
      currentSentenceId: 'article-a:s3',
      baseAttemptRevision: 99,
    })
  })

  it('rebases an adopted same-epoch successor before retrying it after reload', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article)
    const preferences = new MemoryPreferencesStore()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [attempt],
    })
    const committedCheckpoint = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'original-writer',
      sequence: 1,
      writtenAt: timestamp,
    })
    await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: committedCheckpoint.baseAttemptRevision,
      cursorMutation: committedCheckpoint.cursorMutation,
      currentSentenceId: committedCheckpoint.currentSentenceId,
      furthestSentenceOrdinal: committedCheckpoint.furthestSentenceOrdinal,
      activeDurationSec: committedCheckpoint.activeDurationSec,
      journalOperationId: 'original-writer:1',
      journalEpochId: committedCheckpoint.epochId,
      journalGeneration: committedCheckpoint.generation,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, {
      writerId: 'original-writer',
      sequence: 2,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })

    let transactionCount = 0
    let rejectReplay = true
    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (rejectReplay && transactionCount > 1) {
        throw new Error('IndexedDB is temporarily unavailable.')
      }
      return originalTransaction(stores, mode, operation)
    }

    const first = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await expectReady(first.session)
    expect(first.session.currentSentenceId.value).toBe('article-a:s3')
    expect(first.session.errorMessage.value).toContain('恢复阅读位置')
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      1,
    )).toMatchObject({
      baseAttemptRevision: 1,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
    })

    rejectReplay = false
    const reloaded = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await expectReady(reloaded.session)

    expect(reloaded.session.currentSentenceId.value).toBe('article-a:s3')
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
      progressRevision: 2,
    })
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      2,
    )).toBeNull()
  })

  it('retires a stale merged candidate before replaying a valid same-writer successor', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article)
    const preferences = new MemoryPreferencesStore()
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [attempt],
    })
    const firstWriterCheckpoint = await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    }, {
      writerId: 'aa-valid-writer',
      sequence: 1,
      writtenAt: timestamp,
    })
    await flushReadingPosition(repositories, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: firstWriterCheckpoint.baseAttemptRevision,
      cursorMutation: firstWriterCheckpoint.cursorMutation,
      currentSentenceId: firstWriterCheckpoint.currentSentenceId,
      furthestSentenceOrdinal: firstWriterCheckpoint.furthestSentenceOrdinal,
      activeDurationSec: firstWriterCheckpoint.activeDurationSec,
      journalOperationId: 'aa-valid-writer:1',
      journalEpochId: firstWriterCheckpoint.epochId,
      journalGeneration: firstWriterCheckpoint.generation,
    })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
    }, {
      writerId: 'aa-valid-writer',
      sequence: 2,
      writtenAt: '2026-08-04T08:00:01.000Z',
    })
    await writeReadingProgressJournal(preferences, {
      articleId: article.id,
      attemptId: attempt.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 6,
    }, {
      writerId: 'zz-stale-writer',
      sequence: 1,
      writtenAt: '2026-08-04T08:00:02.000Z',
    })

    let transactionCount = 0
    let rejectReplay = true
    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (stores, mode, operation) => {
      transactionCount += 1
      if (rejectReplay && transactionCount > 1) {
        throw new Error('IndexedDB is temporarily unavailable.')
      }
      return originalTransaction(stores, mode, operation)
    }

    const { session } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      repositories,
      preferences,
    })
    await vi.waitFor(() => expect(session.status.value).toBe('error'))
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      1,
    )).toMatchObject({
      writerId: 'zz-stale-writer',
      currentSentenceId: 'article-a:s1',
    })

    rejectReplay = false
    await session.load()
    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
      progressRevision: 2,
      progressJournalId: 'aa-valid-writer:2',
    })
    expect(await readReadingProgressJournal(
      preferences,
      article.id,
      attempt.id,
      2,
    )).toBeNull()
  })

  it('ignores an older journal sequence left behind after cleanup fails', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article, {
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      progressRevision: 1,
      progressJournalId: 'writer-a:2',
    })
    const { session } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      prepareHarness: (harness) => {
        void harness.preferences.set('reader-progress-journal:v2:article-a', {
          schemaVersion: 2,
          epochId: 'epoch-a',
          attemptId: attempt.id,
          generation: 1,
          journal: {
            writerId: 'writer-a',
            sequence: 1,
            writtenAt: timestamp,
            articleId: article.id,
            attemptId: attempt.id,
            baseAttemptRevision: 0,
            cursorMutation: true,
            currentSentenceId: 'article-a:s2',
            furthestSentenceOrdinal: 1,
            activeDurationSec: 4,
          },
        })
      },
    })
    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.errorMessage.value).toBe('')
  })

  it('recovers a legacy v1 refresh-protection journal after upgrading', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article)
    const legacyJournal = {
      schemaVersion: 1,
      articleId: article.id,
      attemptId: attempt.id,
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 9,
    } as const
    const { session, harness, repositories } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      prepareHarness: (preparedHarness) => {
        void preparedHarness.preferences.set(
          'reader-progress-journal:v1:article-a',
          legacyJournal,
        )
      },
    })

    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.errorMessage.value).toBe('')
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 9,
    })
    expect(await readReadingProgressJournal(
      harness.preferences,
      article.id,
      attempt.id,
    )).toBeNull()
  })

  it('preserves a pending cursor and furthest progress during a duration-only checkpoint', async () => {
    const article = createArticle('article-a')
    const { session, harness } = mountReadingSession({ articles: [article] })
    await expectReady(session)
    const dirtyCursor = await writeReadingProgressJournal(harness.preferences, {
      articleId: article.id,
      attemptId: session.attempt.value!.id,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 4,
    }, {
      writerId: 'cursor-writer',
      sequence: 1,
      writtenAt: timestamp,
    })
    const durationCheckpoint = await writeReadingProgressJournal(harness.preferences, {
      articleId: article.id,
      attemptId: session.attempt.value!.id,
      baseAttemptRevision: 0,
      cursorMutation: false,
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 7,
    }, {
      writerId: 'duration-writer',
      sequence: 1,
      writtenAt: timestamp,
    })

    expect(durationCheckpoint).toMatchObject({
      currentSentenceId: 'article-a:s1',
      furthestSentenceOrdinal: 0,
      activeDurationSec: 7,
      cursorMutation: false,
    })
    expect(await readReadingProgressJournal(
      harness.preferences,
      article.id,
      session.attempt.value!.id,
      0,
    )).toMatchObject({
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 7,
      cursorMutation: true,
      generation: dirtyCursor.generation,
    })
  })

  it('does not replay an exactly covered cross-writer journal', async () => {
    const article = createArticle('article-a')
    const foreignJournal = {
      schemaVersion: 2,
      epochId: 'epoch-a',
      generation: 7,
      writerId: 'foreign-writer',
      sequence: 7,
      writtenAt: timestamp,
      articleId: article.id,
      attemptId: `${article.id}:attempt`,
      baseAttemptRevision: 0,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 1,
      activeDurationSec: 4,
    } as const
    const attempt = createAttempt(article, {
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
      progressRevision: 1,
      progressJournalId: 'current-writer:3',
      progressJournalEpochId: 'epoch-a',
      progressJournalGeneration: 7,
    })
    const { session } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      prepareHarness: (harness) => {
        void harness.preferences.set(
          'reader-progress-journal:v2:article-a',
          {
            schemaVersion: 2,
            epochId: foreignJournal.epochId,
            attemptId: foreignJournal.attemptId,
            generation: foreignJournal.generation,
            journal: {
              writerId: foreignJournal.writerId,
              sequence: foreignJournal.sequence,
              writtenAt: foreignJournal.writtenAt,
              articleId: foreignJournal.articleId,
              attemptId: foreignJournal.attemptId,
              baseAttemptRevision: foreignJournal.baseAttemptRevision,
              cursorMutation: foreignJournal.cursorMutation,
              currentSentenceId: foreignJournal.currentSentenceId,
              furthestSentenceOrdinal: foreignJournal.furthestSentenceOrdinal,
              activeDurationSec: foreignJournal.activeDurationSec,
            },
          },
        )
      },
    })

    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.attempt.value?.activeDurationSec).toBe(8)
    expect(session.errorMessage.value).toBe('')
  })

  it('replays an unproven cross-writer journal instead of ordering it by wall clock', async () => {
    const article = createArticle('article-a')
    const foreignJournal = {
      schemaVersion: 2,
      epochId: 'epoch-a',
      generation: 8,
      writerId: 'foreign-writer',
      sequence: 7,
      writtenAt: '2026-08-04T08:00:01.000Z',
      articleId: article.id,
      attemptId: `${article.id}:attempt`,
      baseAttemptRevision: 1,
      cursorMutation: true,
      currentSentenceId: 'article-a:s2',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 9,
    } as const
    const attempt = {
      ...createAttempt(article, {
        currentSentenceId: 'article-a:s3',
        furthestSentenceOrdinal: 2,
        activeDurationSec: 8,
        progressRevision: 1,
        progressJournalId: 'current-writer:3',
        progressJournalEpochId: 'epoch-a',
        progressJournalGeneration: 7,
      }),
    }
    const { session } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      prepareHarness: (harness) => {
        void harness.preferences.set(
          'reader-progress-journal:v2:article-a',
          {
            schemaVersion: 2,
            epochId: foreignJournal.epochId,
            attemptId: foreignJournal.attemptId,
            generation: foreignJournal.generation,
            journal: {
              writerId: foreignJournal.writerId,
              sequence: foreignJournal.sequence,
              writtenAt: foreignJournal.writtenAt,
              articleId: foreignJournal.articleId,
              attemptId: foreignJournal.attemptId,
              baseAttemptRevision: foreignJournal.baseAttemptRevision,
              cursorMutation: foreignJournal.cursorMutation,
              currentSentenceId: foreignJournal.currentSentenceId,
              furthestSentenceOrdinal: foreignJournal.furthestSentenceOrdinal,
              activeDurationSec: foreignJournal.activeDurationSec,
            },
          },
        )
      },
    })

    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s2')
    expect(session.attempt.value?.activeDurationSec).toBe(9)
    expect(session.errorMessage.value).toBe('')
  })

  it('rejects a stale journal after its storage epoch is reset', async () => {
    const article = createArticle('article-a')
    const attempt = createAttempt(article, {
      currentSentenceId: 'article-a:s3',
      furthestSentenceOrdinal: 2,
      activeDurationSec: 8,
      progressRevision: 6,
      progressJournalId: 'old-writer:5',
      progressJournalEpochId: 'old-epoch',
      progressJournalGeneration: 5,
    })
    const { session, harness, repositories } = mountReadingSession({
      articles: [article],
      attempts: [attempt],
      prepareHarness: (harness) => {
        void harness.preferences.set('reader-progress-journal:v2:article-a', {
          schemaVersion: 2,
          epochId: 'new-epoch',
          attemptId: attempt.id,
          generation: 1,
          journal: {
            writerId: 'new-writer',
            sequence: 1,
            writtenAt: timestamp,
            articleId: article.id,
            attemptId: attempt.id,
            baseAttemptRevision: 5,
            cursorMutation: true,
            currentSentenceId: 'article-a:s2',
            furthestSentenceOrdinal: 1,
            activeDurationSec: 9,
          },
        })
      },
    })

    await expectReady(session)

    expect(session.currentSentenceId.value).toBe('article-a:s3')
    expect(session.errorMessage.value).toBe('')
    expect(await repositories.attempts.getActiveByArticle(article.id)).toMatchObject({
      currentSentenceId: 'article-a:s3',
      activeDurationSec: 9,
      progressRevision: 6,
      progressJournalEpochId: 'old-epoch',
      progressJournalGeneration: 5,
    })
    expect(await readReadingProgressJournal(
      harness.preferences,
      article.id,
      attempt.id,
      6,
    )).toBeNull()
  })

  it('coalesces scheduled flushes while repository persistence is slow', async () => {
    const article = createArticle('article-a')
    const { session, repositories } = mountReadingSession({ articles: [article] })
    await expectReady(session)

    let releaseRepository!: () => void
    let markRepositoryBlocked!: () => void
    const repositoryGate = new Promise<void>((resolve) => {
      releaseRepository = resolve
    })
    const repositoryBlocked = new Promise<void>((resolve) => {
      markRepositoryBlocked = resolve
    })
    const blockingTransaction = repositories.transaction(
      ['attempts'],
      'readwrite',
      async () => {
        markRepositoryBlocked()
        await repositoryGate
      },
    )
    await repositoryBlocked
    const transactionSpy = vi.spyOn(repositories, 'transaction')
    vi.useFakeTimers()

    const sentenceIds = ['article-a:s2', 'article-a:s3', 'article-a:s1']
    for (let index = 0; index < 24; index += 1) {
      session.selectSentence(sentenceIds[index % sentenceIds.length]!)
      await vi.advanceTimersByTimeAsync(451)
    }
    const suspension = session.suspend()
    releaseRepository()
    await blockingTransaction
    await suspension

    expect(transactionSpy).toHaveBeenCalledTimes(2)
  })
})

function mountReadingSession(seed: {
  articles: ArticleRecord[]
  attempts?: ReadingAttempt[]
  repositories?: LocalRepositories
  preferences?: MemoryPreferencesStore
  prepareHarness?: (
    harness: ReturnType<typeof createFakePlatformServices>,
  ) => void
}) {
  const repositories = seed.repositories ?? createMemoryLocalRepositories({
    articles: seed.articles,
    attempts: seed.attempts,
  })
  const harness = createFakePlatformServices({ repositories })
  if (seed.preferences) {
    harness.preferences = seed.preferences
    harness.services.preferences = seed.preferences
  }
  seed.prepareHarness?.(harness)
  const articleId = shallowRef(seed.articles[0]!.id)
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
  return { app, articleId, session, harness, repositories }
}

async function expectReady(session: ReadingSession): Promise<void> {
  await vi.waitFor(() => expect(session.status.value).toBe('ready'))
}

function createArticle(id: string): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `${id}-content-hash`,
    title: `Reading article ${id}`,
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
      original: `This is ${id} sentence ${index}.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createAttempt(
  article: ArticleRecord,
  overrides: Partial<ReadingAttempt> = {},
): ReadingAttempt {
  return {
    id: `${article.id}:attempt`,
    articleId: article.id,
    currentSentenceId: article.sentences[0]!.id,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 0,
    progressRevision: 0,
    status: 'active',
    startedAt: timestamp,
    lastOpenedAt: timestamp,
    ...overrides,
  }
}
