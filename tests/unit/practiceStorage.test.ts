import { describe, expect, it } from 'vitest'

import {
  loadDisplayPreferences,
  loadPracticeSession,
  saveDisplayPreferences,
  savePracticeSession,
} from '@/features/storage/practiceStorage'

describe('practice storage', () => {
  it('loads default display preferences when storage is empty or invalid', () => {
    const storage = window.localStorage
    storage.clear()

    expect(loadDisplayPreferences(storage)).toEqual({
      showPronunciation: false,
      showTranslation: false,
    })

    storage.setItem('yomu:display-preferences', '{not-json')
    expect(loadDisplayPreferences(storage)).toEqual({
      showPronunciation: false,
      showTranslation: false,
    })
  })

  it('persists display preferences and practice completion records', () => {
    const storage = window.localStorage
    storage.clear()

    saveDisplayPreferences(storage, {
      showPronunciation: true,
      showTranslation: true,
    })

    expect(loadDisplayPreferences(storage)).toEqual({
      showPronunciation: true,
      showTranslation: true,
    })

    savePracticeSession(storage, {
      articleId: 'daily-en',
      completedAt: '2026-05-24T04:00:00.000Z',
      durationSec: 300,
    })

    expect(loadPracticeSession(storage, 'daily-en')).toEqual({
      articleId: 'daily-en',
      completedAt: '2026-05-24T04:00:00.000Z',
      durationSec: 300,
    })
  })
})
