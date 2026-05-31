import { describe, expect, it } from 'vitest'

import {
  clearMimoApiKey,
  defaultMimoBaseUrl,
  getTtsProviderLabel,
  isMimoConfigured,
  loadTtsSettings,
  saveTtsSettings,
} from '@/features/tts/settings'

describe('TTS settings', () => {
  it('defaults to Web Speech without a provider key', () => {
    window.localStorage.clear()

    const settings = loadTtsSettings(window.localStorage)

    expect(settings.provider).toBe('webspeech')
    expect(settings.mimo.apiKey).toBe('')
    expect(settings.mimo.baseUrl).toBe(defaultMimoBaseUrl)
    expect(getTtsProviderLabel(settings)).toContain('浏览器')
  })

  it('stores BYOK MiMo settings locally and clears the key explicitly', () => {
    window.localStorage.clear()

    saveTtsSettings(window.localStorage, {
      provider: 'mimo',
      mimo: {
        apiKey: 'user-secret',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
        model: 'mimo-v2.5-tts',
        voice: 'Mia',
        format: 'mp3',
      },
    })

    const settings = loadTtsSettings(window.localStorage)
    expect(settings.provider).toBe('mimo')
    expect(settings.mimo.apiKey).toBe('user-secret')
    expect(settings.mimo.baseUrl).toBe(defaultMimoBaseUrl)
    expect(isMimoConfigured(settings)).toBe(true)
    expect(getTtsProviderLabel(settings)).toBe('云朗读 · MiMo')
    expect(clearMimoApiKey(settings).mimo.apiKey).toBe('')
    expect(getTtsProviderLabel(clearMimoApiKey(settings))).toBe('浏览器朗读')
  })
})
