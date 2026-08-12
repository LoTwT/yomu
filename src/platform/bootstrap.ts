import {
  createApp,
  type App as VueApp,
  type Component,
} from 'vue'
import type { Router } from 'vue-router'

import RootApp from '@/App.vue'
import { platformInitializationKey } from '@/app/platformInitialization'
import { platformServicesKey } from '@/app/platformServices'
import { router as defaultRouter } from '@/app/router'
import { themeControllerKey } from '@/app/themePreference'

import type { PlatformServices } from './contracts'
import {
  createEmptyPlatformInitializationReport,
  type PlatformInitializationReport,
} from './initialization'
import {
  createThemeController,
  type ThemeController,
} from './themeController'

export interface CreateYomuAppOptions {
  platformServices: PlatformServices
  initialization?: PlatformInitializationReport
  rootComponent?: Component
  router?: Router | null
  themeController?: ThemeController
}

export interface BootstrapYomuAppOptions extends CreateYomuAppOptions {
  mountTarget?: string | Element
}

export async function createYomuApp(
  options: CreateYomuAppOptions,
): Promise<VueApp<Element>> {
  const ownsThemeController = options.themeController === undefined
  const themeController = options.themeController
    ?? await createThemeController(options.platformServices.preferences)
  const app = createApp(options.rootComponent ?? RootApp)
  const appRouter = options.router === undefined ? defaultRouter : options.router

  if (ownsThemeController) {
    app.onUnmount(() => themeController.dispose())
  }

  app.provide(platformServicesKey, options.platformServices)
  app.provide(
    platformInitializationKey,
    options.initialization ?? createEmptyPlatformInitializationReport(),
  )
  app.provide(themeControllerKey, themeController)
  if (appRouter) {
    try {
      app.use(appRouter)
      // Keep the shell non-interactive until the initial route owns its history entry.
      await appRouter.isReady()
    }
    catch (error) {
      if (ownsThemeController) {
        themeController.dispose()
      }
      throw error
    }
  }

  return app
}

export async function bootstrapYomuApp(
  options: BootstrapYomuAppOptions,
): Promise<VueApp<Element>> {
  const { mountTarget = '#app', ...createOptions } = options
  const app = await createYomuApp(createOptions)
  app.mount(mountTarget)
  return app
}
