export interface PlatformInitializationReport {
  legacyProviderKeysCleared: boolean
  legacyProviderSecretsCleared: number
  legacyProviderKeyReentryRequired: boolean
  providerPreferencesMigrated: number
  migrationDiagnosticCount: number
  initializationIssueCount: number
}

export const platformInitializationPreferenceKeys = {
  legacyProviderKeyReentryRequired: 'migration:legacy-provider-key-reentry-required',
} as const

export function createEmptyPlatformInitializationReport(): PlatformInitializationReport {
  return {
    legacyProviderKeysCleared: false,
    legacyProviderSecretsCleared: 0,
    legacyProviderKeyReentryRequired: false,
    providerPreferencesMigrated: 0,
    migrationDiagnosticCount: 0,
    initializationIssueCount: 0,
  }
}
