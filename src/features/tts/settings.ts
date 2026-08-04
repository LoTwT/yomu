import type { TtsAudioFormat, TtsProviderId } from './types'

export interface MimoByokSettings {
  apiKey: string
  baseUrl: string
  model: string
  voice: string
  format: TtsAudioFormat
}

export interface TtsSettings {
  provider: TtsProviderId
  mimo: MimoByokSettings
}

export interface ExportedTtsSettings {
  schemaVersion: 2
  provider: TtsProviderId
  mimo: Omit<MimoByokSettings, 'apiKey'>
}

export const defaultMimoBaseUrl = 'https://token-plan-cn.xiaomimimo.com/v1'
export const defaultTtsSettings: TtsSettings = {
  provider: 'webspeech',
  mimo: {
    apiKey: '',
    baseUrl: defaultMimoBaseUrl,
    model: 'mimo-v2.5-tts',
    voice: 'Mia',
    format: 'mp3',
  },
}

const legacyTtsSettingsKey = 'yomu:tts-settings'
const ttsSettingsKey = 'yomu:v2:tts-settings'

export function loadTtsSettings(storage: Storage): TtsSettings {
  return loadPersistedTtsSettings(storage) ?? cloneDefaultTtsSettings()
}

export function saveTtsSettings(storage: Storage, settings: TtsSettings): void {
  storage.setItem(ttsSettingsKey, JSON.stringify(sanitizeTtsSettingsForExport(settings)))
}

export function hasLegacyMimoApiKey(storage: Storage): boolean {
  const legacy = parseStoredRecord(storage.getItem(legacyTtsSettingsKey))
  const mimo = legacy && isRecord(legacy.mimo) ? legacy.mimo : null
  return typeof mimo?.apiKey === 'string' && mimo.apiKey.trim().length > 0
}

export function clearLegacyMimoApiKey(storage: Storage): void {
  const raw = storage.getItem(legacyTtsSettingsKey)
  if (!raw) {
    return
  }

  const legacy = parseStoredRecord(raw)
  if (!legacy) {
    storage.removeItem(legacyTtsSettingsKey)
    return
  }

  if (isRecord(legacy.mimo)) {
    delete legacy.mimo.apiKey
  }
  storage.setItem(legacyTtsSettingsKey, JSON.stringify(legacy))
}

export function sanitizeTtsSettingsForExport(settings: TtsSettings): ExportedTtsSettings {
  const normalized = normalizeTtsSettings(settings)
  return {
    schemaVersion: 2,
    provider: normalized.provider,
    mimo: {
      baseUrl: normalized.mimo.baseUrl,
      model: normalized.mimo.model,
      voice: normalized.mimo.voice,
      format: normalized.mimo.format,
    },
  }
}

export function clearMimoApiKey(settings: TtsSettings): TtsSettings {
  return {
    ...settings,
    mimo: {
      ...settings.mimo,
      apiKey: '',
    },
  }
}

export function isMimoConfigured(settings: TtsSettings): boolean {
  return settings.mimo.apiKey.trim().length > 0
}

export function getActiveTtsProvider(settings: TtsSettings): TtsProviderId {
  return settings.provider === 'mimo' && isMimoConfigured(settings) ? 'mimo' : 'webspeech'
}

export function getTtsProviderLabel(settings: TtsSettings): string {
  return getActiveTtsProvider(settings) === 'mimo' ? '云朗读 · MiMo' : '浏览器朗读'
}

export function normalizeTtsSettings(value: unknown): TtsSettings {
  const record = isRecord(value) ? value : {}
  const mimo = isRecord(record.mimo) ? record.mimo : {}
  const provider = record.provider === 'mimo' ? 'mimo' : 'webspeech'
  const format = mimo.format === 'wav' ? 'wav' : 'mp3'

  return {
    provider,
    mimo: {
      apiKey: typeof mimo.apiKey === 'string' ? mimo.apiKey : '',
      baseUrl: normalizeBaseUrl(typeof mimo.baseUrl === 'string' ? mimo.baseUrl : defaultMimoBaseUrl),
      model: normalizeNonEmptyString(mimo.model, defaultTtsSettings.mimo.model),
      voice: normalizeNonEmptyString(mimo.voice, defaultTtsSettings.mimo.voice),
      format,
    },
  }
}

function cloneDefaultTtsSettings(): TtsSettings {
  return normalizeTtsSettings(defaultTtsSettings)
}

function loadPersistedTtsSettings(storage: Storage): TtsSettings | null {
  const current = parseStoredRecord(storage.getItem(ttsSettingsKey))
  if (current) {
    return clearMimoApiKey(normalizeTtsSettings(current))
  }

  const legacy = parseStoredRecord(storage.getItem(legacyTtsSettingsKey))
  if (!legacy) {
    return null
  }

  const migrated = clearMimoApiKey(normalizeTtsSettings(legacy))
  try {
    storage.setItem(ttsSettingsKey, JSON.stringify(sanitizeTtsSettingsForExport(migrated)))
  }
  catch {
    // Reading settings must still work when storage is unavailable or full.
  }
  return migrated
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : defaultMimoBaseUrl
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseStoredRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  }
  catch {
    return null
  }
}
