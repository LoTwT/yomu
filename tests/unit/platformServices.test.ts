import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import { providerSecretKeys } from '@/features/settings/providerSettingsStorage'
import { hasCapability } from '@/platform/capabilities'
import { getYomuBuildTarget } from '@/platform/createPlatformServices'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import { platformInitializationPreferenceKeys } from '@/platform/initialization'
import {
  WebLifecycleAdapter,
  WebRemoteServicesAdapter,
} from '@/platform/web/runtimeAdapters'
import { WebPreferencesStore, WebSecretStore } from '@/platform/web/storageAdapters'
import { createWebPlatformServices } from '@/platform/web/createWebPlatformServices'

describe('platform services', () => {
  it('provides a complete controllable fake adapter suite', async () => {
    const harness = createFakePlatformServices({ online: true })
    const lifecycleEvents: string[] = []
    const networkEvents: boolean[] = []
    const backEvents: string[] = []
    const shared: string[] = []

    harness.services.lifecycle.subscribe(event => lifecycleEvents.push(event.state))
    harness.services.network.subscribe(online => networkEvents.push(online))
    harness.services.backNavigation.subscribe(event => backEvents.push(event.source))
    harness.services.shareInbox.subscribe(payload => shared.push(payload.text ?? ''))

    harness.lifecycle.emit('background')
    harness.network.setOnline(false)
    harness.backNavigation.emit()
    harness.shareInbox.emit({ text: 'Shared article' })

    expect(lifecycleEvents).toEqual(['background'])
    expect(networkEvents).toEqual([false])
    expect(backEvents).toEqual(['test'])
    expect(shared).toEqual(['Shared article'])
    expect(harness.preferences.persistence).toBe('session')
    expect(await harness.services.shareInbox.takePending()).toEqual({ text: 'Shared article' })
    expect(await harness.services.shareInbox.takePending()).toBeNull()

    await harness.services.secrets.set('mimo', 'session-key')
    expect(await harness.services.secrets.get('mimo')).toBe('session-key')
  })

  it('restores the Web lifecycle after a page returns from the back-forward cache', () => {
    const documentTarget = new EventTarget()
    const windowTarget = new EventTarget()
    let visibilityState: DocumentVisibilityState = 'visible'
    Object.defineProperty(documentTarget, 'visibilityState', {
      get: () => visibilityState,
    })
    const lifecycle = new WebLifecycleAdapter(
      documentTarget as Document,
      windowTarget as Window,
    )
    const events: Array<{ state: string, reason: string }> = []
    const unsubscribe = lifecycle.subscribe(event => events.push(event))

    visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    windowTarget.dispatchEvent(new Event('pagehide'))
    visibilityState = 'visible'
    windowTarget.dispatchEvent(new Event('pageshow'))

    expect(events).toEqual([
      { state: 'background', reason: 'visibility' },
      { state: 'suspended', reason: 'pagehide' },
      { state: 'active', reason: 'pageshow' },
    ])

    unsubscribe()
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    windowTarget.dispatchEvent(new Event('pagehide'))
    windowTarget.dispatchEvent(new Event('pageshow'))
    expect(events).toHaveLength(3)
  })

  it('keeps browser preferences and remembered secrets in separate namespaces', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('unrelated', 'keep')
    window.localStorage.setItem('yomu:tts-settings', JSON.stringify({
      provider: 'mimo',
      mimo: { apiKey: 'legacy-mimo', voice: 'Mia' },
    }))
    window.localStorage.setItem('yomu:read-expansion-settings', JSON.stringify({
      ai: { openai: { apiKey: 'legacy-openai', model: 'gpt-test' } },
    }))
    const preferences = new WebPreferencesStore(window.localStorage)
    const secrets = new WebSecretStore(window.localStorage)

    expect(preferences.persistence).toBe('device')

    window.localStorage.setItem('yomu:v2:preference:damaged', '{truncated')
    expect(await preferences.get('damaged')).toBeNull()
    expect(await preferences.update('damaged', () => ({ revision: 1 })))
      .toEqual({ revision: 1 })
    expect(preferences.updateImmediately('damaged', current => ({
      revision: (current as { revision: number }).revision + 1,
    }))).toEqual({ revision: 2 })
    await preferences.set('theme', 'dark')
    await preferences.set('conditional', { revision: 2 })
    await preferences.set('reader-slot:b', { sequence: 2 })
    await preferences.set('reader-slot:a', { sequence: 1 })
    window.localStorage.setItem('yomu:v2:preference:reader-slot:damaged', '{truncated')
    expect(await preferences.update('conditional', current => ({
      revision: (current as { revision: number }).revision + 1,
    }))).toEqual({ revision: 3 })
    await secrets.set('mimo', 'temporary')
    await secrets.set('openai', 'remembered', 'device')

    expect(await preferences.get('theme')).toBe('dark')
    expect(await preferences.listByPrefix('reader-slot:')).toEqual([
      { key: 'reader-slot:a', value: { sequence: 1 } },
      { key: 'reader-slot:b', value: { sequence: 2 } },
    ])
    expect(await preferences.compareAndRemove('conditional', { revision: 2 })).toBe(false)
    expect(await preferences.get('conditional')).toEqual({ revision: 3 })
    expect(await preferences.compareAndRemove('conditional', { revision: 3 })).toBe(true)
    expect(await preferences.get('conditional')).toBeNull()
    expect(await secrets.get('mimo')).toBe('temporary')
    expect(await secrets.get('openai')).toBe('remembered')

    await secrets.clearSession()
    expect(await secrets.get('mimo')).toBeNull()
    expect(await secrets.get('openai')).toBe('remembered')

    await preferences.clear()
    await secrets.clear()
    expect(window.localStorage.getItem('unrelated')).toBe('keep')
    expect(await secrets.get('openai')).toBeNull()
    expect(window.localStorage.getItem('yomu:tts-settings')).not.toContain('legacy-mimo')
    expect(window.localStorage.getItem('yomu:read-expansion-settings')).not.toContain('legacy-openai')
  })

  it('clears legacy wrapped secrets without loading them and preserves current raw device secrets', async () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'yomu:v2:secret:tts:mimo',
      JSON.stringify({ schemaVersion: 2, secret: 'remembered-mimo' }),
    )
    window.localStorage.setItem(
      'yomu:v2:secret:ai:openai',
      JSON.stringify({ schemaVersion: 2, secret: 'remembered-openai' }),
    )
    const secrets = new WebSecretStore(window.localStorage)

    expect(secrets.clearLegacySerializedValues([
      providerSecretKeys.mimo,
      providerSecretKeys.openAi,
    ])).toBe(2)
    expect(await secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await secrets.get(providerSecretKeys.openAi)).toBeNull()
    expect(window.localStorage.getItem('yomu:v2:secret:tts:mimo')).toBeNull()
    expect(window.localStorage.getItem('yomu:v2:secret:ai:openai')).toBeNull()

    await secrets.set(providerSecretKeys.mimo, 'current-remembered-mimo', 'device')
    expect(await secrets.get(providerSecretKeys.mimo)).toBe('current-remembered-mimo')
    expect(window.localStorage.getItem('yomu:v2:secret:tts:mimo')).toBe('current-remembered-mimo')
  })

  it('returns a safe initialization summary without exposing legacy key contents', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('yomu:tts-settings', JSON.stringify({
      provider: 'mimo',
      mimo: { apiKey: 'must-not-leak', model: 'legacy-model' },
    }))
    window.localStorage.setItem(
      'yomu:v2:secret:ai:openai',
      JSON.stringify({ schemaVersion: 2, secret: 'wrapped-must-not-leak' }),
    )
    window.localStorage.setItem('yomu:saved-vocabulary', JSON.stringify(['legacy-token']))

    const result = await createWebPlatformServices({
      repositories: createMemoryLocalRepositories(),
      indexedDbFactory: null,
      localStorage: window.localStorage,
      fetchImpl: vi.fn(async () => new Response('{}')),
    })

    expect(result.initialization).toMatchObject({
      legacyProviderKeysCleared: true,
      legacyProviderSecretsCleared: 1,
      legacyProviderKeyReentryRequired: true,
      providerPreferencesMigrated: 1,
      migrationDiagnosticCount: 1,
    })
    expect(JSON.stringify(result.initialization)).not.toContain('must-not-leak')
    expect(await result.services.secrets.get(providerSecretKeys.openAi)).toBeNull()
    expect(await result.services.preferences.get(
      platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
    )).toBe(true)

    const nextStartup = await createWebPlatformServices({
      repositories: createMemoryLocalRepositories(),
      indexedDbFactory: null,
      localStorage: window.localStorage,
      fetchImpl: vi.fn(async () => new Response('{}')),
    })
    expect(nextStartup.initialization).toMatchObject({
      legacyProviderKeysCleared: false,
      legacyProviderSecretsCleared: 0,
      legacyProviderKeyReentryRequired: true,
    })
  })

  it('maps every logical remote operation below a trusted path prefix', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'article' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const remote = new WebRemoteServicesAdapter('https://yomu.example/app/', fetchImpl)

    const operations = [
      { operation: 'url-import' as const, path: '/api/import/url' },
      { operation: 'mimo-tts' as const, path: '/api/tts/mimo' },
      { operation: 'ai-word-expansion' as const, path: '/api/extensions/ai' },
    ]
    for (const { operation } of operations) {
      await expect(remote.request<{ text: string }>({
        operation,
        body: { request: operation },
      })).resolves.toEqual({ text: 'article' })
    }

    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(
      operations.map(({ path }) => `https://yomu.example/app${path}`),
    )
    expect(fetchImpl.mock.calls.every(call =>
      call[1]?.method === 'POST' && call[1]?.cache === 'no-store')).toBe(true)
  })

  it('rejects remote service base URLs containing query parameters or fragments', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))

    for (const baseUrl of [
      'https://yomu.example/app?token=secret',
      'https://yomu.example/app#runtime',
      'https://yomu.example/app?#',
    ]) {
      expect(() => new WebRemoteServicesAdapter(baseUrl, fetchImpl))
        .toThrow('Remote service base URL must not include query parameters or fragments.')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('builds a Web service set with explicit ephemeral-storage degradation', async () => {
    const result = await createWebPlatformServices({
      repositories: createMemoryLocalRepositories(),
      indexedDbFactory: null,
      localStorage: window.localStorage,
      migrateLegacy: false,
      fetchImpl: vi.fn(async () => new Response('{}')),
    })

    expect(result.services.kind).toBe('web')
    expect(hasCapability(result.services.capabilities, 'localPersistence')).toBe(false)
    expect(result.services.repositories.persistence).toBe('ephemeral')
    expect(getYomuBuildTarget()).toBe('web-pwa')
  })

  it('reports session-only preferences when browser storage is unavailable', async () => {
    const result = await createWebPlatformServices({
      repositories: createMemoryLocalRepositories(),
      indexedDbFactory: null,
      localStorage: null,
      migrateLegacy: false,
      fetchImpl: vi.fn(async () => new Response('{}')),
    })

    expect(result.services.preferences.persistence).toBe('session')
  })
})
