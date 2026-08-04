import { describe, expect, it } from 'vitest'

import { calculateReadingProgress } from '@/features/reader/readingProgress'

describe('reading progress', () => {
  it('counts the furthest visited sentence for an active attempt', () => {
    expect(calculateReadingProgress({
      status: 'active',
      furthestSentenceOrdinal: 0,
      sentenceCount: 4,
    })).toBe(25)
    expect(calculateReadingProgress({
      status: 'active',
      furthestSentenceOrdinal: 2,
      sentenceCount: 4,
    })).toBe(75)
  })

  it('caps an active attempt at 99 even on or beyond the final sentence', () => {
    expect(calculateReadingProgress({
      status: 'active',
      furthestSentenceOrdinal: 3,
      sentenceCount: 4,
    })).toBe(99)
    expect(calculateReadingProgress({
      status: 'active',
      furthestSentenceOrdinal: 20,
      sentenceCount: 4,
    })).toBe(99)
  })

  it('returns 100 only for completed attempts and handles an empty article', () => {
    expect(calculateReadingProgress({
      status: 'completed',
      furthestSentenceOrdinal: 0,
      sentenceCount: 0,
    })).toBe(100)
    expect(calculateReadingProgress({
      status: 'active',
      furthestSentenceOrdinal: 0,
      sentenceCount: 0,
    })).toBe(0)
  })
})
