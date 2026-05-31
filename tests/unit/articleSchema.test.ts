import { describe, expect, it } from 'vitest'

import { isArticlePackageReady } from '@/features/article/articlePackageLoader'
import { publicDomainFallbackArticles, publicDomainSampleArticle } from '@/features/article/publicDomainSample'
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

  it('bundles public-domain examples with complete rights metadata for the empty-state fallback', () => {
    expect(publicDomainFallbackArticles.map(article => article.publicDomainMetadata?.difficulty.key)).toEqual([
      'beginner',
      'intermediate',
      'advanced',
    ])

    for (const article of publicDomainFallbackArticles) {
      expect(isArticlePackageReady(article)).toBe(true)
      expect(article.rights.sourceType).toBe('public-domain')
      expect(article.publicDomainMetadata).toMatchObject({
        sourceName: 'Project Gutenberg',
        language: 'en',
        rightsStatus: 'public-domain-us',
        allowedUses: {
          tts: true,
          cache: true,
          translation: true,
        },
        noRewrite: true,
      })
      expect(article.publicDomainMetadata?.id).toMatch(/^gutenberg-/)
      expect(article.publicDomainMetadata?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(article.publicDomainMetadata?.sourceUrl).toMatch(/^https:\/\/www\.gutenberg\.org\/ebooks\/\d+/)
      expect(article.publicDomainMetadata?.sourceLabel).toContain('美国公共领域')
      expect(article.publicDomainMetadata?.difficulty.label).toMatch(/^约 /)
      expect(article.publicDomainMetadata?.difficulty.basis).toContain('average words per sentence')
      expect(article.sentences.every(sentence => sentence.textHash && sentence.audio?.cacheKey)).toBe(true)
      expect(article.sentences.every(sentence => sentence.audioRef.url.startsWith('missing://tts-consent-required/'))).toBe(true)
    }
  })

  it('keeps Alice as the default public-domain example', () => {
    expect(isArticlePackageReady(publicDomainSampleArticle)).toBe(true)
    expect(publicDomainSampleArticle.rights.sourceType).toBe('public-domain')
    expect(publicDomainSampleArticle.publicDomainMetadata).toMatchObject({
      title: 'Alice’s Adventures in Wonderland',
      author: 'Lewis Carroll',
      publicationYear: '1865',
      sourceUrl: 'https://www.gutenberg.org/ebooks/11',
    })
    expect(publicDomainSampleArticle.publicDomainMetadata?.publicDomainBasis).toContain('public domain in the USA')
  })

  it('rejects public-domain packages without no-rewrite rights metadata', () => {
    const invalid = structuredClone(publicDomainSampleArticle)
    if (invalid.publicDomainMetadata) {
      invalid.publicDomainMetadata.noRewrite = false as true
    }

    expect(isArticlePackageReady(invalid)).toBe(false)
  })
})
