import { describe, expect, it } from 'vitest'

import { sampleArticle } from '@/features/article/sampleArticle'

describe('article schema fixture', () => {
  it('uses sentence ids and structured IPA tokens instead of HTML strings', () => {
    expect(sampleArticle.sentences).toHaveLength(3)
    expect(sampleArticle.sentences.map(sentence => sentence.id)).toEqual(['s1', 's2', 's3'])

    for (const sentence of sampleArticle.sentences) {
      expect(sentence.original).not.toContain('<')
      expect(sentence.translation).toBeTruthy()
      expect(sentence.audioRef.durationMs).toBeGreaterThan(0)
      expect(sentence.tokens.every(token => token.id)).toBe(true)
      expect(sentence.tokens.some(token => token.ipa)).toBe(true)
    }
  })

  it('keeps auditable package metadata with rights and source fields', () => {
    expect(sampleArticle.contentVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(sampleArticle.rights.ttsAllowed).toBe(true)
    expect(sampleArticle.rights.translationAllowed).toBe(true)
    expect(sampleArticle.factSources[0]?.url).toMatch(/^https:\/\//)
    expect(sampleArticle.qaStatus).toBe('approved')
  })
})
