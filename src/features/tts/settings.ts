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

const ttsSettingsKey = 'yomu:tts-settings'

export function loadTtsSettings(storage: Storage): TtsSettings {
  const raw = storage.getItem(ttsSettingsKey)
  if (!raw) {
    return cloneDefaultTtsSettings()
  }

  try {
    return normalizeTtsSettings(JSON.parse(raw))
  }
  catch {
    return cloneDefaultTtsSettings()
  }
}

export function saveTtsSettings(storage: Storage, settings: TtsSettings): void {
  storage.setItem(ttsSettingsKey, JSON.stringify(normalizeTtsSettings(settings)))
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
