import { createFakePlatformServices } from './fake/createFakePlatformServices'
import {
  createCapabilitySnapshot,
  unavailableCapability,
} from './capabilities'
import type { PlatformServices } from './contracts'
import {
  createEmptyPlatformInitializationReport,
  type PlatformInitializationReport,
} from './initialization'
import type { CreateWebPlatformServicesOptions } from './web/createWebPlatformServices'

export type YomuBuildTarget = 'web-pwa' | 'desktop-shell' | 'mobile-shell'

export interface CreatePlatformServicesOptions {
  web?: CreateWebPlatformServicesOptions
  desktopShell?: PlatformServices
  mobileShell?: PlatformServices
}

export interface PlatformBootstrapResult {
  services: PlatformServices
  initialization: PlatformInitializationReport
}

export function getYomuBuildTarget(): YomuBuildTarget {
  return typeof __YOMU_TARGET__ === 'undefined' ? 'web-pwa' : __YOMU_TARGET__
}

export async function createPlatformServicesForCurrentTarget(
  options: CreatePlatformServicesOptions = {},
): Promise<PlatformServices> {
  return (await createPlatformBootstrapForCurrentTarget(options)).services
}

export async function createPlatformBootstrapForCurrentTarget(
  options: CreatePlatformServicesOptions = {},
): Promise<PlatformBootstrapResult> {
  if (typeof __YOMU_TARGET__ === 'undefined' || __YOMU_TARGET__ === 'web-pwa') {
    const { createWebPlatformServices } = await import('./web/createWebPlatformServices')
    const result = await createWebPlatformServices(options.web)
    return {
      services: result.services,
      initialization: result.initialization,
    }
  }

  const target = __YOMU_TARGET__
  const supplied = target === 'desktop-shell' ? options.desktopShell : options.mobileShell
  if (supplied) {
    assertShellKind(target, supplied)
    return {
      services: supplied,
      initialization: createEmptyPlatformInitializationReport(),
    }
  }

  return {
    services: createShellBuildFallback(target),
    initialization: createEmptyPlatformInitializationReport(),
  }
}

function createShellBuildFallback(target: Exclude<YomuBuildTarget, 'web-pwa'>): PlatformServices {
  const capabilities = createCapabilitySnapshot({
    localPersistence: unavailableCapability('The shell persistence adapter has not been injected.'),
    persistentSecrets: unavailableCapability('The shell SecretStore has not been injected.'),
    localSpeech: unavailableCapability('The shell speech adapter has not been injected.'),
    fileImport: unavailableCapability('The shell file adapter has not been injected.'),
    urlImport: unavailableCapability('The shell URL extraction adapter has not been injected.'),
    shareImport: unavailableCapability('The shell share adapter has not been injected.'),
    systemBack: unavailableCapability('The shell back adapter has not been injected.'),
    serviceWorker: unavailableCapability('Service Worker is intentionally disabled for shell targets.'),
  })
  return createFakePlatformServices({
    kind: target === 'desktop-shell' ? 'desktop' : 'mobile',
    speechAvailable: false,
    fileImportAvailable: false,
    capabilities,
  }).services
}

function assertShellKind(
  target: Exclude<YomuBuildTarget, 'web-pwa'>,
  services: PlatformServices,
): void {
  const expected = target === 'desktop-shell' ? 'desktop' : 'mobile'
  if (services.kind !== expected) {
    throw new Error(`Build target ${target} requires PlatformServices.kind to be ${expected}.`)
  }
}
