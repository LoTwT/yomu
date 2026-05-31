export interface OpenAiByokSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ReadExpansionSettings {
  ai: {
    enabled: boolean
    consentAccepted: boolean
    provider: 'openai'
    openai: OpenAiByokSettings
  }
}

export const defaultOpenAiBaseUrl = 'https://api.openai.com/v1'
export const defaultOpenAiModel = 'gpt-4.1-mini'

export const defaultReadExpansionSettings: ReadExpansionSettings = {
  ai: {
    enabled: false,
    consentAccepted: false,
    provider: 'openai',
    openai: {
      apiKey: '',
      baseUrl: defaultOpenAiBaseUrl,
      model: defaultOpenAiModel,
    },
  },
}

const readExpansionSettingsKey = 'yomu:read-expansion-settings'

export function loadReadExpansionSettings(storage: Storage): ReadExpansionSettings {
  const raw = storage.getItem(readExpansionSettingsKey)
  if (!raw) {
    return cloneDefaultReadExpansionSettings()
  }

  try {
    return normalizeReadExpansionSettings(JSON.parse(raw))
  }
  catch {
    return cloneDefaultReadExpansionSettings()
  }
}

export function saveReadExpansionSettings(storage: Storage, settings: ReadExpansionSettings): void {
  storage.setItem(readExpansionSettingsKey, JSON.stringify(normalizeReadExpansionSettings(settings)))
}

export function clearAiApiKey(settings: ReadExpansionSettings): ReadExpansionSettings {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      consentAccepted: false,
      openai: {
        ...settings.ai.openai,
        apiKey: '',
      },
    },
  }
}

export function isAiExpansionConfigured(settings: ReadExpansionSettings): boolean {
  return settings.ai.openai.apiKey.trim().length > 0
}

export function getAiProviderLabel(settings: ReadExpansionSettings): string {
  return settings.ai.provider === 'openai' ? 'OpenAI' : 'AI'
}

export function normalizeReadExpansionSettings(value: unknown): ReadExpansionSettings {
  const record = isRecord(value) ? value : {}
  const ai = isRecord(record.ai) ? record.ai : {}
  const openai = isRecord(ai.openai) ? ai.openai : {}

  return {
    ai: {
      enabled: ai.enabled === true,
      consentAccepted: ai.consentAccepted === true,
      provider: 'openai',
      openai: {
        apiKey: typeof openai.apiKey === 'string' ? openai.apiKey : '',
        baseUrl: normalizeBaseUrl(typeof openai.baseUrl === 'string' ? openai.baseUrl : defaultOpenAiBaseUrl),
        model: normalizeNonEmptyString(openai.model, defaultOpenAiModel),
      },
    },
  }
}

function cloneDefaultReadExpansionSettings(): ReadExpansionSettings {
  return normalizeReadExpansionSettings(defaultReadExpansionSettings)
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : defaultOpenAiBaseUrl
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
