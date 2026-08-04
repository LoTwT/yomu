import type { SentencePlaybackHandle, SentencePlayer } from '@/features/player/useReadAloudSession'

export function createLegacyBrowserSentencePlayer(): SentencePlayer {
  return {
    playSentence(options) {
      if (options.audioUrl.startsWith('fixture://') || options.audioUrl.startsWith('webspeech://')) {
        return playWithSpeechSynthesis(options)
      }

      return playWithAudioElement(options)
    },
  }
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
    if (!stopped) {
      cleanup()
      options.onEnded()
    }
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
    if (!stopped) {
      window.clearTimeout(timeoutFallback)
      options.onEnded()
    }
  }
  utterance.onerror = () => {
    if (!stopped) {
      window.clearTimeout(timeoutFallback)
      options.onEnded()
    }
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
