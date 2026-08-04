import type { Ref } from 'vue'
import { computed, onBeforeUnmount, readonly, shallowRef, watch } from 'vue'

import type { ArticleSentence, DailyArticle } from '@/features/article/types'

export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

export interface SentencePlaybackHandle {
  stop: () => void
}

export interface SentencePlayer {
  playSentence: (options: {
    sentenceId: string
    audioUrl: string
    text: string
    textHash: string
    language: string
    durationMs: number
    playbackRate: number
    onEnded: () => void
  }) => SentencePlaybackHandle | Promise<SentencePlaybackHandle>
  prefetchSentences?: (options: {
    sentences: Array<Pick<ArticleSentence, 'id' | 'original' | 'textHash'>>
    language: string
  }) => void | Promise<void>
  cancelPending?: () => void | Promise<void>
  clearCache?: () => void | Promise<void>
}

export const sessionOwnedSentencePlayer: unique symbol = Symbol('session-owned-sentence-player')

/**
 * A player whose private resources transfer to the composable that receives it.
 * Shared or host-owned players must remain plain SentencePlayer instances.
 */
export interface SessionOwnedSentencePlayer extends SentencePlayer {
  readonly [sessionOwnedSentencePlayer]: true
  disposeOnSessionTeardown: () => void | Promise<void>
}

const sentencePauseMs = 600
const paragraphPauseMs = 1100

export function createTimedSentencePlayer(): SentencePlayer {
  return {
    playSentence(options) {
      return playWithTimer(options)
    },
  }
}

export function useReadAloudSession(
  article: Ref<DailyArticle | null>,
  player: SentencePlayer,
) {
  const activeSentenceId = shallowRef<string | null>(null)
  const isPlaying = shallowRef(false)
  const audioStatus = shallowRef<AudioStatus>('idle')
  const playbackRate = shallowRef(1)
  const currentIndex = computed(() => {
    if (!article.value || !activeSentenceId.value) {
      return -1
    }

    return article.value.sentences.findIndex(sentence => sentence.id === activeSentenceId.value)
  })

  let currentPlayback: SentencePlaybackHandle | null = null
  let advanceTimer: ReturnType<typeof setTimeout> | null = null
  let playbackRunId = 0

  function clearAdvanceTimer() {
    if (!advanceTimer) {
      return
    }

    globalThis.clearTimeout(advanceTimer)
    advanceTimer = null
  }

  function stopCurrentPlayback() {
    playbackRunId += 1
    clearAdvanceTimer()
    currentPlayback?.stop()
    currentPlayback = null
  }

  function cancelPendingPlayback() {
    runBestEffortLifecycleAction(() => player.cancelPending?.())
  }

  function disposePlayerOnTeardown() {
    if (!isSessionOwnedPlayer(player)) {
      cancelPendingPlayback()
      return
    }

    runBestEffortLifecycleAction(() => player.disposeOnSessionTeardown())
  }

  function resetPlaybackState() {
    stopCurrentPlayback()
    activeSentenceId.value = null
    isPlaying.value = false
    audioStatus.value = 'idle'
  }

  function playSentenceByIndex(index: number) {
    const currentArticle = article.value
    const sentence = currentArticle?.sentences[index]
    if (!sentence) {
      stop()
      return
    }

    stopCurrentPlayback()
    const runId = playbackRunId
    activeSentenceId.value = sentence.id

    if (!isPlayableAudioRef(sentence.audioRef.url, sentence.audioRef.durationMs)) {
      isPlaying.value = false
      audioStatus.value = 'failed'
      return
    }

    audioStatus.value = 'loading'
    isPlaying.value = true
    const playbackResult = player.playSentence({
      sentenceId: sentence.id,
      audioUrl: sentence.audioRef.url,
      text: sentence.original,
      textHash: sentence.textHash ?? sentence.id,
      language: currentArticle.language,
      durationMs: sentence.audioRef.durationMs,
      playbackRate: playbackRate.value,
      onEnded: () => {
        scheduleNextSentence(index)
      },
    })
    prefetchUpcomingSentences(index)

    if (!isPromiseLike(playbackResult)) {
      currentPlayback = playbackResult
      audioStatus.value = 'playing'
      return
    }

    void Promise.resolve(playbackResult)
      .then((playback) => {
        if (runId !== playbackRunId || activeSentenceId.value !== sentence.id) {
          playback.stop()
          return
        }

        currentPlayback = playback
        audioStatus.value = 'playing'
      })
      .catch(() => {
        if (runId !== playbackRunId || activeSentenceId.value !== sentence.id) {
          return
        }

        currentPlayback = null
        isPlaying.value = false
        audioStatus.value = 'failed'
      })
  }

  function scheduleNextSentence(index: number) {
    const pauseMs = getNextSentencePauseMs(index)
    if (pauseMs <= 0) {
      playSentenceByIndex(index + 1)
      return
    }

    isPlaying.value = true
    audioStatus.value = 'playing'
    advanceTimer = globalThis.setTimeout(() => {
      advanceTimer = null
      playSentenceByIndex(index + 1)
    }, pauseMs)
  }

  function prefetchUpcomingSentences(index: number) {
    const currentArticle = article.value
    if (!currentArticle || !player.prefetchSentences) {
      return
    }

    const sentences = currentArticle.sentences
      .slice(index + 1, index + 3)
      .filter(sentence => isPlayableAudioRef(sentence.audioRef.url, sentence.audioRef.durationMs))
      .map(sentence => ({
        id: sentence.id,
        original: sentence.original,
        textHash: sentence.textHash,
      }))

    if (sentences.length === 0) {
      return
    }

    void Promise.resolve(player.prefetchSentences({
      sentences,
      language: currentArticle.language,
    })).catch(() => {
      // Prefetch is opportunistic; active sentence playback owns user-visible failure state.
    })
  }

  function play(sentenceId = activeSentenceId.value ?? article.value?.sentences[0]?.id) {
    const index = article.value?.sentences.findIndex(sentence => sentence.id === sentenceId) ?? -1
    playSentenceByIndex(index >= 0 ? index : 0)
  }

  function pause() {
    stopCurrentPlayback()
    isPlaying.value = false
    audioStatus.value = activeSentenceId.value ? 'paused' : 'idle'
  }

  function stop() {
    resetPlaybackState()
    cancelPendingPlayback()
  }

  function clearCache() {
    resetPlaybackState()
    return player.clearCache?.()
  }

  function next() {
    const lastIndex = (article.value?.sentences.length ?? 1) - 1
    playSentenceByIndex(Math.min(currentIndex.value + 1, lastIndex))
  }

  function previous() {
    playSentenceByIndex(Math.max(currentIndex.value - 1, 0))
  }

  function repeat() {
    play(activeSentenceId.value ?? article.value?.sentences[0]?.id)
  }

  function setPlaybackRate(nextRate: number) {
    playbackRate.value = nextRate
    if (isPlaying.value && activeSentenceId.value) {
      repeat()
    }
  }

  function getNextSentencePauseMs(index: number): number {
    const currentArticle = article.value
    if (!currentArticle || index >= currentArticle.sentences.length - 1) {
      return 0
    }

    const basePause = isParagraphBoundary(index) ? paragraphPauseMs : sentencePauseMs
    return Math.round(basePause / playbackRate.value)
  }

  function isParagraphBoundary(index: number): boolean {
    const currentArticle = article.value
    const sentence = currentArticle?.sentences[index]
    const nextSentence = currentArticle?.sentences[index + 1]

    if (!sentence || !nextSentence) {
      return false
    }

    return getSentenceGroup(sentence.id) !== getSentenceGroup(nextSentence.id)
  }

  watch(article, () => {
    stop()
  })

  onBeforeUnmount(() => {
    stopCurrentPlayback()
    disposePlayerOnTeardown()
  })

  return {
    activeSentenceId: readonly(activeSentenceId),
    isPlaying: readonly(isPlaying),
    audioStatus: readonly(audioStatus),
    playbackRate: readonly(playbackRate),
    currentIndex,
    play,
    pause,
    next,
    previous,
    repeat,
    stop,
    clearCache,
    setPlaybackRate,
  }
}

function isSessionOwnedPlayer(player: SentencePlayer): player is SessionOwnedSentencePlayer {
  return (player as Partial<SessionOwnedSentencePlayer>)[sessionOwnedSentencePlayer] === true
}

function runBestEffortLifecycleAction(action: () => void | Promise<void> | undefined): void {
  try {
    void Promise.resolve(action()).catch(() => {
      // Playback is already stopped; lifecycle cleanup must not block component teardown.
    })
  }
  catch {
    // Playback is already stopped; lifecycle cleanup must not block component teardown.
  }
}

function isPlayableAudioRef(url: string, durationMs: number): boolean {
  return Boolean(url) && (durationMs > 0 || url.startsWith('missing://tts-consent-required/'))
}

function getSentenceGroup(sentenceId: string): string {
  const paragraphMatch = /^(.+)-s\d+$/i.exec(sentenceId)
  return paragraphMatch?.[1] ?? 'default'
}

function isPromiseLike(value: SentencePlaybackHandle | Promise<SentencePlaybackHandle>): value is Promise<SentencePlaybackHandle> {
  return typeof (value as Promise<SentencePlaybackHandle>).then === 'function'
}

function playWithTimer(options: Parameters<SentencePlayer['playSentence']>[0]): SentencePlaybackHandle {
  const timeout = globalThis.setTimeout(options.onEnded, Math.max(1, options.durationMs / options.playbackRate))
  return {
    stop() {
      globalThis.clearTimeout(timeout)
    },
  }
}
