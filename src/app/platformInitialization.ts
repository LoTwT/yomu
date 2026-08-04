import { inject, type InjectionKey } from 'vue'

import {
  createEmptyPlatformInitializationReport,
  type PlatformInitializationReport,
} from '@/platform/initialization'

export const platformInitializationKey: InjectionKey<PlatformInitializationReport>
  = Symbol('yomu-platform-initialization')

export function usePlatformInitialization(): PlatformInitializationReport {
  return inject(platformInitializationKey, createEmptyPlatformInitializationReport())
}
