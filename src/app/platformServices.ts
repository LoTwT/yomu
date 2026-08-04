import { inject, type InjectionKey } from 'vue'

import type { PlatformServices } from '@/platform/contracts'

export const platformServicesKey: InjectionKey<PlatformServices> = Symbol('yomu-platform-services')

export function usePlatformServices(): PlatformServices {
  const services = inject(platformServicesKey)
  if (!services) {
    throw new Error('PlatformServices were not provided at application startup.')
  }
  return services
}
