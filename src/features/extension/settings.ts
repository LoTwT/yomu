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

export interface ExportedReadExpansionSettings {
  schemaVersion: 2
  ai: {
    enabled: boolean
    provider: 'openai'
    openai: Omit<OpenAiByokSettings, 'apiKey'>
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

const legacyReadExpansionSettingsKey = 'yomu:read-expansion-settings'
const readExpansionSettingsKey = 'yomu:v2:read-expansion-settings'

export function loadReadExpansionSettings(storage: Storage): ReadExpansionSettings {
  return loadPersistedReadExpansionSettings(storage)
    ?? cloneDefaultReadExpansionSettings()
}

export function saveReadExpansionSettings(storage: Storage, settings: ReadExpansionSettings): void {
  storage.setItem(readExpansionSettingsKey, JSON.stringify(sanitizeReadExpansionSettingsForExport(settings)))
}

export function hasLegacyOpenAiApiKey(storage: Storage): boolean {
  const legacy = parseStoredRecord(storage.getItem(legacyReadExpansionSettingsKey))
  const ai = legacy && isRecord(legacy.ai) ? legacy.ai : null
  const openai = ai && isRecord(ai.openai) ? ai.openai : null
  return typeof openai?.apiKey === 'string' && openai.apiKey.trim().length > 0
}

export function clearLegacyOpenAiApiKey(storage: Storage): void {
  const raw = storage.getItem(legacyReadExpansionSettingsKey)
  if (!raw) {
    return
  }

  const legacy = parseStoredRecord(raw)
  if (!legacy) {
    storage.removeItem(legacyReadExpansionSettingsKey)
    return
  }

  if (isRecord(legacy.ai) && isRecord(legacy.ai.openai)) {
    delete legacy.ai.openai.apiKey
  }
  if (isRecord(legacy.ai)) {
    legacy.ai.consentAccepted = false
  }
  storage.setItem(legacyReadExpansionSettingsKey, JSON.stringify(legacy))
}

export function sanitizeReadExpansionSettingsForExport(
  settings: ReadExpansionSettings,
): ExportedReadExpansionSettings {
  const normalized = normalizeReadExpansionSettings(settings)
  return {
    schemaVersion: 2,
    ai: {
      enabled: normalized.ai.enabled,
      provider: 'openai',
      openai: {
        baseUrl: normalized.ai.openai.baseUrl,
        model: normalized.ai.openai.model,
      },
    },
  }
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

function loadPersistedReadExpansionSettings(storage: Storage): ReadExpansionSettings | null {
  const current = parseStoredRecord(storage.getItem(readExpansionSettingsKey))
  if (current) {
    return clearAiApiKey(normalizeReadExpansionSettings(current))
  }

  const legacy = parseStoredRecord(storage.getItem(legacyReadExpansionSettingsKey))
  if (!legacy) {
    return null
  }

  const migrated = clearAiApiKey(normalizeReadExpansionSettings(legacy))
  try {
    storage.setItem(
      readExpansionSettingsKey,
      JSON.stringify(sanitizeReadExpansionSettingsForExport(migrated)),
    )
  }
  catch {
    // Reading settings must still work when storage is unavailable or full.
  }
  return migrated
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
