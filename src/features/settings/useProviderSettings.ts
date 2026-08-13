import {
  computed,
  getCurrentInstance,
  readonly,
  shallowRef,
  type App as VueApp,
  type ShallowRef,
  type WritableComputedRef,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { PlatformServices } from '@/platform/contracts'

import {
  clearAiApiKey,
  defaultReadExpansionSettings,
  normalizeReadExpansionSettings,
  sanitizeReadExpansionSettingsForExport,
  type ReadExpansionSettings,
} from '../extension/settings'
import {
  clearMimoApiKey,
  defaultTtsSettings,
  isSupportedMimoApiKey,
  normalizeTtsSettings,
  sanitizeTtsSettingsForExport,
  type TtsSettings,
} from '../tts/settings'
import { providerPreferenceKeys, providerSecretKeys } from './providerSettingsStorage'

export type ProviderSettingsLoadStatus = 'loading' | 'ready' | 'failed'
export type ProviderSettingsPersistenceStatus = 'idle' | 'saving' | 'saved' | 'failed'

interface ProviderSettingsController {
  ttsSettings: ShallowRef<TtsSettings>
  readExpansionSettings: ShallowRef<ReadExpansionSettings>
  rememberMimoKey: ShallowRef<boolean>
  rememberOpenAiKey: ShallowRef<boolean>
  loadStatus: ShallowRef<ProviderSettingsLoadStatus>
  persistenceStatus: ShallowRef<ProviderSettingsPersistenceStatus>
  canRememberOnDevice: boolean
  ready: Promise<void>
  updateTtsSettings: (settings: TtsSettings) => void
  updateReadExpansionSettings: (settings: ReadExpansionSettings) => void
  updateRememberMimoKey: (remember: boolean) => void
  updateRememberOpenAiKey: (remember: boolean) => void
  clearAllProviderSecrets: () => Promise<void>
  waitForPendingWrites: () => Promise<void>
  dispose: () => void
}

type WriteContinuationGuard = () => boolean
type ProviderSettingsWrite = (canContinue: WriteContinuationGuard) => Promise<void>
interface ProviderSettingsWriteOptions {
  runAfterDispose?: boolean
}

export interface ProviderSettingsBindings {
  ttsSettings: WritableComputedRef<TtsSettings>
  readExpansionSettings: WritableComputedRef<ReadExpansionSettings>
  rememberMimoKey: WritableComputedRef<boolean>
  rememberOpenAiKey: WritableComputedRef<boolean>
  loadStatus: Readonly<ProviderSettingsController['loadStatus']>
  persistenceStatus: Readonly<ProviderSettingsController['persistenceStatus']>
  canRememberOnDevice: boolean
  ready: Promise<void>
  clearAllProviderSecrets: () => Promise<void>
  waitForPendingWrites: () => Promise<void>
}

const controllers = new WeakMap<VueApp, ProviderSettingsController>()

export function useProviderSettings(): ProviderSettingsBindings {
  const instance = getCurrentInstance()
  if (!instance) {
    throw new Error('Provider settings must be used inside a Vue application setup context.')
  }

  const app = instance.appContext.app
  const services = usePlatformServices()
  let controller = controllers.get(app)
  if (!controller) {
    const createdController = createProviderSettingsController(services)
    controllers.set(app, createdController)
    app.onUnmount(() => {
      if (controllers.get(app) !== createdController) {
        return
      }
      controllers.delete(app)
      createdController.dispose()
    })
    controller = createdController
  }

  return {
    ttsSettings: computed({
      get: () => controller.ttsSettings.value,
      set: controller.updateTtsSettings,
    }),
    readExpansionSettings: computed({
      get: () => controller.readExpansionSettings.value,
      set: controller.updateReadExpansionSettings,
    }),
    rememberMimoKey: computed({
      get: () => controller.rememberMimoKey.value,
      set: controller.updateRememberMimoKey,
    }),
    rememberOpenAiKey: computed({
      get: () => controller.rememberOpenAiKey.value,
      set: controller.updateRememberOpenAiKey,
    }),
    loadStatus: readonly(controller.loadStatus),
    persistenceStatus: readonly(controller.persistenceStatus),
    canRememberOnDevice: controller.canRememberOnDevice,
    ready: controller.ready,
    clearAllProviderSecrets: controller.clearAllProviderSecrets,
    waitForPendingWrites: controller.waitForPendingWrites,
  }
}

function createProviderSettingsController(services: PlatformServices): ProviderSettingsController {
  const ttsSettings = shallowRef<TtsSettings>(normalizeTtsSettings(defaultTtsSettings))
  const readExpansionSettings = shallowRef<ReadExpansionSettings>(
    normalizeReadExpansionSettings(defaultReadExpansionSettings),
  )
  const rememberMimoKey = shallowRef(false)
  const rememberOpenAiKey = shallowRef(false)
  const loadStatus = shallowRef<ProviderSettingsLoadStatus>('loading')
  const persistenceStatus = shallowRef<ProviderSettingsPersistenceStatus>('idle')
  const canRememberOnDevice = services.capabilities.persistentSecrets.availability === 'available'
  let writeQueue: Promise<void> = Promise.resolve()
  let lastLifecycleOperation: Promise<void> = Promise.resolve()
  let runtimeActive = services.lifecycle.currentState() === 'active'
  let lifecycleGeneration = 0
  let settingsGeneration = 0
  let latestWriteId = 0
  let disposed = false

  function queueWrite(
    task: ProviderSettingsWrite,
    options: ProviderSettingsWriteOptions = {},
  ): Promise<void> {
    const operation = writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (disposed && !options.runAfterDispose) {
          return
        }
        await task(() => !disposed)
      })
    writeQueue = operation
    return operation
  }

  function enqueueWrite(
    task: ProviderSettingsWrite,
    options: ProviderSettingsWriteOptions = {},
  ): Promise<void> {
    if (disposed) {
      return Promise.resolve()
    }
    const writeId = ++latestWriteId
    persistenceStatus.value = 'saving'
    const operation = queueWrite(task, options)
    void operation.then(
      () => {
        if (!disposed && writeId === latestWriteId) {
          persistenceStatus.value = 'saved'
        }
      },
      () => {
        if (!disposed && writeId === latestWriteId) {
          persistenceStatus.value = 'failed'
        }
      },
    )
    return operation
  }

  function persistTtsSettings(settings: TtsSettings, remember: boolean): Promise<void> {
    const secret = settings.provider === 'mimo' ? settings.mimo.apiKey.trim() : ''
    const allowSessionWrite = runtimeActive
    return enqueueWrite(async (canContinue) => {
      await services.preferences.set(
        providerPreferenceKeys.tts,
        sanitizeTtsSettingsForExport(settings),
      )
      if (!canContinue()) {
        return
      }
      await services.preferences.set(providerPreferenceKeys.rememberMimo, remember)
      if (!canContinue()) {
        return
      }
      if (!secret) {
        await services.secrets.remove(providerSecretKeys.mimo)
        return
      }
      if (!allowSessionWrite && !remember) {
        return
      }
      await services.secrets.set(
        providerSecretKeys.mimo,
        secret,
        remember ? 'device' : 'session',
      )
    })
  }

  function persistReadExpansionSettings(
    settings: ReadExpansionSettings,
    remember: boolean,
  ): Promise<void> {
    const secret = settings.ai.enabled ? settings.ai.openai.apiKey.trim() : ''
    const allowSessionWrite = runtimeActive
    return enqueueWrite(async (canContinue) => {
      await services.preferences.set(
        providerPreferenceKeys.readExpansion,
        sanitizeReadExpansionSettingsForExport(settings),
      )
      if (!canContinue()) {
        return
      }
      await services.preferences.set(providerPreferenceKeys.rememberOpenAi, remember)
      if (!canContinue()) {
        return
      }
      if (!secret) {
        await services.secrets.remove(providerSecretKeys.openAi)
        return
      }
      if (!allowSessionWrite && !remember) {
        return
      }
      await services.secrets.set(
        providerSecretKeys.openAi,
        secret,
        remember ? 'device' : 'session',
      )
    })
  }

  function updateTtsSettings(nextSettings: TtsSettings): void {
    if (disposed) {
      return
    }
    settingsGeneration += 1
    let normalized = normalizeTtsSettings(nextSettings)
    let shouldRemember = rememberMimoKey.value
    if (normalized.provider !== 'mimo' || !normalized.mimo.apiKey.trim()) {
      normalized = clearMimoApiKey(normalized)
      shouldRemember = false
    }
    ttsSettings.value = normalized
    rememberMimoKey.value = shouldRemember
    void persistTtsSettings(normalized, shouldRemember)
  }

  function updateReadExpansionSettings(nextSettings: ReadExpansionSettings): void {
    if (disposed) {
      return
    }
    settingsGeneration += 1
    let normalized = normalizeReadExpansionSettings(nextSettings)
    let shouldRemember = rememberOpenAiKey.value
    if (!normalized.ai.enabled || !normalized.ai.openai.apiKey.trim()) {
      normalized = clearAiApiKey(normalized)
      shouldRemember = false
    }
    readExpansionSettings.value = normalized
    rememberOpenAiKey.value = shouldRemember
    void persistReadExpansionSettings(normalized, shouldRemember)
  }

  function updateRememberMimoKey(remember: boolean): void {
    if (disposed) {
      return
    }
    settingsGeneration += 1
    const shouldRemember = remember
      && canRememberOnDevice
      && ttsSettings.value.provider === 'mimo'
      && Boolean(ttsSettings.value.mimo.apiKey.trim())
    rememberMimoKey.value = shouldRemember
    void persistTtsSettings(ttsSettings.value, shouldRemember)
  }

  function updateRememberOpenAiKey(remember: boolean): void {
    if (disposed) {
      return
    }
    settingsGeneration += 1
    const shouldRemember = remember
      && canRememberOnDevice
      && readExpansionSettings.value.ai.enabled
      && Boolean(readExpansionSettings.value.ai.openai.apiKey.trim())
    rememberOpenAiKey.value = shouldRemember
    void persistReadExpansionSettings(readExpansionSettings.value, shouldRemember)
  }

  async function clearAllProviderSecrets(): Promise<void> {
    if (disposed) {
      return
    }
    settingsGeneration += 1
    const nextTtsSettings = clearMimoApiKey(ttsSettings.value)
    const nextReadExpansionSettings = clearAiApiKey(readExpansionSettings.value)
    ttsSettings.value = nextTtsSettings
    readExpansionSettings.value = nextReadExpansionSettings
    rememberMimoKey.value = false
    rememberOpenAiKey.value = false

    await enqueueWrite(async (canContinue) => {
      await services.secrets.clear()
      if (!canContinue()) {
        return
      }
      await services.preferences.set(
        providerPreferenceKeys.tts,
        sanitizeTtsSettingsForExport(nextTtsSettings),
      )
      if (!canContinue()) {
        return
      }
      await services.preferences.set(
        providerPreferenceKeys.readExpansion,
        sanitizeReadExpansionSettingsForExport(nextReadExpansionSettings),
      )
      if (!canContinue()) {
        return
      }
      await services.preferences.set(providerPreferenceKeys.rememberMimo, false)
      if (!canContinue()) {
        return
      }
      await services.preferences.set(providerPreferenceKeys.rememberOpenAi, false)
    })
  }

  function clearRuntimeProviderState(): void {
    ttsSettings.value = clearMimoApiKey(ttsSettings.value)
    readExpansionSettings.value = clearAiApiKey(readExpansionSettings.value)
  }

  function suspendRuntimeSecrets(): void {
    if (disposed) {
      return
    }
    runtimeActive = false
    lifecycleGeneration += 1
    clearRuntimeProviderState()
    lastLifecycleOperation = enqueueWrite(
      async () => {
        await services.secrets.clearSession()
      },
      { runAfterDispose: true },
    )
  }

  async function restoreRememberedDeviceSecrets(
    generation: number,
    expectedSettingsGeneration: number,
    previousLifecycleOperation: Promise<void>,
  ): Promise<void> {
    await ready
    await previousLifecycleOperation
    await writeQueue
    if (disposed
      || !runtimeActive
      || generation !== lifecycleGeneration
      || expectedSettingsGeneration !== settingsGeneration) {
      return
    }

    const [storedRememberMimo, storedRememberOpenAi, storedMimoKey, storedOpenAiKey]
      = await Promise.all([
        services.preferences.get<boolean>(providerPreferenceKeys.rememberMimo),
        services.preferences.get<boolean>(providerPreferenceKeys.rememberOpenAi),
        services.secrets.get(providerSecretKeys.mimo),
        services.secrets.get(providerSecretKeys.openAi),
      ])
    if (disposed
      || !runtimeActive
      || generation !== lifecycleGeneration
      || expectedSettingsGeneration !== settingsGeneration) {
      return
    }

    const mimoKey = storedMimoKey?.trim() ?? ''
    const shouldRestoreMimo = storedRememberMimo === true
      && ttsSettings.value.provider === 'mimo'
      && isSupportedMimoApiKey(mimoKey)
    rememberMimoKey.value = shouldRestoreMimo
    ttsSettings.value = shouldRestoreMimo
      ? {
          ...ttsSettings.value,
          mimo: { ...ttsSettings.value.mimo, apiKey: mimoKey },
        }
      : clearMimoApiKey(ttsSettings.value)

    const openAiKey = storedOpenAiKey?.trim() ?? ''
    const shouldRestoreOpenAi = storedRememberOpenAi === true
      && readExpansionSettings.value.ai.enabled
      && Boolean(openAiKey)
    rememberOpenAiKey.value = shouldRestoreOpenAi
    readExpansionSettings.value = shouldRestoreOpenAi
      ? {
          ...readExpansionSettings.value,
          ai: {
            ...readExpansionSettings.value.ai,
            consentAccepted: false,
            openai: {
              ...readExpansionSettings.value.ai.openai,
              apiKey: openAiKey,
            },
          },
        }
      : clearAiApiKey(readExpansionSettings.value)
  }

  function resumeRememberedDeviceSecrets(): void {
    if (disposed) {
      return
    }
    runtimeActive = true
    const generation = ++lifecycleGeneration
    const expectedSettingsGeneration = settingsGeneration
    const previousLifecycleOperation = lastLifecycleOperation
    const operation = restoreRememberedDeviceSecrets(
      generation,
      expectedSettingsGeneration,
      previousLifecycleOperation,
    )
    lastLifecycleOperation = operation
    void operation.catch(() => {
      if (!disposed && generation === lifecycleGeneration) {
        persistenceStatus.value = 'failed'
      }
    })
  }

  async function hydrate(): Promise<void> {
    const hydrateGeneration = lifecycleGeneration
    const hydrateSettingsGeneration = settingsGeneration
    const hydrationIsCurrent = () => !disposed
      && hydrateSettingsGeneration === settingsGeneration
    const settleStaleHydration = () => {
      if (!disposed) {
        loadStatus.value = 'ready'
      }
    }
    try {
      const [
        storedTtsSettings,
        storedReadExpansionSettings,
        storedRememberMimo,
        storedRememberOpenAi,
        storedMimoKey,
        storedOpenAiKey,
      ] = await Promise.all([
        services.preferences.get<unknown>(providerPreferenceKeys.tts),
        services.preferences.get<unknown>(providerPreferenceKeys.readExpansion),
        services.preferences.get<boolean>(providerPreferenceKeys.rememberMimo),
        services.preferences.get<boolean>(providerPreferenceKeys.rememberOpenAi),
        services.secrets.get(providerSecretKeys.mimo),
        services.secrets.get(providerSecretKeys.openAi),
      ])
      if (!hydrationIsCurrent()) {
        settleStaleHydration()
        return
      }

      const normalizedTts = normalizeTtsSettings(storedTtsSettings)
      const mimoKey = storedMimoKey?.trim() ?? ''
      const mimoActive = normalizedTts.provider === 'mimo'
        && canRememberOnDevice
        && storedRememberMimo === true
        && isSupportedMimoApiKey(mimoKey)
      const hydratedTtsSettings = mimoActive
        ? {
            ...normalizedTts,
            mimo: { ...normalizedTts.mimo, apiKey: mimoKey },
          }
        : clearMimoApiKey(normalizedTts)

      const normalizedExpansion = clearAiApiKey(
        normalizeReadExpansionSettings(storedReadExpansionSettings),
      )
      const openAiKey = storedOpenAiKey?.trim() ?? ''
      const openAiActive = normalizedExpansion.ai.enabled
        && canRememberOnDevice
        && storedRememberOpenAi === true
        && Boolean(openAiKey)
      const hydratedReadExpansionSettings = openAiActive
        ? {
            ...normalizedExpansion,
            ai: {
              ...normalizedExpansion.ai,
              openai: { ...normalizedExpansion.ai.openai, apiKey: openAiKey },
            },
          }
        : normalizedExpansion

      if (!hydrationIsCurrent()) {
        settleStaleHydration()
        return
      }
      ttsSettings.value = hydratedTtsSettings
      rememberMimoKey.value = mimoActive
      readExpansionSettings.value = hydratedReadExpansionSettings
      rememberOpenAiKey.value = openAiActive

      const needsTtsCleanup = Boolean(mimoKey) && !mimoActive
      const needsOpenAiCleanup = Boolean(openAiKey) && !openAiActive
      const needsRememberNormalization = storedRememberMimo !== mimoActive
        || storedRememberOpenAi !== openAiActive
      if (needsTtsCleanup || needsOpenAiCleanup || needsRememberNormalization) {
        await queueWrite(async (canContinue) => {
          const cleanupCanContinue = () => canContinue() && hydrationIsCurrent()
          if (!cleanupCanContinue()) {
            return
          }
          if (needsTtsCleanup) {
            await services.secrets.remove(providerSecretKeys.mimo)
            if (!cleanupCanContinue()) {
              return
            }
          }
          if (needsOpenAiCleanup) {
            await services.secrets.remove(providerSecretKeys.openAi)
            if (!cleanupCanContinue()) {
              return
            }
          }
          await services.preferences.set(providerPreferenceKeys.rememberMimo, mimoActive)
          if (!cleanupCanContinue()) {
            return
          }
          await services.preferences.set(providerPreferenceKeys.rememberOpenAi, openAiActive)
        })
      }
      if (!hydrationIsCurrent()) {
        settleStaleHydration()
        return
      }
      if (!runtimeActive || hydrateGeneration !== lifecycleGeneration) {
        clearRuntimeProviderState()
      }
      loadStatus.value = 'ready'
    }
    catch {
      if (!disposed) {
        loadStatus.value = 'failed'
        persistenceStatus.value = 'failed'
      }
    }
  }

  const ready = hydrate()
  const unsubscribeLifecycle = services.lifecycle.subscribe((event) => {
    if (event.state === 'active') {
      resumeRememberedDeviceSecrets()
      return
    }
    suspendRuntimeSecrets()
  })
  if (!runtimeActive) {
    suspendRuntimeSecrets()
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    runtimeActive = false
    lifecycleGeneration += 1
    settingsGeneration += 1
    latestWriteId += 1
    unsubscribeLifecycle()
    clearRuntimeProviderState()
    lastLifecycleOperation = queueWrite(
      async () => {
        await services.secrets.clearSession()
      },
      { runAfterDispose: true },
    )
    void lastLifecycleOperation.catch(() => undefined)
  }

  return {
    ttsSettings,
    readExpansionSettings,
    rememberMimoKey,
    rememberOpenAiKey,
    loadStatus,
    persistenceStatus,
    canRememberOnDevice,
    ready,
    updateTtsSettings,
    updateReadExpansionSettings,
    updateRememberMimoKey,
    updateRememberOpenAiKey,
    clearAllProviderSecrets,
    waitForPendingWrites: async () => {
      await writeQueue.catch(() => undefined)
      await lastLifecycleOperation.catch(() => undefined)
    },
    dispose,
  }
}
