import { describe, expect, it, vi } from 'vitest'

import { publicDomainSampleArticle } from '@/features/article/publicDomainSample'
import { sampleArticle } from '@/features/article/sampleArticle'
import { requestAiWordExpansion } from '@/features/extension/aiAdapter'
import { extractReadExpansionTerms, findReadExpansionTermForToken } from '@/features/extension/localExtraction'
import {
  clearAiApiKey,
  getAiProviderLabel,
  isAiExpansionConfigured,
  loadReadExpansionSettings,
  sanitizeReadExpansionSettingsForExport,
  saveReadExpansionSettings,
} from '@/features/extension/settings'
import type { RemoteServiceRequest, RemoteServicesAdapter } from '@/platform/contracts'

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

  it('delegates AI expansion to the remote service boundary with minimal term context', async () => {
    const term = extractReadExpansionTerms(sampleArticle)[0]!
    const remote = createRemoteRecorder(() => ({
      meaning: 'A concise local explanation.',
      examples: ['A short example.'],
      background: 'A brief usage note.',
      provider: 'OpenAI',
      model: 'gpt-test',
    }))

    const expansion = await requestAiWordExpansion({
      provider: 'openai',
      apiKey: 'session-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-test',
      term,
    }, remote.adapter)

    expect(expansion).toMatchObject({
      meaning: 'A concise local explanation.',
      examples: ['A short example.'],
      model: 'gpt-test',
    })
    expect(remote.request).toHaveBeenCalledWith({
      operation: 'ai-word-expansion',
      body: {
        provider: 'openai',
        apiKey: 'session-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        term: term.term,
        localGloss: term.localGloss,
        context: term.context,
      },
    })
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

  it('persists public AI configuration while keeping key and consent session-only', () => {
    window.localStorage.clear()

    const sessionSettings = {
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
    } as const
    saveReadExpansionSettings(window.localStorage, sessionSettings)

    const settings = loadReadExpansionSettings(window.localStorage)
    expect(settings.ai.enabled).toBe(true)
    expect(settings.ai.consentAccepted).toBe(false)
    expect(settings.ai.openai.apiKey).toBe('')
    expect(settings.ai.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(isAiExpansionConfigured(settings)).toBe(false)
    expect(JSON.stringify(storageValues(window.localStorage))).not.toContain('user-ai-key')

    const exported = sanitizeReadExpansionSettingsForExport(sessionSettings)
    expect(exported.ai.openai).not.toHaveProperty('apiKey')
    expect(exported.ai).not.toHaveProperty('consentAccepted')
    expect(JSON.stringify(exported)).not.toContain('user-ai-key')
  })

  it('never reads a key from legacy settings storage and clears runtime consent with the key', () => {
    window.localStorage.clear()
    const sessionSettings = {
      ai: {
        enabled: true,
        consentAccepted: true,
        provider: 'openai',
        openai: {
          apiKey: 'user-ai-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
        },
      },
    } as const

    saveReadExpansionSettings(window.localStorage, sessionSettings)
    window.localStorage.setItem(
      'yomu:v2:secret:ai:openai',
      JSON.stringify({ schemaVersion: 2, secret: sessionSettings.ai.openai.apiKey }),
    )

    const loaded = loadReadExpansionSettings(window.localStorage)
    expect(loaded.ai.openai.apiKey).toBe('')
    expect(loaded.ai.consentAccepted).toBe(false)
    expect(isAiExpansionConfigured(loaded)).toBe(false)

    const cleared = clearAiApiKey(sessionSettings)
    expect(cleared.ai.openai.apiKey).toBe('')
    expect(cleared.ai.consentAccepted).toBe(false)
  })
})

function storageValues(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? '')
}

function createRemoteRecorder(
  handler: (request: RemoteServiceRequest) => unknown | Promise<unknown>,
): { adapter: RemoteServicesAdapter, request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(handler)
  const adapter: RemoteServicesAdapter = {
    request<TResponse>(remoteRequest: RemoteServiceRequest): Promise<TResponse> {
      return Promise.resolve(request(remoteRequest)) as Promise<TResponse>
    },
  }
  return { adapter, request }
}
