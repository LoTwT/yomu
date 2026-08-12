import { clearLegacySensitiveSettings, migrateLegacyData } from '@/data/legacyMigration'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LegacyMigrationResult } from '@/data/legacyMigration'
import type { LocalRepositories } from '@/data/repositories'
import { hasLegacyOpenAiApiKey } from '@/features/extension/settings'
import {
  migrateLegacyProviderPreferences,
  providerSecretKeys,
} from '@/features/settings/providerSettingsStorage'
import { hasLegacyMimoApiKey } from '@/features/tts/settings'

import {
  availableCapability,
  createCapabilitySnapshot,
  unavailableCapability,
} from '../capabilities'
import type { PlatformServices } from '../contracts'
import {
  platformInitializationPreferenceKeys,
  type PlatformInitializationReport,
} from '../initialization'
import { MemoryPreferencesStore, MemorySecretStore } from '../memoryStores'
import { createIndexedDbLocalRepositories } from './indexedDbLocalRepositories'
import { createDefaultWebRuntimeAdapters } from './runtimeAdapters'
import {
  isStorageUsable,
  WebLegacyImportedContentAdapter,
  WebLegacyStorageSource,
  WebPreferencesStore,
  WebSecretStore,
} from './storageAdapters'

export interface CreateWebPlatformServicesOptions {
  repositories?: LocalRepositories
  indexedDbFactory?: IDBFactory | null
  databaseName?: string
  localStorage?: Storage | null
  apiBaseUrl?: string
  windowRef?: Window
  documentRef?: Document
  navigatorRef?: Navigator
  fetchImpl?: typeof fetch
  migrateLegacy?: boolean
  onInitializationError?: (error: unknown) => void
}

export interface WebPlatformServicesResult {
  services: PlatformServices
  migration: LegacyMigrationResult | null
  initialization: PlatformInitializationReport
}

export async function createWebPlatformServices(
  options: CreateWebPlatformServicesOptions = {},
): Promise<WebPlatformServicesResult> {
  const storage = resolveLocalStorage(options.localStorage)
  const indexedDbFactory = resolveIndexedDbFactory(options.indexedDbFactory)
  let initializationIssueCount = 0
  const reportInitializationError = (error: unknown) => {
    initializationIssueCount += 1
    options.onInitializationError?.(error)
  }
  let repositories = options.repositories
  if (!repositories && indexedDbFactory) {
    try {
      repositories = await createIndexedDbLocalRepositories({
        factory: indexedDbFactory,
        databaseName: options.databaseName,
      })
    }
    catch (error) {
      reportInitializationError(error)
    }
  }
  repositories ??= createMemoryLocalRepositories()

  const preferences = storage
    ? new WebPreferencesStore(storage)
    : new MemoryPreferencesStore()
  const webSecrets = storage ? new WebSecretStore(storage) : null
  const secrets = webSecrets ?? new MemorySecretStore()
  const legacyImportedContent = new WebLegacyImportedContentAdapter(storage)
  const runtime = createDefaultWebRuntimeAdapters({
    apiBaseUrl: options.apiBaseUrl,
    windowRef: options.windowRef,
    documentRef: options.documentRef,
    navigatorRef: options.navigatorRef,
    fetchImpl: options.fetchImpl,
  })

  let migration: LegacyMigrationResult | null = null
  let clearedSensitiveSettings: string[] = []
  let legacyProviderKeyWasPresent = false
  let legacyProviderSecretsCleared = 0
  let legacyProviderKeyReentryRequired = false
  let providerPreferencesMigrated = 0
  if (storage && options.migrateLegacy !== false) {
    const source = new WebLegacyStorageSource(storage)
    legacyProviderKeyWasPresent = hasLegacyMimoApiKey(storage)
      || hasLegacyOpenAiApiKey(storage)
    try {
      legacyProviderSecretsCleared = webSecrets?.clearLegacySerializedValues([
        providerSecretKeys.mimo,
        providerSecretKeys.openAi,
      ]) ?? 0
    }
    catch (error) {
      reportInitializationError(error)
    }
    try {
      clearedSensitiveSettings = clearLegacySensitiveSettings(source)
    }
    catch (error) {
      reportInitializationError(error)
    }
    if (legacyProviderKeyWasPresent || legacyProviderSecretsCleared > 0) {
      try {
        await preferences.set(
          platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
          true,
        )
      }
      catch (error) {
        reportInitializationError(error)
      }
    }
    try {
      migration = await migrateLegacyData(repositories, source)
      clearedSensitiveSettings = [...new Set([
        ...clearedSensitiveSettings,
        ...migration.clearedSensitiveSettings,
      ])]
      migration = { ...migration, clearedSensitiveSettings }
    }
    catch (error) {
      clearedSensitiveSettings = [...new Set([
        ...clearedSensitiveSettings,
        ...clearLegacySensitiveSettings(source),
      ])]
      reportInitializationError(error)
    }
    try {
      const providerMigration = await migrateLegacyProviderPreferences(preferences, storage)
      providerPreferencesMigrated = providerMigration.migratedPreferenceCount
    }
    catch (error) {
      reportInitializationError(error)
    }
  }
  try {
    legacyProviderKeyReentryRequired = await preferences.get<boolean>(
      platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
    ) === true
  }
  catch (error) {
    reportInitializationError(error)
  }

  const navigatorRef = options.navigatorRef ?? navigator
  const capabilities = createCapabilitySnapshot({
    localPersistence: repositories.persistence === 'persistent'
      ? availableCapability
      : unavailableCapability('IndexedDB is unavailable; saved changes would not survive a reload.'),
    persistentSecrets: storage
      ? availableCapability
      : unavailableCapability('Browser local storage is unavailable.'),
    localSpeech: runtime.speech.isAvailable()
      ? availableCapability
      : unavailableCapability('Web Speech is unavailable in this browser.'),
    fileImport: runtime.files.isAvailable()
      ? availableCapability
      : unavailableCapability('The browser file picker is unavailable.'),
    urlImport: runtime.articleExtractor.isAvailable()
      ? availableCapability
      : unavailableCapability('Readable HTML extraction is unavailable in this browser.'),
    shareImport: unavailableCapability('Inbound system sharing is not enabled for the Web target.'),
    systemBack: availableCapability,
    serviceWorker: 'serviceWorker' in navigatorRef
      ? availableCapability
      : unavailableCapability('Service Worker is unavailable in this browser.'),
  })

  return {
    services: {
      kind: 'web',
      capabilities,
      repositories,
      preferences,
      secrets,
      legacyImportedContent,
      ...runtime,
    },
    migration,
    initialization: {
      legacyProviderKeysCleared: legacyProviderKeyWasPresent && clearedSensitiveSettings.length > 0,
      legacyProviderSecretsCleared,
      legacyProviderKeyReentryRequired,
      providerPreferencesMigrated,
      migrationDiagnosticCount: migration?.diagnostics.length ?? 0,
      initializationIssueCount,
    },
  }
}

function resolveLocalStorage(explicit: Storage | null | undefined): Storage | null {
  if (explicit !== undefined) {
    return isStorageUsable(explicit) ? explicit : null
  }
  try {
    return isStorageUsable(window.localStorage) ? window.localStorage : null
  }
  catch {
    return null
  }
}

function resolveIndexedDbFactory(explicit: IDBFactory | null | undefined): IDBFactory | null {
  if (explicit !== undefined) {
    return explicit
  }
  return typeof indexedDB === 'undefined' ? null : indexedDB
}
