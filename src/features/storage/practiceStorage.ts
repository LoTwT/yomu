import type { DisplayPreferences } from '@/features/preferences/types'
import { defaultDisplayPreferences } from '@/features/preferences/types'

export interface PracticeSessionRecord {
  articleId: string
  completedAt: string
  durationSec: number
}

const preferencesKey = 'yomu:display-preferences'
const sessionKeyPrefix = 'yomu:practice-session:'

export function loadDisplayPreferences(storage: Storage): DisplayPreferences {
  const raw = storage.getItem(preferencesKey)
  if (!raw) {
    return { ...defaultDisplayPreferences }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DisplayPreferences>
    return {
      showTranslation: parsed.showTranslation === true,
      showPronunciation: parsed.showPronunciation === true,
    }
  }
  catch {
    return { ...defaultDisplayPreferences }
  }
}

export function saveDisplayPreferences(storage: Storage, preferences: DisplayPreferences): void {
  storage.setItem(preferencesKey, JSON.stringify(preferences))
}

export function savePracticeSession(storage: Storage, session: PracticeSessionRecord): void {
  storage.setItem(`${sessionKeyPrefix}${session.articleId}`, JSON.stringify(session))
}

export function loadPracticeSession(
  storage: Storage,
  articleId: string,
): PracticeSessionRecord | null {
  const raw = storage.getItem(`${sessionKeyPrefix}${articleId}`)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as PracticeSessionRecord
    if (!parsed.articleId || !parsed.completedAt || typeof parsed.durationSec !== 'number') {
      return null
    }

    return parsed
  }
  catch {
    return null
  }
}
