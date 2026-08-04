import { defineComponent, h, inject } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import { themeControllerKey } from '@/app/themePreference'
import {
  bootstrapYomuApp,
  createYomuApp,
} from '@/platform/bootstrap'
import type { PlatformServices } from '@/platform/contracts'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import type { ThemeController } from '@/platform/themeController'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('platform app bootstrap', () => {
  it('creates an unmounted app with host-supplied platform and theme services', async () => {
    const harness = createFakePlatformServices({ kind: 'desktop' })
    const themeController = createFakeThemeController()
    let injectedPlatform: PlatformServices | null = null
    let injectedTheme: ThemeController | null = null
    const Root = defineComponent({
      setup() {
        injectedPlatform = inject(platformServicesKey) ?? null
        injectedTheme = inject(themeControllerKey) ?? null
        return () => h('p', 'Host-ready Yomu')
      },
    })

    const app = await createYomuApp({
      platformServices: harness.services,
      themeController,
      rootComponent: Root,
      router: null,
    })
    const target = document.createElement('div')
    document.body.append(target)
    app.mount(target)

    expect(injectedPlatform).toBe(harness.services)
    expect(injectedTheme).toBe(themeController)
    expect(target.textContent).toBe('Host-ready Yomu')

    app.unmount()
    target.remove()
  })

  it('mounts through bootstrapYomuApp at a host-selected target', async () => {
    const harness = createFakePlatformServices({ kind: 'mobile' })
    const target = document.createElement('div')
    document.body.append(target)
    const Root = defineComponent(() => () => h('p', harness.services.kind))

    const app = await bootstrapYomuApp({
      platformServices: harness.services,
      themeController: createFakeThemeController(),
      rootComponent: Root,
      router: null,
      mountTarget: target,
    })

    expect(target.textContent).toBe('mobile')
    app.unmount()
    target.remove()
  })

  it('disposes the internally created theme controller when the app unmounts', async () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)))
    const harness = createFakePlatformServices()
    const target = document.createElement('div')
    document.body.append(target)

    const app = await createYomuApp({
      platformServices: harness.services,
      rootComponent: defineComponent(() => () => h('p', 'Yomu')),
      router: null,
    })
    app.mount(target)

    expect(addEventListener).toHaveBeenCalledTimes(1)
    const changeListener = addEventListener.mock.calls[0]?.[1]
    app.unmount()

    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith('change', changeListener)
  })

  it('does not dispose a host-supplied theme controller when the app unmounts', async () => {
    const harness = createFakePlatformServices()
    const dispose = vi.fn()
    const themeController = createFakeThemeController(dispose)
    const target = document.createElement('div')
    document.body.append(target)
    const app = await createYomuApp({
      platformServices: harness.services,
      themeController,
      rootComponent: defineComponent(() => () => h('p', 'Yomu')),
      router: null,
    })
    app.mount(target)

    app.unmount()

    expect(dispose).not.toHaveBeenCalled()
  })
})

function createFakeThemeController(dispose = () => {}): ThemeController {
  return {
    getSnapshot: () => ({ preference: 'system', resolvedTheme: 'light' }),
    setPreference: async () => {},
    subscribe: () => () => {},
    dispose,
  }
}
