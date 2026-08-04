import { describe, expect, it } from 'vitest'

import {
  clearMimoApiKey,
  defaultMimoBaseUrl,
  getTtsProviderLabel,
  isMimoConfigured,
  loadTtsSettings,
  sanitizeTtsSettingsForExport,
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

  it('persists public MiMo configuration while keeping the key session-only by default', () => {
    window.localStorage.clear()

    const sessionSettings = {
      provider: 'mimo',
      mimo: {
        apiKey: 'user-secret',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
        model: 'mimo-v2.5-tts',
        voice: 'Mia',
        format: 'mp3',
      },
    } as const
    saveTtsSettings(window.localStorage, sessionSettings)

    const settings = loadTtsSettings(window.localStorage)
    expect(settings.provider).toBe('mimo')
    expect(settings.mimo.apiKey).toBe('')
    expect(settings.mimo.baseUrl).toBe(defaultMimoBaseUrl)
    expect(isMimoConfigured(settings)).toBe(false)
    expect(getTtsProviderLabel(settings)).toBe('浏览器朗读')
    expect(JSON.stringify([...storageValues(window.localStorage)])).not.toContain('user-secret')

    const exported = sanitizeTtsSettingsForExport(sessionSettings)
    expect(exported.mimo).not.toHaveProperty('apiKey')
    expect(JSON.stringify(exported)).not.toContain('user-secret')
  })

  it('never reads a key from legacy settings storage and clears the runtime key explicitly', () => {
    window.localStorage.clear()
    const sessionSettings = {
      provider: 'mimo',
      mimo: {
        apiKey: 'user-secret',
        baseUrl: defaultMimoBaseUrl,
        model: 'mimo-v2.5-tts',
        voice: 'Mia',
        format: 'mp3',
      },
    } as const

    saveTtsSettings(window.localStorage, sessionSettings)
    window.localStorage.setItem(
      'yomu:v2:secret:tts:mimo',
      JSON.stringify({ schemaVersion: 2, secret: sessionSettings.mimo.apiKey }),
    )

    const loaded = loadTtsSettings(window.localStorage)
    expect(loaded.mimo.apiKey).toBe('')
    expect(isMimoConfigured(loaded)).toBe(false)

    const cleared = clearMimoApiKey(sessionSettings)
    expect(cleared.mimo.apiKey).toBe('')
    expect(getTtsProviderLabel(cleared)).toBe('浏览器朗读')
  })
})

function storageValues(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? '')
}
