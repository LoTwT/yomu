import type { PlatformServices } from './contracts'
import {
  createEmptyPlatformInitializationReport,
  type PlatformInitializationReport,
} from './initialization'
import { createUnavailableShellPlatformServices } from './shell/createUnavailableShellPlatformServices'
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
    services: createUnavailableShellPlatformServices(
      target === 'desktop-shell' ? 'desktop' : 'mobile',
    ),
    initialization: createEmptyPlatformInitializationReport(),
  }
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
