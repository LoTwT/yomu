import type {
  PreferencesStore,
  SecretPersistence,
  SecretStore,
} from './contracts'

export class MemoryPreferencesStore implements PreferencesStore {
  private readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    return this.values.has(key) ? clone(this.values.get(key)) as T : null
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, clone(value))
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }

  async clear(): Promise<void> {
    this.values.clear()
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly session = new Map<string, string>()
  private readonly device = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.session.get(key) ?? this.device.get(key) ?? null
  }

  async set(
    key: string,
    value: string,
    persistence: SecretPersistence = 'session',
  ): Promise<void> {
    this.session.delete(key)
    this.device.delete(key)
    const target = persistence === 'device' ? this.device : this.session
    target.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.session.delete(key)
    this.device.delete(key)
  }

  async clearSession(): Promise<void> {
    this.session.clear()
  }

  async clear(): Promise<void> {
    await this.clearSession()
    this.device.clear()
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
