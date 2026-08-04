/** @vitest-environment jsdom */

import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { createYomuRouter } from '@/app/router'
import {
  providerPreferenceKeys,
  providerSecretKeys,
} from '@/features/settings/providerSettingsStorage'
import { createYomuApp } from '@/platform/bootstrap'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import {
  createEmptyPlatformInitializationReport,
  platformInitializationPreferenceKeys,
  type PlatformInitializationReport,
} from '@/platform/initialization'
import type { ThemeController } from '@/platform/themeController'
import SettingsView from '@/views/SettingsView.vue'

const mountedApps: Array<Awaited<ReturnType<typeof createYomuApp>>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('unified provider settings', () => {
  it('persists keys only through SecretStore and removes them when providers are disabled', async () => {
    const { host, harness } = await mountSettings()

    expect(host.textContent).toContain('MiMo 自备 Key')
    expect(host.textContent).toContain('AI 增强')

    dispatchChecked(findInput(host, '.tts-settings input[value="mimo"]'), true)
    await settle()
    dispatchValue(findInput(host, '.tts-settings input[type="password"]'), 'mimo-session-key')
    dispatchChecked(findInput(host, '.tts-settings__remember input'), true)
    await settle()

    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBe('mimo-session-key')
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBe(true)
    expect(JSON.stringify(await harness.preferences.get(providerPreferenceKeys.tts)))
      .not.toContain('mimo-session-key')

    dispatchChecked(findInput(host, '.tts-settings input[value="webspeech"]'), true)
    await settle()
    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberMimo)).toBe(false)

    dispatchChecked(findInput(host, '.extension-settings__toggle input'), true)
    await settle()
    dispatchValue(findInput(host, '.extension-settings input[type="password"]'), 'openai-session-key')
    dispatchChecked(findInput(host, '.extension-settings__remember input'), true)
    await settle()

    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBe('openai-session-key')
    expect(await harness.preferences.get(providerPreferenceKeys.rememberOpenAi)).toBe(true)
    expect(JSON.stringify(await harness.preferences.get(providerPreferenceKeys.readExpansion)))
      .not.toContain('openai-session-key')

    dispatchChecked(findInput(host, '.extension-settings__toggle input'), false)
    await settle()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBeNull()
    expect(await harness.preferences.get(providerPreferenceKeys.rememberOpenAi)).toBe(false)
  })

  it('shows only safe migration summaries and clears both session and device keys', async () => {
    const initialization: PlatformInitializationReport = {
      legacyProviderKeysCleared: true,
      legacyProviderSecretsCleared: 2,
      legacyProviderKeyReentryRequired: true,
      providerPreferencesMigrated: 2,
      migrationDiagnosticCount: 3,
      initializationIssueCount: 1,
    }
    const { host, harness } = await mountSettings(initialization)
    await harness.preferences.set(
      platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
      true,
    )
    await harness.secrets.set(providerSecretKeys.mimo, 'never-render-this', 'device')
    await harness.secrets.set(providerSecretKeys.openAi, 'never-render-this-either', 'session')

    expect(host.textContent).toContain('已清除旧版设置或旧存储格式中的 Provider Key')
    expect(host.textContent).toContain('有 3 项无法安全还原')
    expect(host.textContent).not.toContain('never-render-this')

    const migrationConfirmButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('确认并关闭提示'))
    expect(migrationConfirmButton).toBeTruthy()
    migrationConfirmButton?.click()
    await settle()
    expect(await harness.preferences.get(
      platformInitializationPreferenceKeys.legacyProviderKeyReentryRequired,
    )).toBeNull()
    expect(host.textContent).not.toContain('已清除旧版设置或旧存储格式中的 Provider Key')

    const clearButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('清除所有 Provider Key'))
    expect(clearButton).toBeTruthy()
    clearButton?.click()
    await settle()

    expect(await harness.secrets.get(providerSecretKeys.mimo)).toBeNull()
    expect(await harness.secrets.get(providerSecretKeys.openAi)).toBeNull()
    expect(host.textContent).toContain('重置相关云服务同意状态')
  })
})

async function mountSettings(
  initialization: PlatformInitializationReport = createEmptyPlatformInitializationReport(),
) {
  const harness = createFakePlatformServices()
  const router = createYomuRouter(createMemoryHistory())
  await router.push('/settings')
  await router.isReady()
  const app = await createYomuApp({
    platformServices: harness.services,
    initialization,
    rootComponent: SettingsView,
    router,
    themeController: createFakeThemeController(),
  })
  mountedApps.push(app)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await settle()
  return { app, host, harness }
}

function findInput(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(selector)
  if (!input) {
    throw new Error(`Expected input ${selector} to be rendered.`)
  }
  return input
}

function dispatchValue(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function dispatchChecked(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function createFakeThemeController(): ThemeController {
  return {
    getSnapshot: () => ({ preference: 'system', resolvedTheme: 'light' }),
    setPreference: async () => {},
    subscribe: () => () => {},
    dispose: () => {},
  }
}
