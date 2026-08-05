import type {
  CapabilitySnapshot,
  CapabilityState,
} from './contracts'

export const availableCapability: CapabilityState = Object.freeze({
  availability: 'available',
})

export function unavailableCapability(reason: string): CapabilityState {
  return Object.freeze({
    availability: 'unavailable',
    reason,
  })
}

export function permissionRequiredCapability(reason: string): CapabilityState {
  return Object.freeze({
    availability: 'permission-required',
    reason,
  })
}

export function createCapabilitySnapshot(
  overrides: Partial<CapabilitySnapshot> = {},
): Readonly<CapabilitySnapshot> {
  return Object.freeze({
    localPersistence: unavailableCapability('Persistent local storage is not configured.'),
    persistentSecrets: unavailableCapability('Persistent secret storage is not configured.'),
    localSpeech: unavailableCapability('Local speech is not configured.'),
    fileImport: unavailableCapability('File import is not configured.'),
    urlImport: unavailableCapability('URL import is not configured.'),
    shareImport: unavailableCapability('Share import is not configured.'),
    systemBack: unavailableCapability('System back navigation is not configured.'),
    serviceWorker: unavailableCapability('Service Worker is not enabled for this target.'),
    ...overrides,
  })
}

export function hasCapability(
  snapshot: CapabilitySnapshot,
  capability: keyof CapabilitySnapshot,
): boolean {
  return snapshot[capability].availability === 'available'
}
