import { describe, expect, it } from 'vitest'

import { publicDomainSampleArticle } from '@/features/article/publicDomainSample'
import { sampleArticle } from '@/features/article/sampleArticle'
import { extractReadExpansionTerms, findReadExpansionTermForToken } from '@/features/extension/localExtraction'
import {
  clearAiApiKey,
  getAiProviderLabel,
  isAiExpansionConfigured,
  loadReadExpansionSettings,
  saveReadExpansionSettings,
} from '@/features/extension/settings'

describe('read expansion local floor', () => {
  it('extracts local terms without requiring provider configuration', () => {
    const terms = extractReadExpansionTerms(sampleArticle)

    expect(terms.length).toBeGreaterThan(0)
    expect(terms[0]).toMatchObject({
      source: expect.stringMatching(/article-glossary|local-dictionary|frequency-rule/),
    })
    expect(terms.some(term => term.term === 'difficult' && term.localGloss === '困难的')).toBe(true)
    expect(terms.every(term => term.localGloss.length > 0)).toBe(true)
  })

  it('matches tapped tokens to extracted terms by normalized text', () => {
    const terms = extractReadExpansionTerms(sampleArticle)
    const token = sampleArticle.sentences[0]?.tokens.find(item => item.text === 'change')

    expect(token).toBeTruthy()
    expect(findReadExpansionTermForToken(terms, token!)).toMatchObject({
      term: 'change',
      localGloss: '改变',
    })
  })

  it('uses frequency and local dictionary fallbacks for public-domain examples', () => {
    const terms = extractReadExpansionTerms(publicDomainSampleArticle)

    expect(terms.length).toBeGreaterThan(0)
    expect(terms.some(term => term.term === 'telescope' && term.rank === 'above-level')).toBe(true)
    expect(terms.every(term => !term.context.includes(publicDomainSampleArticle.sentences.map(sentence => sentence.original).join(' ')))).toBe(true)
  })
})

describe('read expansion settings', () => {
  it('defaults AI enhancement off with no key', () => {
    window.localStorage.clear()

    const settings = loadReadExpansionSettings(window.localStorage)

    expect(settings.ai.enabled).toBe(false)
    expect(settings.ai.consentAccepted).toBe(false)
    expect(settings.ai.openai.apiKey).toBe('')
    expect(isAiExpansionConfigured(settings)).toBe(false)
    expect(getAiProviderLabel(settings)).toBe('OpenAI')
  })

  it('stores BYOK AI settings locally and clears the key with consent reset', () => {
    window.localStorage.clear()

    saveReadExpansionSettings(window.localStorage, {
      ai: {
        enabled: true,
        consentAccepted: true,
        provider: 'openai',
        openai: {
          apiKey: 'user-ai-key',
          baseUrl: 'https://api.openai.com/v1/',
          model: 'gpt-4.1-mini',
        },
      },
    })

    const settings = loadReadExpansionSettings(window.localStorage)
    expect(settings.ai.enabled).toBe(true)
    expect(settings.ai.consentAccepted).toBe(true)
    expect(settings.ai.openai.apiKey).toBe('user-ai-key')
    expect(settings.ai.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(isAiExpansionConfigured(settings)).toBe(true)
    expect(clearAiApiKey(settings).ai.openai.apiKey).toBe('')
    expect(clearAiApiKey(settings).ai.consentAccepted).toBe(false)
  })
})
