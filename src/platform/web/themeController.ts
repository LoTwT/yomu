import type { PreferencesStore } from '../contracts'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeSnapshot {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
}

export interface ThemeController {
  getSnapshot: () => ThemeSnapshot
  setPreference: (preference: ThemePreference) => Promise<void>
  subscribe: (listener: (snapshot: ThemeSnapshot) => void) => () => void
  dispose: () => void
}

const themePreferenceKey = 'theme'

export async function createThemeController(
  preferences: PreferencesStore,
): Promise<ThemeController> {
  const root = document.documentElement
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  const storedPreference = await preferences.get<unknown>(themePreferenceKey)
  let preference = normalizeThemePreference(storedPreference)
    ?? normalizeThemePreference(root.dataset.themePreference)
    ?? 'system'
  let snapshot = resolveSnapshot(preference, colorScheme.matches)
  const listeners = new Set<(value: ThemeSnapshot) => void>()

  applyThemeSnapshot(root, snapshot)

  const onSystemThemeChange = (event: MediaQueryListEvent): void => {
    if (preference !== 'system') {
      return
    }
    snapshot = resolveSnapshot(preference, event.matches)
    applyThemeSnapshot(root, snapshot)
    listeners.forEach(listener => listener(snapshot))
  }
  colorScheme.addEventListener('change', onSystemThemeChange)

  return {
    getSnapshot: () => ({ ...snapshot }),
    async setPreference(nextPreference) {
      preference = nextPreference
      snapshot = resolveSnapshot(preference, colorScheme.matches)
      applyThemeSnapshot(root, snapshot)
      listeners.forEach(listener => listener(snapshot))
      await preferences.set(themePreferenceKey, preference)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      colorScheme.removeEventListener('change', onSystemThemeChange)
      listeners.clear()
    },
  }
}

function normalizeThemePreference(value: unknown): ThemePreference | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null
}

function resolveSnapshot(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeSnapshot {
  return {
    preference,
    resolvedTheme: preference === 'system'
      ? (systemPrefersDark ? 'dark' : 'light')
      : preference,
  }
}

function applyThemeSnapshot(root: HTMLElement, snapshot: ThemeSnapshot): void {
  root.classList.toggle('dark', snapshot.resolvedTheme === 'dark')
  root.dataset.theme = snapshot.resolvedTheme
  root.dataset.themePreference = snapshot.preference

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', snapshot.resolvedTheme === 'dark' ? '#121019' : '#faf8f4')
}
