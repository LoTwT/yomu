import type {
  MutableLegacyKeyValueSource,
} from '@/data/legacyMigration'
import type {
  PreferencesStore,
  SecretPersistence,
  SecretStore,
} from '../contracts'

const preferencePrefix = 'yomu:v2:preference:'
const secretPrefix = 'yomu:v2:secret:'

export class WebPreferencesStore implements PreferencesStore {
  readonly persistence = 'device' as const

  constructor(
    private readonly storage: Storage,
    private readonly locks: LockManager | null = readLockManager(),
  ) {}

  async get<T>(key: string): Promise<T | null> {
    return this.getImmediately<T>(key)
  }

  getImmediately<T>(key: string): T | null {
    const raw = this.storage.getItem(`${preferencePrefix}${key}`)
    if (raw === null) {
      return null
    }
    try {
      return JSON.parse(raw) as T
    }
    catch {
      return null
    }
  }

  async listByPrefix<T>(prefix: string): Promise<Array<{ key: string, value: T }>> {
    const storagePrefix = `${preferencePrefix}${prefix}`
    const entries: Array<{ key: string, value: T }> = []
    for (let index = 0; index < this.storage.length; index += 1) {
      const storageKey = this.storage.key(index)
      if (!storageKey?.startsWith(storagePrefix)) {
        continue
      }
      const raw = this.storage.getItem(storageKey)
      if (raw === null) {
        continue
      }
      try {
        entries.push({
          key: storageKey.slice(preferencePrefix.length),
          value: JSON.parse(raw) as T,
        })
      }
      catch {}
    }
    return entries.sort((left, right) => left.key.localeCompare(right.key))
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.withKeyLock(key, () => {
      this.storage.setItem(`${preferencePrefix}${key}`, JSON.stringify(value))
    })
  }

  async update<T>(
    key: string,
    updater: (current: unknown | null) => T | null,
  ): Promise<T | null> {
    return this.withKeyLock(key, () => {
      const storageKey = `${preferencePrefix}${key}`
      const raw = this.storage.getItem(storageKey)
      let current: unknown | null = null
      if (raw !== null) {
        try {
          current = JSON.parse(raw) as unknown
        }
        catch {}
      }
      const next = updater(current)
      if (next === null) {
        this.storage.removeItem(storageKey)
        return null
      }
      this.storage.setItem(storageKey, JSON.stringify(next))
      return JSON.parse(JSON.stringify(next)) as T
    })
  }

  updateImmediately<T>(
    key: string,
    updater: (current: unknown | null) => T | null,
  ): T | null {
    const storageKey = `${preferencePrefix}${key}`
    const raw = this.storage.getItem(storageKey)
    let current: unknown | null = null
    if (raw !== null) {
      try {
        current = JSON.parse(raw) as unknown
      }
      catch {}
    }
    const next = updater(current)
    if (next === null) {
      this.storage.removeItem(storageKey)
      return null
    }
    this.storage.setItem(storageKey, JSON.stringify(next))
    return JSON.parse(JSON.stringify(next)) as T
  }

  async compareAndRemove<T>(key: string, expected: T): Promise<boolean> {
    return this.withKeyLock(key, () => {
      const storageKey = `${preferencePrefix}${key}`
      const raw = this.storage.getItem(storageKey)
      if (raw === null || raw !== JSON.stringify(expected)) {
        return false
      }
      this.storage.removeItem(storageKey)
      return true
    })
  }

  async remove(key: string): Promise<void> {
    await this.withKeyLock(key, () => {
      this.storage.removeItem(`${preferencePrefix}${key}`)
    })
  }

  async clear(): Promise<void> {
    removeNamespacedKeys(this.storage, preferencePrefix)
  }

  private withKeyLock<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    if (!this.locks) {
      return Promise.resolve(operation())
    }
    return this.locks.request(`${preferencePrefix}${key}`, operation)
  }
}

function readLockManager(): LockManager | null {
  return typeof navigator === 'undefined' ? null : navigator.locks ?? null
}

export class WebSecretStore implements SecretStore {
  private readonly sessionValues = new Map<string, string>()

  constructor(private readonly storage: Storage | null) {}

  async get(key: string): Promise<string | null> {
    return this.sessionValues.get(key)
      ?? (this.storage ? readStoredDeviceSecret(this.storage, key).value : null)
      ?? null
  }

  clearLegacySerializedValues(keys: readonly string[]): number {
    if (!this.storage) {
      return 0
    }
    return keys.reduce((count, key) => {
      const result = readStoredDeviceSecret(this.storage!, key)
      return count + (result.legacyValueCleared ? 1 : 0)
    }, 0)
  }

  async set(
    key: string,
    value: string,
    persistence: SecretPersistence = 'session',
  ): Promise<void> {
    await this.remove(key)
    if (persistence === 'device') {
      if (!this.storage) {
        throw new Error('Persistent browser storage is unavailable.')
      }
      this.storage.setItem(`${secretPrefix}${key}`, value)
      return
    }
    this.sessionValues.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.sessionValues.delete(key)
    this.storage?.removeItem(`${secretPrefix}${key}`)
  }

  async clearSession(): Promise<void> {
    this.sessionValues.clear()
  }

  async clear(): Promise<void> {
    await this.clearSession()
    if (this.storage) {
      removeNamespacedKeys(this.storage, secretPrefix)
      scrubLegacyProviderKey(this.storage, 'yomu:tts-settings', ['mimo', 'apiKey'])
      scrubLegacyProviderKey(this.storage, 'yomu:read-expansion-settings', ['ai', 'openai', 'apiKey'])
      resetLegacyProviderConsent(this.storage)
    }
  }
}

export class WebLegacyStorageSource implements MutableLegacyKeyValueSource {
  constructor(private readonly storage: Storage) {}

  get(key: string): string | null {
    return this.storage.getItem(key)
  }

  set(key: string, value: string): void {
    this.storage.setItem(key, value)
  }

  keys(): string[] {
    const keys: string[] = []
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index)
      if (key) {
        keys.push(key)
      }
    }
    return keys.sort()
  }
}

export function isStorageUsable(storage: Storage | null | undefined): storage is Storage {
  if (!storage) {
    return false
  }
  const probe = 'yomu:v2:storage-probe'
  try {
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return true
  }
  catch {
    return false
  }
}

function removeNamespacedKeys(storage: Storage, prefix: string): void {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) {
      keys.push(key)
    }
  }
  keys.forEach(key => storage.removeItem(key))
}

function scrubLegacyProviderKey(storage: Storage, storageKey: string, path: readonly string[]): void {
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return
  }

  try {
    const record = JSON.parse(raw) as unknown
    if (!isRecord(record)) {
      storage.removeItem(storageKey)
      return
    }

    let parent: Record<string, unknown> = record
    for (const segment of path.slice(0, -1)) {
      const next = parent[segment]
      if (!isRecord(next)) {
        return
      }
      parent = next
    }

    delete parent[path.at(-1) ?? '']
    storage.setItem(storageKey, JSON.stringify(record))
  }
  catch {
    storage.removeItem(storageKey)
  }
}

function readStoredDeviceSecret(
  storage: Storage,
  logicalKey: string,
): { value: string | null, legacyValueCleared: boolean } {
  const storageKey = `${secretPrefix}${logicalKey}`
  const raw = storage.getItem(storageKey)
  if (raw === null) {
    return { value: null, legacyValueCleared: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  }
  catch {
    return { value: raw, legacyValueCleared: false }
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 2 || typeof parsed.secret !== 'string') {
    return { value: raw, legacyValueCleared: false }
  }
  try {
    storage.removeItem(storageKey)
    return { value: null, legacyValueCleared: true }
  }
  catch {
    return { value: null, legacyValueCleared: false }
  }
}

function resetLegacyProviderConsent(storage: Storage): void {
  const storageKey = 'yomu:read-expansion-settings'
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return
  }
  try {
    const record = JSON.parse(raw) as unknown
    if (!isRecord(record) || !isRecord(record.ai)) {
      return
    }
    record.ai.consentAccepted = false
    storage.setItem(storageKey, JSON.stringify(record))
  }
  catch {
    storage.removeItem(storageKey)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
