import { describe, expect, it } from 'vitest'

import {
  clearLegacyOpenAiApiKey,
  hasLegacyOpenAiApiKey,
  loadReadExpansionSettings,
} from '@/features/extension/settings'
import {
  migrateLegacyProviderPreferences,
  providerPreferenceKeys,
  providerSecretKeys,
} from '@/features/settings/providerSettingsStorage'
import {
  clearLegacyMimoApiKey,
  hasLegacyMimoApiKey,
  loadTtsSettings,
} from '@/features/tts/settings'
import { MemoryPreferencesStore } from '@/platform/memoryStores'
import { WebSecretStore } from '@/platform/web/storageAdapters'

describe('provider settings migration', () => {
  it('migrates only non-sensitive legacy provider configuration', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('yomu:tts-settings', JSON.stringify({
      provider: 'mimo',
      mimo: {
        apiKey: 'legacy-mimo-secret',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
        model: 'legacy-mimo-model',
        voice: 'Legacy voice',
        format: 'wav',
      },
    }))
    window.localStorage.setItem('yomu:read-expansion-settings', JSON.stringify({
      ai: {
        enabled: true,
        consentAccepted: true,
        provider: 'openai',
        openai: {
          apiKey: 'legacy-openai-secret',
          baseUrl: 'https://api.openai.com/v1/',
          model: 'legacy-openai-model',
        },
      },
    }))

    expect(hasLegacyMimoApiKey(window.localStorage)).toBe(true)
    expect(hasLegacyOpenAiApiKey(window.localStorage)).toBe(true)

    const tts = loadTtsSettings(window.localStorage)
    expect(tts).toMatchObject({
      provider: 'mimo',
      mimo: {
        apiKey: '',
        model: 'legacy-mimo-model',
        voice: 'Legacy voice',
        format: 'wav',
      },
    })
    const expansion = loadReadExpansionSettings(window.localStorage)
    expect(expansion).toMatchObject({
      ai: {
        enabled: true,
        consentAccepted: false,
        openai: {
          apiKey: '',
          model: 'legacy-openai-model',
        },
      },
    })

    expect(window.localStorage.getItem('yomu:v2:tts-settings')).not.toContain('legacy-mimo-secret')
    expect(window.localStorage.getItem('yomu:v2:read-expansion-settings')).not.toContain('legacy-openai-secret')

    const preferences = new MemoryPreferencesStore()
    const result = await migrateLegacyProviderPreferences(preferences, window.localStorage)
    expect(result.migratedPreferenceCount).toBe(2)
    expect(await preferences.get(providerPreferenceKeys.tts)).toMatchObject({
      provider: 'mimo',
      mimo: { model: 'legacy-mimo-model' },
    })
    expect(await preferences.get(providerPreferenceKeys.readExpansion)).toMatchObject({
      ai: { enabled: true, openai: { model: 'legacy-openai-model' } },
    })
    expect(JSON.stringify(await preferences.get(providerPreferenceKeys.tts))).not.toContain('legacy-mimo-secret')
    expect(JSON.stringify(await preferences.get(providerPreferenceKeys.readExpansion))).not.toContain('legacy-openai-secret')
  })

  it('clears legacy and explicitly remembered keys through the unified SecretStore', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('yomu:tts-settings', JSON.stringify({
      provider: 'mimo',
      mimo: { apiKey: 'legacy-mimo-secret', model: 'keep-model' },
    }))
    window.localStorage.setItem('yomu:read-expansion-settings', JSON.stringify({
      ai: {
        consentAccepted: true,
        openai: { apiKey: 'legacy-openai-secret', model: 'keep-ai-model' },
      },
    }))
    const secrets = new WebSecretStore(window.localStorage)
    await secrets.set(providerSecretKeys.mimo, 'remembered-mimo-secret', 'device')
    await secrets.set(providerSecretKeys.openAi, 'remembered-openai-secret', 'device')

    clearLegacyMimoApiKey(window.localStorage)
    clearLegacyOpenAiApiKey(window.localStorage)
    await secrets.clear()

    expect(hasLegacyMimoApiKey(window.localStorage)).toBe(false)
    expect(hasLegacyOpenAiApiKey(window.localStorage)).toBe(false)
    expect(loadTtsSettings(window.localStorage).mimo.apiKey).toBe('')
    expect(loadReadExpansionSettings(window.localStorage).ai.openai.apiKey).toBe('')
    expect(await secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await secrets.get(providerSecretKeys.openAi)).toBeNull()

    const legacyTts = JSON.parse(window.localStorage.getItem('yomu:tts-settings') ?? '{}')
    const legacyExpansion = JSON.parse(window.localStorage.getItem('yomu:read-expansion-settings') ?? '{}')
    expect(legacyTts.mimo.model).toBe('keep-model')
    expect(legacyTts.mimo).not.toHaveProperty('apiKey')
    expect(legacyExpansion.ai.openai.model).toBe('keep-ai-model')
    expect(legacyExpansion.ai.openai).not.toHaveProperty('apiKey')
    expect(legacyExpansion.ai.consentAccepted).toBe(false)
  })
})
