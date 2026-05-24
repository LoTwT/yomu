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
    text: string
    language: string
    durationMs: number
    playbackRate: number
    onEnded: () => void
  }) => SentencePlaybackHandle
}

export function createBrowserSentencePlayer(): SentencePlayer {
  return {
    playSentence(options) {
      if (options.audioUrl.startsWith('fixture://')) {
        return playWithSpeechSynthesis(options)
      }

      return playWithAudioElement(options)
    },
  }
}

export function createTimedSentencePlayer(): SentencePlayer {
  return {
    playSentence(options) {
      return playWithTimer(options)
    },
  }
}

export function useReadAloudSession(
  article: Ref<DailyArticle | null>,
  player: SentencePlayer = createBrowserSentencePlayer(),
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
    const currentArticle = article.value
    const sentence = currentArticle?.sentences[index]
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
      text: sentence.original,
      language: currentArticle.language,
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

function playWithAudioElement(options: Parameters<SentencePlayer['playSentence']>[0]): SentencePlaybackHandle {
  const audio = new Audio(options.audioUrl)
  audio.playbackRate = options.playbackRate

  let stopped = false
  let fallbackPlayback: SentencePlaybackHandle | null = null

  const cleanup = () => {
    audio.removeEventListener('ended', handleEnded)
    audio.removeEventListener('error', handleError)
  }

  const startFallback = () => {
    if (stopped || fallbackPlayback) {
      return
    }

    cleanup()
    fallbackPlayback = playWithSpeechSynthesis(options)
  }

  function handleEnded() {
    if (stopped) {
      return
    }

    cleanup()
    options.onEnded()
  }

  function handleError() {
    startFallback()
  }

  audio.addEventListener('ended', handleEnded)
  audio.addEventListener('error', handleError)

  void audio.play().catch(startFallback)

  return {
    stop() {
      stopped = true
      cleanup()
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      fallbackPlayback?.stop()
    },
  }
}

function playWithSpeechSynthesis(options: Parameters<SentencePlayer['playSentence']>[0]): SentencePlaybackHandle {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    return playWithTimer(options)
  }

  const utterance = new SpeechSynthesisUtterance(options.text)
  utterance.lang = getSpeechLanguage(options.language)
  utterance.rate = options.playbackRate
  utterance.voice = selectLocalSpeechVoice(utterance.lang)

  let stopped = false
  const timeoutFallback = window.setTimeout(() => {
    if (!stopped) {
      window.speechSynthesis.cancel()
      options.onEnded()
    }
  }, Math.max(1000, options.durationMs / options.playbackRate + 1500))

  utterance.onend = () => {
    if (stopped) {
      return
    }

    window.clearTimeout(timeoutFallback)
    options.onEnded()
  }
  utterance.onerror = () => {
    if (stopped) {
      return
    }

    window.clearTimeout(timeoutFallback)
    options.onEnded()
  }

  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)

  return {
    stop() {
      stopped = true
      window.clearTimeout(timeoutFallback)
      window.speechSynthesis.cancel()
    },
  }
}

function playWithTimer(options: Parameters<SentencePlayer['playSentence']>[0]): SentencePlaybackHandle {
  const timeout = window.setTimeout(options.onEnded, Math.max(1, options.durationMs / options.playbackRate))
  return {
    stop() {
      window.clearTimeout(timeout)
    },
  }
}

function getSpeechLanguage(language: string): string {
  if (language.toLowerCase().startsWith('en')) {
    return 'en-US'
  }

  if (language.toLowerCase().startsWith('ja')) {
    return 'ja-JP'
  }

  return language
}

function selectLocalSpeechVoice(language: string): SpeechSynthesisVoice | null {
  if (typeof window.speechSynthesis.getVoices !== 'function') {
    return null
  }

  const baseLanguage = language.split('-')[0]
  return window.speechSynthesis.getVoices().find(voice =>
    voice.localService
    && (voice.lang === language || voice.lang.toLowerCase().startsWith(`${baseLanguage}-`)),
  ) ?? null
}
