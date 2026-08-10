import { createApp, type App as VueApp } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import {
  defaultReaderDisplayPreferences,
  readerDisplayPreferenceKey,
  type ReaderDisplayPreferencesBindings,
  useReaderDisplayPreferences,
} from '@/features/preferences/useReaderDisplayPreferences'
import {
  createFakePlatformServices,
  type FakePlatformHarness,
} from '@/platform/fake/createFakePlatformServices'

const mountedApps: VueApp[] = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
})

describe('reader display preferences', () => {
  it('hydrates valid preferences from the single versioned preference key', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(readerDisplayPreferenceKey, {
      fontScale: 1.3,
      defaultExpandTranslation: true,
    })

    const { bindings } = mountPreferences(harness)
    await bindings.ready

    expect(readerDisplayPreferenceKey).toBe('reader:display:v1')
    expect(bindings.fontScale.value).toBe(1.3)
    expect(bindings.defaultExpandTranslation.value).toBe(true)
    expect(bindings.persistence).toBe('session')
    expect(bindings.persistenceStatus.value).toBe('idle')
  })

  it.each([
    null,
    [],
    { fontScale: 1.1, defaultExpandTranslation: true },
    { fontScale: 1, defaultExpandTranslation: 'yes' },
    { fontScale: 1.15 },
  ])('falls back to defaults for a damaged stored value: %j', async (stored) => {
    const harness = createFakePlatformServices()
    if (stored !== null) {
      await harness.preferences.set(readerDisplayPreferenceKey, stored)
    }

    const { bindings } = mountPreferences(harness)
    await bindings.ready

    expect(bindings.fontScale.value).toBe(defaultReaderDisplayPreferences.fontScale)
    expect(bindings.defaultExpandTranslation.value)
      .toBe(defaultReaderDisplayPreferences.defaultExpandTranslation)
    expect(bindings.persistenceStatus.value).toBe('idle')
  })

  it('shares readonly state between consumers in one app', async () => {
    const { allBindings } = mountPreferences(createFakePlatformServices(), 2)
    const [first, second] = allBindings
    await first.ready

    first.setFontScale(1.15)
    first.setDefaultExpandTranslation(true)

    expect(second.fontScale.value).toBe(1.15)
    expect(second.defaultExpandTranslation.value).toBe(true)
    await first.waitForPendingWrites()
  })

  it('atomically patches different fields from separate app controllers', async () => {
    const harness = createFakePlatformServices()
    const first = mountPreferences(harness).bindings
    const second = mountPreferences(harness).bindings
    await Promise.all([first.ready, second.ready])

    first.setFontScale(1.3)
    second.setDefaultExpandTranslation(true)
    await Promise.all([first.waitForPendingWrites(), second.waitForPendingWrites()])

    expect(await harness.preferences.get(readerDisplayPreferenceKey)).toEqual({
      fontScale: 1.3,
      defaultExpandTranslation: true,
    })
  })

  it('serializes preference snapshots and leaves the latest snapshot stored', async () => {
    const mount = mountPreferences()
    const { bindings, harness } = mount
    await bindings.ready
    const firstWriteStarted = createDeferred()
    const releaseFirstWrite = createDeferred()
    const originalUpdate = harness.preferences.update.bind(harness.preferences)
    const writes: unknown[] = []
    let activeWrites = 0
    let maximumActiveWrites = 0

    harness.preferences.update = async <T>(
      key: string,
      updater: (current: unknown | null) => T | null,
    ) => {
      activeWrites += 1
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
      if (activeWrites === 1 && writes.length === 0) {
        firstWriteStarted.resolve()
        await releaseFirstWrite.promise
      }
      const result = await originalUpdate(key, (current) => {
        const next = updater(current)
        writes.push(structuredClone(next))
        return next
      })
      activeWrites -= 1
      return result as T | null
    }

    bindings.setFontScale(1.15)
    bindings.setDefaultExpandTranslation(true)
    await firstWriteStarted.promise

    expect(bindings.persistenceStatus.value).toBe('saving')
    expect(writes).toEqual([])
    releaseFirstWrite.resolve()
    await bindings.waitForPendingWrites()

    expect(maximumActiveWrites).toBe(1)
    expect(writes).toEqual([
      { fontScale: 1.15, defaultExpandTranslation: false },
      { fontScale: 1.15, defaultExpandTranslation: true },
    ])
    expect(await harness.preferences.get(readerDisplayPreferenceKey)).toEqual(writes[1])
    expect(bindings.persistenceStatus.value).toBe('saved')
  })

  it('does not let an older merged write result overwrite a newer local field action', async () => {
    const { bindings, harness } = mountPreferences()
    await bindings.ready
    const firstWriteStored = createDeferred()
    const releaseFirstResult = createDeferred()
    const secondWriteStarted = createDeferred()
    const releaseSecondWrite = createDeferred()
    const originalUpdate = harness.preferences.update.bind(harness.preferences)
    let writeCount = 0

    harness.preferences.update = async <T>(
      key: string,
      updater: (current: unknown | null) => T | null,
    ) => {
      writeCount += 1
      if (writeCount === 1) {
        const stored = await originalUpdate(key, updater)
        firstWriteStored.resolve()
        await releaseFirstResult.promise
        return stored
      }
      secondWriteStarted.resolve()
      await releaseSecondWrite.promise
      return originalUpdate(key, updater)
    }

    bindings.setFontScale(1.15)
    await firstWriteStored.promise
    bindings.setDefaultExpandTranslation(true)
    releaseFirstResult.resolve()
    await secondWriteStarted.promise

    expect(bindings.defaultExpandTranslation.value).toBe(true)

    releaseSecondWrite.resolve()
    await bindings.waitForPendingWrites()
    expect(await harness.preferences.get(readerDisplayPreferenceKey)).toEqual({
      fontScale: 1.15,
      defaultExpandTranslation: true,
    })
    expect(bindings.persistenceStatus.value).toBe('saved')
  })

  it('continues the write queue after a failure without rejecting callers', async () => {
    const { bindings, harness } = mountPreferences()
    await bindings.ready
    const originalUpdate = harness.preferences.update.bind(harness.preferences)
    let writeCount = 0
    harness.preferences.update = async <T>(
      key: string,
      updater: (current: unknown | null) => T | null,
    ) => {
      writeCount += 1
      if (writeCount === 1) {
        throw new Error('first write failed')
      }
      return originalUpdate(key, updater)
    }

    bindings.setFontScale(0.9)
    bindings.setDefaultExpandTranslation(true)
    await expect(bindings.waitForPendingWrites()).resolves.toBeUndefined()

    expect(writeCount).toBe(2)
    expect(await harness.preferences.get(readerDisplayPreferenceKey)).toEqual({
      fontScale: 1,
      defaultExpandTranslation: true,
    })
    expect(bindings.persistenceStatus.value).toBe('error')

    bindings.setFontScale(0.9)
    await expect(bindings.waitForPendingWrites()).resolves.toBeUndefined()
    expect(await harness.preferences.get(readerDisplayPreferenceKey)).toEqual({
      fontScale: 0.9,
      defaultExpandTranslation: true,
    })
    expect(bindings.persistenceStatus.value).toBe('saved')
  })

  it('reports read and latest-write failures without blocking defaults or later actions', async () => {
    const readFailureHarness = createFakePlatformServices()
    readFailureHarness.preferences.get = async () => {
      throw new Error('read failed')
    }
    const readFailure = mountPreferences(readFailureHarness).bindings

    await expect(readFailure.ready).resolves.toBeUndefined()
    expect(readFailure.fontScale.value).toBe(defaultReaderDisplayPreferences.fontScale)
    expect(readFailure.defaultExpandTranslation.value)
      .toBe(defaultReaderDisplayPreferences.defaultExpandTranslation)
    expect(readFailure.persistenceStatus.value).toBe('error')

    const writeFailureMount = mountPreferences()
    await writeFailureMount.bindings.ready
    writeFailureMount.harness.preferences.update = async () => {
      throw new Error('write failed')
    }
    writeFailureMount.bindings.setFontScale(1.3)

    await expect(writeFailureMount.bindings.waitForPendingWrites()).resolves.toBeUndefined()
    expect(writeFailureMount.bindings.fontScale.value).toBe(1.3)
    expect(writeFailureMount.bindings.persistenceStatus.value).toBe('error')
  })

  it('adopts the actual merged record after a failed initial read and a partial update', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(readerDisplayPreferenceKey, {
      fontScale: 0.9,
      defaultExpandTranslation: true,
    })
    harness.preferences.get = async () => {
      throw new Error('initial read failed')
    }
    const { bindings } = mountPreferences(harness)
    await bindings.ready

    bindings.setFontScale(1.3)
    await bindings.waitForPendingWrites()

    expect(bindings.fontScale.value).toBe(1.3)
    expect(bindings.defaultExpandTranslation.value).toBe(true)
    expect(bindings.persistenceStatus.value).toBe('saved')
    expect(harness.preferences.getImmediately(readerDisplayPreferenceKey)).toEqual({
      fontScale: 1.3,
      defaultExpandTranslation: true,
    })
  })

  it('does not let late hydration overwrite a newer local action', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(readerDisplayPreferenceKey, {
      fontScale: 1.3,
      defaultExpandTranslation: true,
    })
    const readStarted = createDeferred()
    const releaseRead = createDeferred()
    const originalGet = harness.preferences.get.bind(harness.preferences)
    harness.preferences.get = async <T>(key: string) => {
      readStarted.resolve()
      await releaseRead.promise
      return originalGet<T>(key)
    }
    const { bindings } = mountPreferences(harness)
    await readStarted.promise

    bindings.setFontScale(0.9)
    releaseRead.resolve()
    await bindings.ready
    await bindings.waitForPendingWrites()

    expect(bindings.fontScale.value).toBe(0.9)
    expect(bindings.defaultExpandTranslation.value).toBe(true)
    expect(await harness.preferences.getImmediately(readerDisplayPreferenceKey)).toEqual({
      fontScale: 0.9,
      defaultExpandTranslation: true,
    })
  })

  it('hydrates an untouched field when a concurrent local write fails', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(readerDisplayPreferenceKey, {
      fontScale: 1.3,
      defaultExpandTranslation: true,
    })
    const readStarted = createDeferred()
    const releaseRead = createDeferred()
    const originalGet = harness.preferences.get.bind(harness.preferences)
    harness.preferences.get = async <T>(key: string) => {
      readStarted.resolve()
      await releaseRead.promise
      return originalGet<T>(key)
    }
    harness.preferences.update = async () => {
      throw new Error('preference quota exceeded')
    }
    const { bindings } = mountPreferences(harness)
    await readStarted.promise

    bindings.setFontScale(0.9)
    await bindings.waitForPendingWrites()
    releaseRead.resolve()
    await bindings.ready

    expect(bindings.fontScale.value).toBe(0.9)
    expect(bindings.defaultExpandTranslation.value).toBe(true)
    expect(bindings.persistenceStatus.value).toBe('error')
  })

  it('does not let a stale hydration replace a newer merged write result', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(readerDisplayPreferenceKey, {
      fontScale: 1.3,
      defaultExpandTranslation: false,
    })
    const staleStoredValue = harness.preferences.getImmediately(readerDisplayPreferenceKey)
    const readStarted = createDeferred()
    const releaseRead = createDeferred()
    harness.preferences.get = async <T>() => {
      readStarted.resolve()
      await releaseRead.promise
      return structuredClone(staleStoredValue) as T
    }
    const { bindings } = mountPreferences(harness)
    await readStarted.promise
    harness.preferences.updateImmediately(readerDisplayPreferenceKey, current => ({
      ...(current as Record<string, unknown>),
      defaultExpandTranslation: true,
    }))

    bindings.setFontScale(0.9)
    await bindings.waitForPendingWrites()
    releaseRead.resolve()
    await bindings.ready

    expect(bindings.fontScale.value).toBe(0.9)
    expect(bindings.defaultExpandTranslation.value).toBe(true)
    expect(bindings.persistenceStatus.value).toBe('saved')
  })
})

function mountPreferences(
  harness: FakePlatformHarness = createFakePlatformServices(),
  consumerCount = 1,
) {
  const allBindings: ReaderDisplayPreferencesBindings[] = []
  const app = createApp({
    setup() {
      for (let index = 0; index < consumerCount; index += 1) {
        allBindings.push(useReaderDisplayPreferences())
      }
      return () => null
    },
  })
  app.provide(platformServicesKey, harness.services)
  app.mount(document.createElement('div'))
  mountedApps.push(app)

  const bindings = allBindings[0]
  if (!bindings) {
    throw new Error('Reader display preferences did not initialize.')
  }
  return { app, bindings, allBindings, harness }
}

function createDeferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
