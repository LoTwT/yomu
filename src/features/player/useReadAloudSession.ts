import type { Ref } from 'vue'
import { computed, onBeforeUnmount, readonly, shallowRef, watch } from 'vue'

import type { DailyArticle } from '@/features/article/types'

export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

export interface SentencePlaybackHandle {
  stop: () => void
}

export interface SentencePlayer {
  playSentence: (options: {
    sentenceId: string
    audioUrl: string
    durationMs: number
    playbackRate: number
    onEnded: () => void
  }) => SentencePlaybackHandle
}

export function createTimedSentencePlayer(): SentencePlayer {
  return {
    playSentence({ durationMs, playbackRate, onEnded }) {
      const timeout = window.setTimeout(onEnded, Math.max(1, durationMs / playbackRate))
      return {
        stop() {
          window.clearTimeout(timeout)
        },
      }
    },
  }
}

export function useReadAloudSession(
  article: Ref<DailyArticle | null>,
  player: SentencePlayer = createTimedSentencePlayer(),
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

  function stopCurrentPlayback() {
    currentPlayback?.stop()
    currentPlayback = null
  }

  function playSentenceByIndex(index: number) {
    const sentence = article.value?.sentences[index]
    if (!sentence) {
      stop()
      return
    }

    stopCurrentPlayback()
    activeSentenceId.value = sentence.id

    if (!isPlayableAudioRef(sentence.audioRef.url, sentence.audioRef.durationMs)) {
      isPlaying.value = false
      audioStatus.value = 'failed'
      return
    }

    audioStatus.value = 'loading'
    isPlaying.value = true
    currentPlayback = player.playSentence({
      sentenceId: sentence.id,
      audioUrl: sentence.audioRef.url,
      durationMs: sentence.audioRef.durationMs,
      playbackRate: playbackRate.value,
      onEnded: () => {
        playSentenceByIndex(index + 1)
      },
    })
    audioStatus.value = 'playing'
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
    stopCurrentPlayback()
    activeSentenceId.value = null
    isPlaying.value = false
    audioStatus.value = 'idle'
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

  watch(article, () => {
    stop()
  })

  onBeforeUnmount(() => {
    stopCurrentPlayback()
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
    setPlaybackRate,
  }
}

function isPlayableAudioRef(url: string, durationMs: number): boolean {
  return Boolean(url) && durationMs > 0 && !url.startsWith('missing://')
}
