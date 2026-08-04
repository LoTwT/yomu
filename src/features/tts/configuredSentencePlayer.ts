import {
  sessionOwnedSentencePlayer,
  type SentencePlayer,
  type SessionOwnedSentencePlayer,
} from '@/features/player/useReadAloudSession'
import type { RemoteServicesAdapter } from '@/platform/contracts'

import { createTtsCacheKey } from './cacheKey'
import { createMimoTtsProvider } from './mimoAdapter'
import { createMemorySentenceAudioCache } from './sentenceAudioCache'
import { getActiveTtsProvider, type TtsSettings } from './settings'
import type { TtsSynthesisRequest } from './types'

export interface ConfiguredSentencePlayerOptions {
  browserPlayer: SentencePlayer
  remote: RemoteServicesAdapter
}

export function createConfiguredSentencePlayer(
  getSettings: () => TtsSettings,
  options: ConfiguredSentencePlayerOptions,
): SessionOwnedSentencePlayer {
  const browserPlayer = options.browserPlayer
  const audioCache = createMemorySentenceAudioCache()
  const mimoProvider = createMimoTtsProvider({
    cache: audioCache,
    remote: options.remote,
    getCredentials: () => {
      const settings = getSettings()
      return {
        apiKey: settings.mimo.apiKey,
        baseUrl: settings.mimo.baseUrl,
      }
    },
  })

  return {
    [sessionOwnedSentencePlayer]: true,
    async playSentence(options) {
      const settings = getSettings()
      if (getActiveTtsProvider(settings) === 'webspeech') {
        return browserPlayer.playSentence({
          ...options,
          audioUrl: 'webspeech://system',
        })
      }

      const result = await mimoProvider.synthesizeSentence({
        ...createMimoSynthesisBase(settings),
        sentenceId: options.sentenceId,
        text: options.text,
        textHash: options.textHash,
        language: 'en',
      })

      return browserPlayer.playSentence({
        ...options,
        audioUrl: result.audioUrl,
        durationMs: result.durationMs,
      })
    },
    prefetchSentences(options) {
      const settings = getSettings()
      if (getActiveTtsProvider(settings) !== 'mimo') {
        return
      }

      const requestBase = createMimoSynthesisBase(settings)
      return Promise.all(options.sentences.map(sentence =>
        mimoProvider.synthesizeSentence({
          ...requestBase,
          sentenceId: sentence.id,
          text: sentence.original,
          textHash: sentence.textHash ?? sentence.id,
          language: 'en',
        }).catch(() => null),
      )).then(() => undefined)
    },
    cancelPending() {
      mimoProvider.cancelPending()
    },
    clearCache() {
      return mimoProvider.clearCache()
    },
    disposeOnSessionTeardown() {
      return mimoProvider.clearCache()
    },
  }
}

export function previewConfiguredCacheKey(settings: TtsSettings, textHash: string): string {
  return createTtsCacheKey({
    provider: settings.provider,
    model: settings.provider === 'mimo' ? settings.mimo.model : 'browser-system',
    voice: settings.provider === 'mimo' ? settings.mimo.voice : 'system',
    format: settings.provider === 'mimo' ? settings.mimo.format : 'mp3',
    textHash,
  })
}

function createMimoSynthesisBase(settings: TtsSettings): Pick<TtsSynthesisRequest, 'provider' | 'model' | 'voice' | 'format'> {
  return {
    provider: 'mimo',
    model: settings.mimo.model,
    voice: settings.mimo.voice,
    format: settings.mimo.format,
  }
}
