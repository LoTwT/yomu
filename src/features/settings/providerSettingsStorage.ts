import type { PreferencesStore } from '@/platform/contracts'

import {
  loadReadExpansionSettings,
  sanitizeReadExpansionSettingsForExport,
} from '../extension/settings'
import {
  loadTtsSettings,
  sanitizeTtsSettingsForExport,
} from '../tts/settings'

export const providerPreferenceKeys = {
  tts: 'provider:tts',
  readExpansion: 'provider:read-expansion',
  rememberMimo: 'provider:tts:mimo:remember-on-device',
  rememberOpenAi: 'provider:ai:openai:remember-on-device',
} as const

export const providerSecretKeys = {
  mimo: 'tts:mimo',
  openAi: 'ai:openai',
} as const

const legacyTtsPreferenceKeys = ['yomu:v2:tts-settings', 'yomu:tts-settings'] as const
const legacyReadExpansionPreferenceKeys = [
  'yomu:v2:read-expansion-settings',
  'yomu:read-expansion-settings',
] as const

export interface LegacyProviderSettingsMigrationResult {
  migratedPreferenceCount: number
}

export async function migrateLegacyProviderPreferences(
  preferences: PreferencesStore,
  storage: Storage,
): Promise<LegacyProviderSettingsMigrationResult> {
  let migratedPreferenceCount = 0

  if (await preferences.get(providerPreferenceKeys.tts) === null
    && hasAnyStoredValue(storage, legacyTtsPreferenceKeys)) {
    await preferences.set(
      providerPreferenceKeys.tts,
      sanitizeTtsSettingsForExport(loadTtsSettings(storage)),
    )
    migratedPreferenceCount += 1
  }

  if (await preferences.get(providerPreferenceKeys.readExpansion) === null
    && hasAnyStoredValue(storage, legacyReadExpansionPreferenceKeys)) {
    await preferences.set(
      providerPreferenceKeys.readExpansion,
      sanitizeReadExpansionSettingsForExport(loadReadExpansionSettings(storage)),
    )
    migratedPreferenceCount += 1
  }

  return { migratedPreferenceCount }
}

function hasAnyStoredValue(storage: Storage, keys: readonly string[]): boolean {
  return keys.some(key => storage.getItem(key) !== null)
}
