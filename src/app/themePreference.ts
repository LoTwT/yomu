import { inject, onScopeDispose, readonly, shallowRef, type InjectionKey } from 'vue'

import type { ThemeController, ThemePreference } from '@/platform/themeController'

export const themeControllerKey: InjectionKey<ThemeController> = Symbol('yomu-theme-controller')

export function useThemePreference() {
  const controller = inject(themeControllerKey)
  if (!controller) {
    throw new Error('ThemeController was not provided at application startup.')
  }

  const state = shallowRef(controller.getSnapshot())
  const unsubscribe = controller.subscribe((snapshot) => {
    state.value = snapshot
  })
  onScopeDispose(unsubscribe)

  return {
    state: readonly(state),
    setPreference: (preference: ThemePreference) => controller.setPreference(preference),
  }
}
