/** @vitest-environment jsdom */

import { createApp, type App as VueApp } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import {
  type ProviderSettingsBindings,
  useProviderSettings,
} from '@/features/settings/useProviderSettings'
import {
  defaultReadExpansionSettings,
  type ReadExpansionSettings,
} from '@/features/extension/settings'
import { providerPreferenceKeys, providerSecretKeys } from '@/features/settings/providerSettingsStorage'
import { defaultTtsSettings, type TtsSettings } from '@/features/tts/settings'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'

const mountedApps: VueApp[] = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
})

describe('provider settings lifecycle', () => {
  it('rejects orphaned device secrets without an explicit remember preference', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(providerPreferenceKeys.tts, createMimoSettings(''))
    await harness.preferences.set(
      providerPreferenceKeys.readExpansion,
      createAiSettings('', false),
    )
    await harness.secrets.set(providerSecretKeys.mimo, 'orphaned-mimo-key', 'device')
    await harness.secrets.set(providerSecretKeys.openAi, 'orphaned-openai-key', 'device')

    const { bindings } = mountProviderSettings(harness)
    await bindings.ready

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('')
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBe(false)
    expect(await harness.preferences.get(providerPreferenceKeys.rememberOpenAi)).toBe(false)
  })

  it('redacts session keys immediately and clears them after pending writes', async () => {
    const { bindings, harness } = mountProviderSettings()
    await bindings.ready

    bindings.ttsSettings.value = createMimoSettings('session-mimo-key')
    bindings.readExpansionSettings.value = createAiSettings('session-openai-key', true)
    harness.lifecycle.emit('background')

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.consentAccepted).toBe(false)

    await bindings.waitForPendingWrites()
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBeNull()

    await harness.secrets.set(providerSecretKeys.mimo, 'device-key-without-consent', 'device')
    harness.lifecycle.emit('active')
    await bindings.waitForPendingWrites()

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('')
  })

  it('restores explicitly remembered device keys without restoring cloud consent', async () => {
    const { bindings, harness } = mountProviderSettings()
    await bindings.ready

    bindings.ttsSettings.value = createMimoSettings('remembered-mimo-key')
    bindings.rememberMimoKey.value = true
    bindings.readExpansionSettings.value = createAiSettings('remembered-openai-key', true)
    bindings.rememberOpenAiKey.value = true
    harness.lifecycle.emit('suspended')

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.consentAccepted).toBe(false)

    await bindings.waitForPendingWrites()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBe(true)
    expect(await harness.preferences.get(providerPreferenceKeys.rememberOpenAi)).toBe(true)
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBe('remembered-mimo-key')
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBe('remembered-openai-key')

    harness.lifecycle.emit('active')
    await bindings.waitForPendingWrites()

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('remembered-mimo-key')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('remembered-openai-key')
    expect(bindings.readExpansionSettings.value.ai.consentAccepted).toBe(false)
  })

  it('shares one controller between consumers in the same app', async () => {
    const { allBindings } = mountProviderSettings(createFakePlatformServices(), 2)
    const [first, second] = allBindings
    await Promise.all(allBindings.map(bindings => bindings.ready))

    first.ttsSettings.value = createMimoSettings('shared-app-key')

    expect(second.ttsSettings.value.mimo.apiKey).toBe('shared-app-key')
    await first.waitForPendingWrites()
  })

  it('isolates controllers for different apps that reuse the same platform services', async () => {
    const harness = createFakePlatformServices()
    const firstMount = mountProviderSettings(harness)
    const secondMount = mountProviderSettings(harness)
    await Promise.all([firstMount.bindings.ready, secondMount.bindings.ready])

    firstMount.bindings.ttsSettings.value = createMimoSettings('first-app-key')
    expect(secondMount.bindings.ttsSettings.value.mimo.apiKey).toBe('')

    unmountTrackedApp(firstMount.app)
    secondMount.bindings.ttsSettings.value = createMimoSettings('second-app-session-key')
    harness.lifecycle.emit('background')

    expect(secondMount.bindings.ttsSettings.value.mimo.apiKey).toBe('')
    await secondMount.bindings.waitForPendingWrites()
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
  })

  it('unsubscribes on app unmount and invalidates a late secret restore', async () => {
    const mount = mountProviderSettings()
    const { app, bindings, harness } = mount
    await bindings.ready

    bindings.ttsSettings.value = createMimoSettings('remembered-before-unmount')
    bindings.rememberMimoKey.value = true
    harness.lifecycle.emit('suspended')
    await bindings.waitForPendingWrites()

    const restoreReadStarted = createDeferred()
    const releaseRestoreRead = createDeferred()
    const originalGet = harness.secrets.get.bind(harness.secrets)
    let secretReadCount = 0
    harness.secrets.get = async (key) => {
      secretReadCount += 1
      restoreReadStarted.resolve()
      await releaseRestoreRead.promise
      return originalGet(key)
    }

    harness.lifecycle.emit('active')
    await restoreReadStarted.promise
    unmountTrackedApp(app)
    releaseRestoreRead.resolve()
    await bindings.waitForPendingWrites()

    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    const readsAfterUnmount = secretReadCount
    harness.lifecycle.emit('active')
    await Promise.resolve()
    expect(secretReadCount).toBe(readsAfterUnmount)
  })

  it('does not let late hydration restore settings after provider secrets are cleared', async () => {
    const harness = createFakePlatformServices()
    await harness.preferences.set(providerPreferenceKeys.tts, createMimoSettings(''))
    await harness.preferences.set(
      providerPreferenceKeys.readExpansion,
      createAiSettings('', false),
    )
    await harness.preferences.set(providerPreferenceKeys.rememberMimo, true)
    await harness.preferences.set(providerPreferenceKeys.rememberOpenAi, true)
    await harness.secrets.set(providerSecretKeys.mimo, 'stale-mimo-key', 'device')
    await harness.secrets.set(providerSecretKeys.openAi, 'stale-openai-key', 'device')

    const hydrationReadsStarted = createDeferred()
    const releaseHydrationReads = createDeferred()
    const originalPreferenceGet = harness.preferences.get.bind(harness.preferences)
    const originalSecretGet = harness.secrets.get.bind(harness.secrets)
    let hydrationReadCount = 0
    const holdHydrationRead = async <T>(value: T): Promise<T> => {
      hydrationReadCount += 1
      if (hydrationReadCount === 6) {
        hydrationReadsStarted.resolve()
      }
      await releaseHydrationReads.promise
      return value
    }
    harness.preferences.get = async <T>(key: string) =>
      holdHydrationRead(await originalPreferenceGet<T>(key))
    harness.secrets.get = async (key: string) =>
      holdHydrationRead(await originalSecretGet(key))

    const { bindings } = mountProviderSettings(harness)
    await hydrationReadsStarted.promise
    await bindings.clearAllProviderSecrets()

    expect(await originalSecretGet(providerSecretKeys.mimo)).toBeNull()
    expect(await originalSecretGet(providerSecretKeys.openAi)).toBeNull()
    expect(await originalPreferenceGet(providerPreferenceKeys.rememberMimo)).toBe(false)
    expect(await originalPreferenceGet(providerPreferenceKeys.rememberOpenAi)).toBe(false)

    releaseHydrationReads.resolve()
    await bindings.ready
    await bindings.waitForPendingWrites()

    expect(bindings.loadStatus.value).toBe('ready')
    expect(bindings.ttsSettings.value.mimo.apiKey).toBe('')
    expect(bindings.readExpansionSettings.value.ai.openai.apiKey).toBe('')
    expect(bindings.rememberMimoKey.value).toBe(false)
    expect(bindings.rememberOpenAiKey.value).toBe(false)
  })

  it('drops queued session and remembered persistence after same-tick app unmount', async () => {
    const { app, bindings, harness } = mountProviderSettings()

    bindings.ttsSettings.value = createMimoSettings('queued-session-key')
    bindings.readExpansionSettings.value = createAiSettings('queued-device-key', true)
    bindings.rememberOpenAiKey.value = true
    unmountTrackedApp(app)

    await bindings.ready
    await bindings.waitForPendingWrites()

    expect(await harness.preferences.get(providerPreferenceKeys.tts)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.readExpansion)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberOpenAi)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBeNull()
  })

  it('does not continue from an in-flight preference write into a secret write after unmount', async () => {
    const { app, bindings, harness } = mountProviderSettings()
    await bindings.ready
    await harness.preferences.clear()
    await harness.secrets.clear()

    const preferenceWriteSettled = createDeferred()
    const releasePreferenceWrite = createDeferred()
    const originalPreferenceSet = harness.preferences.set.bind(harness.preferences)
    harness.preferences.set = async <T>(key: string, value: T) => {
      await originalPreferenceSet(key, value)
      if (key === providerPreferenceKeys.tts) {
        preferenceWriteSettled.resolve()
        await releasePreferenceWrite.promise
      }
    }

    bindings.ttsSettings.value = createMimoSettings('in-flight-session-key')
    await preferenceWriteSettled.promise
    unmountTrackedApp(app)
    releasePreferenceWrite.resolve()
    await bindings.waitForPendingWrites()

    expect(await harness.preferences.get(providerPreferenceKeys.tts)).not.toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
  })

  it('runs a queued background session cleanup after same-tick app unmount', async () => {
    const { app, bindings, harness } = mountProviderSettings()
    await bindings.ready
    await harness.secrets.set(providerSecretKeys.mimo, 'existing-session-key', 'session')
    await harness.secrets.set(providerSecretKeys.openAi, 'preserved-device-key', 'device')

    harness.lifecycle.emit('background')
    unmountTrackedApp(app)
    await bindings.waitForPendingWrites()

    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBe('preserved-device-key')
  })

  it('clears a deferred session write that settles after app unmount', async () => {
    const { app, bindings, harness } = mountProviderSettings()
    await bindings.ready
    await harness.secrets.set(providerSecretKeys.openAi, 'preserved-device-key', 'device')

    const sessionWriteStarted = createDeferred()
    const releaseSessionWrite = createDeferred()
    const originalSecretSet = harness.secrets.set.bind(harness.secrets)
    harness.secrets.set = async (key, value, persistence) => {
      if (key === providerSecretKeys.mimo && persistence === 'session') {
        sessionWriteStarted.resolve()
        await releaseSessionWrite.promise
      }
      await originalSecretSet(key, value, persistence)
    }

    bindings.ttsSettings.value = createMimoSettings('late-session-key')
    await sessionWriteStarted.promise
    unmountTrackedApp(app)
    releaseSessionWrite.resolve()
    await bindings.waitForPendingWrites()

    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBe('preserved-device-key')
  })
})

function mountProviderSettings(
  harness = createFakePlatformServices(),
  consumerCount = 1,
) {
  const allBindings: ProviderSettingsBindings[] = []
  const app = createApp({
    setup() {
      for (let index = 0; index < consumerCount; index += 1) {
        allBindings.push(useProviderSettings())
      }
      return () => null
    },
  })
  app.provide(platformServicesKey, harness.services)
  app.mount(document.createElement('div'))
  mountedApps.push(app)

  const bindings = allBindings[0]
  if (!bindings) {
    throw new Error('Provider settings did not initialize.')
  }
  return { app, bindings, allBindings, harness }
}

function unmountTrackedApp(app: VueApp): void {
  const index = mountedApps.indexOf(app)
  if (index >= 0) {
    mountedApps.splice(index, 1)
  }
  app.unmount()
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createMimoSettings(apiKey: string): TtsSettings {
  return {
    ...defaultTtsSettings,
    provider: 'mimo',
    mimo: {
      ...defaultTtsSettings.mimo,
      apiKey,
    },
  }
}

function createAiSettings(apiKey: string, consentAccepted: boolean): ReadExpansionSettings {
  return {
    ai: {
      ...defaultReadExpansionSettings.ai,
      enabled: true,
      consentAccepted,
      openai: {
        ...defaultReadExpansionSettings.ai.openai,
        apiKey,
      },
    },
  }
}
