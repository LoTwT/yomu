import {
  getCurrentInstance,
  readonly,
  shallowRef,
  type App as VueApp,
  type ShallowRef,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { PlatformServices, PreferencePersistence } from '@/platform/contracts'

export const readerDisplayPreferenceKey = 'reader:display:v1'

export const readerFontScales = [0.9, 1, 1.15, 1.3] as const

export type ReaderFontScale = typeof readerFontScales[number]

export interface ReaderDisplayPreferences {
  fontScale: ReaderFontScale
  defaultExpandTranslation: boolean
}

export type ReaderDisplayPreferencesPersistenceStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'

export const defaultReaderDisplayPreferences: Readonly<ReaderDisplayPreferences> = Object.freeze({
  fontScale: 1,
  defaultExpandTranslation: false,
})

export interface ReaderDisplayPreferencesBindings {
  fontScale: Readonly<ShallowRef<ReaderFontScale>>
  defaultExpandTranslation: Readonly<ShallowRef<boolean>>
  readonly persistence: PreferencePersistence
  persistenceStatus: Readonly<ShallowRef<ReaderDisplayPreferencesPersistenceStatus>>
  ready: Promise<void>
  setFontScale: (fontScale: ReaderFontScale) => void
  setDefaultExpandTranslation: (expand: boolean) => void
  waitForPendingWrites: () => Promise<void>
}

interface ReaderDisplayPreferencesController {
  fontScale: ShallowRef<ReaderFontScale>
  defaultExpandTranslation: ShallowRef<boolean>
  readonly persistence: PreferencePersistence
  persistenceStatus: ShallowRef<ReaderDisplayPreferencesPersistenceStatus>
  ready: Promise<void>
  setFontScale: (fontScale: ReaderFontScale) => void
  setDefaultExpandTranslation: (expand: boolean) => void
  waitForPendingWrites: () => Promise<void>
  dispose: () => void
}

type ReaderDisplayPreferencesPatch =
  | Pick<ReaderDisplayPreferences, 'fontScale'>
  | Pick<ReaderDisplayPreferences, 'defaultExpandTranslation'>

type ReaderDisplayPreferenceField = keyof ReaderDisplayPreferences

const controllers = new WeakMap<VueApp, ReaderDisplayPreferencesController>()

export function useReaderDisplayPreferences(): ReaderDisplayPreferencesBindings {
  const instance = getCurrentInstance()
  if (!instance) {
    throw new Error('Reader display preferences must be used inside a Vue application setup context.')
  }

  const app = instance.appContext.app
  const services = usePlatformServices()
  let controller = controllers.get(app)
  if (!controller) {
    const createdController = createReaderDisplayPreferencesController(services)
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
    fontScale: readonly(controller.fontScale),
    defaultExpandTranslation: readonly(controller.defaultExpandTranslation),
    persistence: controller.persistence,
    persistenceStatus: readonly(controller.persistenceStatus),
    ready: controller.ready,
    setFontScale: controller.setFontScale,
    setDefaultExpandTranslation: controller.setDefaultExpandTranslation,
    waitForPendingWrites: controller.waitForPendingWrites,
  }
}

export function isReaderFontScale(value: unknown): value is ReaderFontScale {
  return readerFontScales.some(scale => scale === value)
}

function createReaderDisplayPreferencesController(
  services: PlatformServices,
): ReaderDisplayPreferencesController {
  const fontScale = shallowRef<ReaderFontScale>(defaultReaderDisplayPreferences.fontScale)
  const defaultExpandTranslation = shallowRef(
    defaultReaderDisplayPreferences.defaultExpandTranslation,
  )
  const persistenceStatus = shallowRef<ReaderDisplayPreferencesPersistenceStatus>('idle')
  let fontScaleGeneration = 0
  let defaultExpandTranslationGeneration = 0
  let latestWriteId = 0
  let writeQueue: Promise<void> = Promise.resolve()
  const failedFields = new Set<ReaderDisplayPreferenceField>()
  const latestMergedWriteIds: Record<ReaderDisplayPreferenceField, number> = {
    fontScale: 0,
    defaultExpandTranslation: 0,
  }
  let disposed = false

  function persist(patch: ReaderDisplayPreferencesPatch): void {
    const writeId = ++latestWriteId
    const fields = fieldsInPatch(patch)
    const generations = {
      fontScale: fontScaleGeneration,
      defaultExpandTranslation: defaultExpandTranslationGeneration,
    }
    persistenceStatus.value = 'saving'
    const operation = writeQueue
      .catch(() => undefined)
      .then(() => services.preferences.update<ReaderDisplayPreferences>(
        readerDisplayPreferenceKey,
        current => ({ ...normalizeReaderDisplayPreferences(current), ...patch }),
      ))
      .then((stored) => {
        if (!isReaderDisplayPreferences(stored)) {
          throw new Error('Preference update did not return the stored reader display record.')
        }
        if (disposed) {
          return
        }
        if (fontScaleGeneration === generations.fontScale) {
          fontScale.value = stored.fontScale
          latestMergedWriteIds.fontScale = writeId
        }
        if (defaultExpandTranslationGeneration === generations.defaultExpandTranslation) {
          defaultExpandTranslation.value = stored.defaultExpandTranslation
          latestMergedWriteIds.defaultExpandTranslation = writeId
        }
      })
    writeQueue = operation
    void operation.then(
      () => {
        fields.forEach(field => failedFields.delete(field))
        if (!disposed && writeId === latestWriteId) {
          persistenceStatus.value = failedFields.size === 0 ? 'saved' : 'error'
        }
      },
      () => {
        fields.forEach(field => failedFields.add(field))
        if (!disposed && writeId === latestWriteId) {
          persistenceStatus.value = 'error'
        }
      },
    )
  }

  function setFontScale(nextFontScale: ReaderFontScale): void {
    if (disposed || !isReaderFontScale(nextFontScale)) {
      return
    }
    fontScaleGeneration += 1
    fontScale.value = nextFontScale
    persist({ fontScale: nextFontScale })
  }

  function setDefaultExpandTranslation(expand: boolean): void {
    if (disposed || typeof expand !== 'boolean') {
      return
    }
    defaultExpandTranslationGeneration += 1
    defaultExpandTranslation.value = expand
    persist({ defaultExpandTranslation: expand })
  }

  async function hydrate(): Promise<void> {
    const initialFontScaleGeneration = fontScaleGeneration
    const initialDefaultExpandTranslationGeneration = defaultExpandTranslationGeneration
    const initialMergedWriteIds = { ...latestMergedWriteIds }
    try {
      const stored = await services.preferences.get<unknown>(readerDisplayPreferenceKey)
      if (disposed) {
        return
      }
      const normalized = normalizeReaderDisplayPreferences(stored)
      if (fontScaleGeneration === initialFontScaleGeneration
        && latestMergedWriteIds.fontScale === initialMergedWriteIds.fontScale) {
        fontScale.value = normalized.fontScale
      }
      if (defaultExpandTranslationGeneration === initialDefaultExpandTranslationGeneration
        && latestMergedWriteIds.defaultExpandTranslation
        === initialMergedWriteIds.defaultExpandTranslation) {
        defaultExpandTranslation.value = normalized.defaultExpandTranslation
      }
    }
    catch {
      if (!disposed && latestWriteId === 0) {
        persistenceStatus.value = 'error'
      }
    }
  }

  const ready = hydrate()

  return {
    fontScale,
    defaultExpandTranslation,
    persistence: services.preferences.persistence,
    persistenceStatus,
    ready,
    setFontScale,
    setDefaultExpandTranslation,
    waitForPendingWrites: async () => {
      await writeQueue.catch(() => undefined)
    },
    dispose: () => {
      disposed = true
      fontScaleGeneration += 1
      defaultExpandTranslationGeneration += 1
      latestWriteId += 1
    },
  }
}

function normalizeReaderDisplayPreferences(value: unknown): ReaderDisplayPreferences {
  if (!isReaderDisplayPreferences(value)) {
    return { ...defaultReaderDisplayPreferences }
  }
  return {
    fontScale: value.fontScale,
    defaultExpandTranslation: value.defaultExpandTranslation,
  }
}

function isReaderDisplayPreferences(value: unknown): value is ReaderDisplayPreferences {
  return isRecord(value)
    && isReaderFontScale(value.fontScale)
    && typeof value.defaultExpandTranslation === 'boolean'
}

function fieldsInPatch(patch: ReaderDisplayPreferencesPatch): ReaderDisplayPreferenceField[] {
  return 'fontScale' in patch
    ? ['fontScale']
    : ['defaultExpandTranslation']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
