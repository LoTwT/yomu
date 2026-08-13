import type {
  AudioPlaybackAdapter,
  CloudSpeechAdapter,
  CloudSpeechSessionAdapter,
  CloudSpeechSynthesisRequest,
  SpeechAdapter,
  SpeechPlaybackHandle,
} from '@/platform/contracts'

import {
  getActiveTtsProvider,
  type TtsSettings,
} from './settings'
import type {
  TtsProviderId,
} from './types'

export interface ReadingSpeechSentence {
  id: string
  original: string
  textHash: string
}

export interface ReadingSpeechRequest extends ReadingSpeechSentence {
  cacheAllowed: boolean
  cloudConsentGranted?: boolean
  language: string
  playbackRate: number
  signal: AbortSignal
  onStart: () => void
  onEnd: () => void
  onError: (error: Error) => void
}

export interface ReadingSpeechEngine {
  activeProvider: () => TtsProviderId
  isAvailable: () => boolean
  playSentence: (request: ReadingSpeechRequest) => Promise<SpeechPlaybackHandle>
  playSystemSentence: (request: ReadingSpeechRequest) => Promise<SpeechPlaybackHandle>
  prefetchSentences: (
    sentences: readonly ReadingSpeechSentence[],
    cloudConsentGranted?: boolean,
  ) => Promise<void>
  stop: () => void
  clearCache: () => Promise<void>
  dispose: () => Promise<void>
}

export function createReadingSpeechEngine(options: {
  speech: SpeechAdapter
  audio: AudioPlaybackAdapter
  cloudSpeech: CloudSpeechAdapter
  getSettings: () => TtsSettings
}): ReadingSpeechEngine {
  let mimoProvider: CloudSpeechSessionAdapter | null = null
  let generation = 0

  function assertCurrentGeneration(
    expectedGeneration: number,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted) {
      throw readAbortReason(signal)
    }
    if (expectedGeneration !== generation) {
      const error = new Error('Speech playback was invalidated.')
      error.name = 'AbortError'
      throw error
    }
  }

  function getMimoProvider(): CloudSpeechSessionAdapter {
    if (mimoProvider) {
      return mimoProvider
    }
    if (!options.cloudSpeech.isAvailable()) {
      throw new Error('Cloud speech is unavailable on this platform.')
    }
    mimoProvider = options.cloudSpeech.createSession({
      provider: 'mimo',
      getCredentials: () => {
        const settings = options.getSettings()
        return {
          apiKey: settings.mimo.apiKey,
          baseUrl: settings.mimo.baseUrl,
        }
      },
      maxCachedSentences: 3,
    })
    return mimoProvider
  }

  function activeProvider(): TtsProviderId {
    return getActiveTtsProvider(options.getSettings())
  }

  function playSystemSentence(
    request: ReadingSpeechRequest,
  ): Promise<SpeechPlaybackHandle> {
    return options.speech.speak({
      text: request.original,
      language: request.language,
      rate: request.playbackRate,
      signal: request.signal,
      onStart: request.onStart,
      onEnd: request.onEnd,
      onError: request.onError,
    })
  }

  async function playSentence(
    request: ReadingSpeechRequest,
  ): Promise<SpeechPlaybackHandle> {
    if (activeProvider() === 'webspeech') {
      return playSystemSentence(request)
    }

    assertCloudConsent(request.cloudConsentGranted)
    if (!options.audio.isAvailable()) {
      throw new Error('Audio playback is unavailable on this platform.')
    }
    const requestGeneration = generation
    const provider = getMimoProvider()
    assertCurrentGeneration(requestGeneration, request.signal)
    const handleAbort = (): void => {
      generation += 1
      provider.cancelPending()
    }
    request.signal.addEventListener('abort', handleAbort, { once: true })
    try {
      const settings = options.getSettings()
      const synthesisRequest: CloudSpeechSynthesisRequest = {
        ...createMimoSynthesisBase(settings),
        sentenceId: request.id,
        text: request.original,
        textHash: request.textHash,
        language: 'en',
      }
      const result = await provider.synthesizeSentence(synthesisRequest)
      assertCurrentGeneration(requestGeneration, request.signal)
      try {
        const handle = await options.audio.play({
          sourceUrl: result.audioUrl,
          playbackRate: request.playbackRate,
          signal: request.signal,
          onStart: request.onStart,
          onEnd: request.onEnd,
          onError: (error) => {
            void provider.invalidateSentence(synthesisRequest)
              .catch(() => undefined)
              .then(() => request.onError(error))
          },
        })
        if (!request.cacheAllowed) {
          await provider.invalidateSentence(synthesisRequest)
        }
        return handle
      }
      catch (error) {
        await provider.invalidateSentence(synthesisRequest).catch(() => undefined)
        throw error
      }
    }
    finally {
      request.signal.removeEventListener('abort', handleAbort)
    }
  }

  async function prefetchSentences(
    sentences: readonly ReadingSpeechSentence[],
    cloudConsentGranted = false,
  ): Promise<void> {
    if (activeProvider() !== 'mimo' || sentences.length === 0) {
      return
    }
    assertCloudConsent(cloudConsentGranted)
    if (!options.audio.isAvailable()) {
      throw new Error('Audio playback is unavailable on this platform.')
    }
    const settings = options.getSettings()
    const base = createMimoSynthesisBase(settings)
    const requestGeneration = generation
    const provider = getMimoProvider()
    assertCurrentGeneration(requestGeneration)
    await Promise.all(sentences.slice(0, 2).map(sentence =>
      provider.synthesizeSentence({
        ...base,
        sentenceId: sentence.id,
        text: sentence.original,
        textHash: sentence.textHash,
        language: 'en',
      }).catch(() => null),
    ))
  }

  function stop(): void {
    generation += 1
    mimoProvider?.cancelPending()
    try {
      options.audio.stop()
    }
    catch {}
    try {
      options.speech.stop()
    }
    catch {}
  }

  async function clearCache(): Promise<void> {
    stop()
    await mimoProvider?.clearCache()
  }

  return {
    activeProvider,
    isAvailable: () => activeProvider() === 'mimo'
      ? (options.cloudSpeech.isAvailable() && options.audio.isAvailable())
        || options.speech.isAvailable()
      : options.speech.isAvailable(),
    playSentence,
    playSystemSentence,
    prefetchSentences,
    stop,
    clearCache,
    async dispose() {
      await clearCache()
    },
  }
}

function assertCloudConsent(granted: boolean | undefined): void {
  if (granted) {
    return
  }
  throw new Error('Cloud speech consent is required for this reading session.')
}

function createMimoSynthesisBase(
  settings: TtsSettings,
): Pick<CloudSpeechSynthesisRequest, 'provider' | 'model' | 'voice' | 'format'> {
  return {
    provider: 'mimo',
    model: settings.mimo.model,
    voice: settings.mimo.voice,
    format: settings.mimo.format,
  }
}

function readAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }
  const error = new Error('Speech playback was cancelled.')
  error.name = 'AbortError'
  return error
}
