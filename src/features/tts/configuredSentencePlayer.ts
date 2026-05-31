import { createBrowserSentencePlayer, type SentencePlayer } from '@/features/player/useReadAloudSession'

import { createTtsCacheKey } from './cacheKey'
import { createMimoTtsProvider } from './mimoAdapter'
import { createMemorySentenceAudioCache } from './sentenceAudioCache'
import { getActiveTtsProvider, type TtsSettings } from './settings'

export function createConfiguredSentencePlayer(getSettings: () => TtsSettings): SentencePlayer {
  const browserPlayer = createBrowserSentencePlayer()
  const audioCache = createMemorySentenceAudioCache()
  const mimoProvider = createMimoTtsProvider({
    cache: audioCache,
    getCredentials: () => {
      const settings = getSettings()
      return {
        apiKey: settings.mimo.apiKey,
        baseUrl: settings.mimo.baseUrl,
      }
    },
  })

  return {
    async playSentence(options) {
      const settings = getSettings()
      if (getActiveTtsProvider(settings) === 'webspeech') {
        return browserPlayer.playSentence({
          ...options,
          audioUrl: 'webspeech://system',
        })
      }

      const result = await mimoProvider.synthesizeSentence({
        provider: 'mimo',
        model: settings.mimo.model,
        voice: settings.mimo.voice,
        format: settings.mimo.format,
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
