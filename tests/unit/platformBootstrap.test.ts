import { defineComponent, h, inject, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
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

  it('waits for the initial route before mounting the interactive shell', async () => {
    const harness = createFakePlatformServices({ kind: 'web' })
    const target = document.createElement('div')
    document.body.append(target)
    let resolveRoute!: (component: Component) => void
    const routeComponent = new Promise<Component>((resolve) => {
      resolveRoute = resolve
    })
    let markRouteLoadStarted!: () => void
    const routeLoadStarted = new Promise<void>((resolve) => {
      markRouteLoadStarted = resolve
    })
    const history = createMemoryHistory()
    history.replace('/delayed')
    const router = createRouter({
      history,
      routes: [
        {
          path: '/delayed',
          component: () => {
            markRouteLoadStarted()
            return routeComponent
          },
        },
      ],
    })
    const Root = defineComponent(() => () => h('button', { type: 'button' }, 'Interactive shell'))
    let bootstrapSettled = false
    let app: Awaited<ReturnType<typeof bootstrapYomuApp>> | null = null
    const bootstrapPromise = bootstrapYomuApp({
      platformServices: harness.services,
      themeController: createFakeThemeController(),
      rootComponent: Root,
      router,
      mountTarget: target,
    }).then((createdApp) => {
      bootstrapSettled = true
      return createdApp
    })

    try {
      await routeLoadStarted
      await Promise.resolve()

      expect(bootstrapSettled).toBe(false)
      expect(target.querySelector('button')).toBeNull()
      expect(target.hasAttribute('data-v-app')).toBe(false)

      resolveRoute(defineComponent(() => () => h('p', 'Delayed route')))
      app = await bootstrapPromise

      expect(router.currentRoute.value.fullPath).toBe('/delayed')
      expect(target.querySelector('button')?.textContent).toBe('Interactive shell')
    }
    finally {
      resolveRoute(defineComponent(() => () => h('p', 'Delayed route')))
      app ??= await bootstrapPromise
      app.unmount()
      target.remove()
    }
  })

  it('does not mount and disposes owned theme resources when the initial route fails', async () => {
    const harness = createFakePlatformServices({ kind: 'web' })
    const target = document.createElement('div')
    document.body.append(target)
    const routeFailure = new Error('initial route failed')
    const history = createMemoryHistory()
    history.replace('/broken')
    const router = createRouter({
      history,
      routes: [
        {
          path: '/broken',
          component: () => Promise.reject(routeFailure),
        },
      ],
    })
    const { addEventListener, removeEventListener } = stubMatchMedia()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await expect(bootstrapYomuApp({
        platformServices: harness.services,
        rootComponent: defineComponent(() => () => h('button', { type: 'button' }, 'Interactive shell')),
        router,
        mountTarget: target,
      })).rejects.toBe(routeFailure)
    }
    finally {
      consoleError.mockRestore()
      consoleWarn.mockRestore()
    }

    expect(target.querySelector('button')).toBeNull()
    expect(target.hasAttribute('data-v-app')).toBe(false)
    expect(addEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith(
      'change',
      addEventListener.mock.calls[0]?.[1],
    )
  })

  it('disposes the internally created theme controller when the app unmounts', async () => {
    const { addEventListener, removeEventListener } = stubMatchMedia()
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

function stubMatchMedia() {
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
  return { addEventListener, removeEventListener }
}
