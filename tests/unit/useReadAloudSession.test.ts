import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'

import { sampleArticle } from '@/features/article/sampleArticle'
import type { DailyArticle } from '@/features/article/types'
import type { SentencePlayer } from '@/features/player/useReadAloudSession'
import { useReadAloudSession } from '@/features/player/useReadAloudSession'
import { createConfiguredSentencePlayer } from '@/features/tts/configuredSentencePlayer'
import { defaultTtsSettings, type TtsSettings } from '@/features/tts/settings'
import type { TtsEndpointResponse } from '@/features/tts/types'
import type { RemoteServicesAdapter } from '@/platform/contracts'

describe('useReadAloudSession', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sets active sentence and advances after a calm inter-sentence pause', () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    const playedSentences: Array<{ text: string, language: string }> = []
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded, text, language }) => {
        callbacks.push(onEnded)
        playedSentences.push({ text, language })
        return { stop: vi.fn() }
      }),
    }

    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s1')
    expect(session.activeSentenceId.value).toBe('s1')
    expect(session.isPlaying.value).toBe(true)
    expect(playedSentences[0]).toEqual({
      text: 'A short walk can change the shape of a difficult afternoon.',
      language: 'en',
    })

    callbacks[0]?.()
    expect(session.activeSentenceId.value).toBe('s1')
    expect(playedSentences).toHaveLength(1)

    vi.advanceTimersByTime(599)
    expect(session.activeSentenceId.value).toBe('s1')
    expect(playedSentences).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(session.activeSentenceId.value).toBe('s2')
    expect(playedSentences[1]).toEqual({
      text: 'Your eyes leave the screen, and your breathing becomes easier.',
      language: 'en',
    })
    vi.useRealTimers()
  })

  it('uses a longer pause across paragraph-style sentence ids', () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded }) => {
        callbacks.push(onEnded)
        return { stop: vi.fn() }
      }),
    }
    const article: DailyArticle = {
      ...sampleArticle,
      sentences: [
        { ...sampleArticle.sentences[0]!, id: 'p1-s1' },
        { ...sampleArticle.sentences[1]!, id: 'p2-s1' },
      ],
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(article), player)

    session.play('p1-s1')
    callbacks[0]?.()

    vi.advanceTimersByTime(1099)
    expect(session.activeSentenceId.value).toBe('p1-s1')

    vi.advanceTimersByTime(1)
    expect(session.activeSentenceId.value).toBe('p2-s1')
    vi.useRealTimers()
  })

  it('scales the automatic pause by playback speed', () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded }) => {
        callbacks.push(onEnded)
        return { stop: vi.fn() }
      }),
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.setPlaybackRate(1.5)
    session.play('s1')
    callbacks[0]?.()

    vi.advanceTimersByTime(399)
    expect(session.activeSentenceId.value).toBe('s1')

    vi.advanceTimersByTime(1)
    expect(session.activeSentenceId.value).toBe('s2')
    vi.useRealTimers()
  })

  it('keeps manual next immediate during an automatic pause', () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded }) => {
        callbacks.push(onEnded)
        return { stop: vi.fn() }
      }),
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s1')
    callbacks[0]?.()
    session.next()

    expect(session.activeSentenceId.value).toBe('s2')
    expect(player.playSentence).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(600)
    expect(session.activeSentenceId.value).toBe('s2')
    expect(player.playSentence).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('anchors prefetch while async current-sentence audio is still loading', async () => {
    let resolvePlayback!: (handle: { stop: () => void }) => void
    const prefetchSentences = vi.fn()
    const player: SentencePlayer = {
      playSentence: vi.fn(() =>
        new Promise((resolve) => {
          resolvePlayback = resolve
        }),
      ),
      prefetchSentences,
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s1')

    expect(session.audioStatus.value).toBe('loading')
    expect(prefetchSentences).toHaveBeenCalledWith({
      language: 'en',
      sentences: [
        { id: 's2', original: sampleArticle.sentences[1]!.original, textHash: sampleArticle.sentences[1]!.textHash },
        { id: 's3', original: sampleArticle.sentences[2]!.original, textHash: sampleArticle.sentences[2]!.textHash },
      ],
    })
    expect(player.playSentence).toHaveBeenCalledTimes(1)

    resolvePlayback({ stop: vi.fn() })
    await Promise.resolve()
  })

  it('pauses without changing the active sentence and can repeat it', () => {
    const stop = vi.fn()
    const player: SentencePlayer = {
      playSentence: vi.fn(() => ({ stop })),
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(sampleArticle), player)

    session.play('s2')
    session.pause()

    expect(stop).toHaveBeenCalled()
    expect(session.activeSentenceId.value).toBe('s2')
    expect(session.isPlaying.value).toBe(false)

    session.repeat()
    expect(session.activeSentenceId.value).toBe('s2')
    expect(session.isPlaying.value).toBe(true)
  })

  it('cancels pending work on full stop, article changes, natural completion, and unmount', async () => {
    const callbacks: Array<() => void> = []
    const cancelPending = vi.fn()
    const clearCache = vi.fn()
    const player: SentencePlayer = {
      playSentence: vi.fn(({ onEnded }) => {
        callbacks.push(onEnded)
        return { stop: vi.fn() }
      }),
      cancelPending,
      clearCache,
    }
    const article = shallowRef<DailyArticle | null>(sampleArticle)
    let session!: ReturnType<typeof useReadAloudSession>
    const Root = defineComponent({
      setup() {
        session = useReadAloudSession(article, player)
        return () => h('div')
      },
    })
    const target = document.createElement('div')
    const app = createApp(Root)
    app.mount(target)

    session.play('s1')
    session.pause()
    expect(cancelPending).not.toHaveBeenCalled()

    session.stop()
    expect(cancelPending).toHaveBeenCalledTimes(1)

    article.value = { ...sampleArticle, id: 'replacement-article' }
    await nextTick()
    expect(cancelPending).toHaveBeenCalledTimes(2)

    const finalSentence = article.value.sentences.at(-1)!
    session.play(finalSentence.id)
    callbacks.at(-1)?.()
    expect(cancelPending).toHaveBeenCalledTimes(3)

    app.unmount()
    expect(cancelPending).toHaveBeenCalledTimes(4)
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('revokes an owned configured player Blob cache on teardown', async () => {
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:yomu-session-audio')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestUrl)

    const remote: RemoteServicesAdapter = {
      request: vi.fn(async () => ({
        audioBase64: btoa('mp3-bytes'),
        mimeType: 'audio/mpeg',
        durationMs: 1200,
      } satisfies TtsEndpointResponse)),
    }
    const browserPlayer: SentencePlayer = {
      playSentence: vi.fn(() => ({ stop: vi.fn() })),
    }
    const settings: TtsSettings = {
      ...defaultTtsSettings,
      provider: 'mimo',
      mimo: {
        ...defaultTtsSettings.mimo,
        apiKey: 'test-key',
      },
    }
    const configuredPlayer = createConfiguredSentencePlayer(() => settings, {
      browserPlayer,
      remote,
    })
    const article = shallowRef<DailyArticle | null>({
      ...sampleArticle,
      sentences: [sampleArticle.sentences[0]!],
    })
    let session!: ReturnType<typeof useReadAloudSession>
    const Root = defineComponent({
      setup() {
        session = useReadAloudSession(article, configuredPlayer)
        return () => h('div')
      },
    })
    const app = createApp(Root)
    app.mount(document.createElement('div'))

    session.play('s1')
    await vi.waitFor(() => expect(browserPlayer.playSentence).toHaveBeenCalledTimes(1))
    expect(browserPlayer.playSentence).toHaveBeenCalledWith(expect.objectContaining({
      audioUrl: 'blob:yomu-session-audio',
    }))

    app.unmount()

    await vi.waitFor(() => expect(TestUrl.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      'blob:yomu-session-audio',
    ))
  })

  it('keeps visual sentence focus and reports failed audio refs without playing', () => {
    const player: SentencePlayer = {
      playSentence: vi.fn(() => ({ stop: vi.fn() })),
    }
    const article: DailyArticle = {
      ...sampleArticle,
      sentences: [
        {
          ...sampleArticle.sentences[0]!,
          audioRef: { id: 'missing', url: 'missing://audio/s1', durationMs: 0 },
        },
      ],
    }
    const session = useReadAloudSession(shallowRef<DailyArticle | null>(article), player)

    session.play('s1')

    expect(session.activeSentenceId.value).toBe('s1')
    expect(session.isPlaying.value).toBe(false)
    expect(session.audioStatus.value).toBe('failed')
    expect(player.playSentence).not.toHaveBeenCalled()
  })
})
