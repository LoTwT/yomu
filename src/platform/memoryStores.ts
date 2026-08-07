import type {
  PreferencesStore,
  SecretPersistence,
  SecretStore,
} from './contracts'

export class MemoryPreferencesStore implements PreferencesStore {
  private readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    return this.getImmediately<T>(key)
  }

  getImmediately<T>(key: string): T | null {
    return this.values.has(key) ? clone(this.values.get(key)) as T : null
  }

  async listByPrefix<T>(prefix: string): Promise<Array<{ key: string, value: T }>> {
    return [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value: clone(value) as T }))
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, clone(value))
  }

  async update<T>(
    key: string,
    updater: (current: unknown | null) => T | null,
  ): Promise<T | null> {
    return this.updateImmediately(key, updater)
  }

  updateImmediately<T>(
    key: string,
    updater: (current: unknown | null) => T | null,
  ): T | null {
    const current = this.values.has(key) ? clone(this.values.get(key)) : null
    const next = updater(current)
    if (next === null) {
      this.values.delete(key)
      return null
    }
    const stored = clone(next)
    this.values.set(key, stored)
    return clone(stored)
  }

  async compareAndRemove<T>(key: string, expected: T): Promise<boolean> {
    if (!this.values.has(key)
      || JSON.stringify(this.values.get(key)) !== JSON.stringify(expected)) {
      return false
    }
    this.values.delete(key)
    return true
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
