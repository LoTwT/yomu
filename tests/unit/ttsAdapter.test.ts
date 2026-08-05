import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTtsCacheKey } from '@/features/tts/cacheKey'
import { maxUrlResponseBytes } from '@/features/import/sourceGuards'
import { createTimedSentencePlayer } from '@/features/player/useReadAloudSession'
import { createConfiguredSentencePlayer } from '@/features/tts/configuredSentencePlayer'
import { createMimoTtsProvider } from '@/features/tts/mimoAdapter'
import { buildMimoTtsPayload } from '@/features/tts/mimoPayload'
import { createMemorySentenceAudioCache } from '@/features/tts/sentenceAudioCache'
import { defaultTtsSettings, type TtsSettings } from '@/features/tts/settings'
import type {
  SentenceAudioCache,
  TtsEndpointResponse,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from '@/features/tts/types'
import type { RemoteServiceRequest, RemoteServicesAdapter } from '@/platform/contracts'
import { handleAiExpansionRequest, handleMimoTtsRequest, handleUrlImportRequest } from '@/worker'

const request: TtsSynthesisRequest = {
  provider: 'mimo',
  model: 'mimo-v2.5-tts',
  voice: 'Mia',
  format: 'mp3',
  sentenceId: 'p1-s1',
  text: 'A careful reader can bring their own article into Yomu.',
  textHash: 'b5d3d7f138f15d1a',
  language: 'en',
  style: 'Bright and natural.',
}

describe('MiMo TTS adapter', () => {
  beforeEach(() => {
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:yomu-audio')
      static revokeObjectURL = vi.fn()
    }

    vi.stubGlobal('URL', TestUrl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds sentence cache keys from provider metadata and textHash, never plaintext', () => {
    const cacheKey = createTtsCacheKey(request)

    expect(cacheKey).toContain(request.textHash)
    expect(cacheKey).toContain('mimo')
    expect(cacheKey).toContain('Mia')
    expect(cacheKey).not.toContain('careful')
    expect(createTtsCacheKey({ ...request, voice: 'Dean' })).not.toBe(cacheKey)
  })

  it('revokes replaced, deleted, and cleared object URLs from the memory cache', async () => {
    const cache = createMemorySentenceAudioCache()

    await cache.put('first', createCachedResult('blob:first'))
    await cache.put('first', createCachedResult('blob:replacement'))
    await cache.put('remote', createCachedResult('https://cdn.example/audio.mp3'))
    await cache.delete('first')
    await cache.put('last', createCachedResult('blob:last'))
    await cache.clear()

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual([
      'blob:first',
      'blob:replacement',
      'blob:last',
    ])
    await expect(cache.get('remote')).resolves.toBeNull()
  })

  it('delegates MiMo synthesis to the remote service boundary and reuses cache hits', async () => {
    const remote = createRemoteRecorder(() => ({
      audioBase64: btoa('mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1200,
    } satisfies TtsEndpointResponse))
    const provider = createMimoTtsProvider({
      remote: remote.adapter,
      cache: createMemorySentenceAudioCache(),
      getCredentials: () => ({ apiKey: 'user-key', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }),
    })

    const first = await provider.synthesizeSentence(request)
    const second = await provider.synthesizeSentence(request)

    expect(first.source).toBe('network')
    expect(second.source).toBe('cache')
    expect(remote.request).toHaveBeenCalledTimes(1)
    expect(remote.request.mock.calls[0]?.[0]).toMatchObject({
      operation: 'mimo-tts',
      body: {
        apiKey: 'user-key',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        sentenceId: request.sentenceId,
      },
    })
    expect(JSON.stringify(remote.request.mock.calls[0]?.[0])).not.toContain('MIMO_API_KEY')
  })

  it('dedupes in-flight MiMo synthesis requests for the same sentence cache key', async () => {
    let resolveRemote!: (response: TtsEndpointResponse) => void
    const remote = createRemoteRecorder(() =>
      new Promise<TtsEndpointResponse>((resolve) => {
        resolveRemote = resolve
      }),
    )
    const provider = createMimoTtsProvider({
      remote: remote.adapter,
      cache: createMemorySentenceAudioCache(),
      getCredentials: () => ({ apiKey: 'user-key', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }),
    })

    const first = provider.synthesizeSentence(request)
    const second = provider.synthesizeSentence(request)
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(1))

    resolveRemote({
      audioBase64: btoa('mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1200,
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    const cached = await provider.synthesizeSentence(request)

    expect(firstResult.source).toBe('network')
    expect(secondResult.source).toBe('network')
    expect(cached.source).toBe('cache')
    expect(remote.request).toHaveBeenCalledTimes(1)
  })

  it('starts a new generation after cache clear without reusing or recaching stale requests', async () => {
    const deferredRequests: Array<{
      request: RemoteServiceRequest
      resolve: (response: TtsEndpointResponse) => void
    }> = []
    const remote = createRemoteRecorder(remoteRequest =>
      new Promise<TtsEndpointResponse>((resolve) => {
        deferredRequests.push({ request: remoteRequest, resolve })
      }),
    )
    const entries = new Map<string, Omit<TtsSynthesisResult, 'source'>>()
    const cache: SentenceAudioCache = {
      get: vi.fn(async cacheKey => entries.get(cacheKey) ?? null),
      put: vi.fn(async (cacheKey, result) => {
        entries.set(cacheKey, result)
      }),
      delete: vi.fn(async cacheKey => {
        entries.delete(cacheKey)
      }),
      clear: vi.fn(async () => {
        entries.clear()
      }),
    }
    let apiKey = 'key-a'
    const provider = createMimoTtsProvider({
      remote: remote.adapter,
      cache,
      getCredentials: () => ({ apiKey }),
    })

    const stale = provider.synthesizeSentence(request)
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(1))

    apiKey = 'key-b'
    await provider.clearCache()
    expect(deferredRequests[0]?.request.signal?.aborted).toBe(true)
    expect(cache.clear).toHaveBeenCalledTimes(1)

    const current = provider.synthesizeSentence(request)
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(2))
    expect(remote.request.mock.calls.map(call => call[0].body.apiKey)).toEqual(['key-a', 'key-b'])

    deferredRequests[0]?.resolve({
      audioBase64: btoa('stale-mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1100,
    })
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache.put).not.toHaveBeenCalled()

    const joinedCurrent = provider.synthesizeSentence(request)
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(2))

    deferredRequests[1]?.resolve({
      audioBase64: btoa('current-mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 2200,
    })
    const [currentResult, joinedResult] = await Promise.all([current, joinedCurrent])
    expect(currentResult).toMatchObject({ source: 'network', durationMs: 2200 })
    expect(joinedResult).toMatchObject({ source: 'network', durationMs: 2200 })
    expect(cache.put).toHaveBeenCalledTimes(1)

    const cached = await provider.synthesizeSentence(request)
    expect(cached).toMatchObject({ source: 'cache', durationMs: 2200 })
    expect(remote.request).toHaveBeenCalledTimes(2)
  })

  it('cancels pending synthesis without clearing completed cache entries', async () => {
    let resolvePending!: (response: TtsEndpointResponse) => void
    const pendingRequest = {
      ...request,
      sentenceId: 'p1-s2',
      text: 'This sentence remains pending until the session stops.',
      textHash: 'pending-text-hash',
    }
    const remote = createRemoteRecorder(remoteRequest => {
      if (remoteRequest.body.textHash === request.textHash) {
        return {
          audioBase64: btoa('cached-mp3-bytes'),
          mimeType: 'audio/mpeg',
          durationMs: 1200,
        } satisfies TtsEndpointResponse
      }
      return new Promise<TtsEndpointResponse>((resolve) => {
        resolvePending = resolve
      })
    })
    const cache = createMemorySentenceAudioCache()
    const clearCache = vi.spyOn(cache, 'clear')
    const provider = createMimoTtsProvider({
      remote: remote.adapter,
      cache,
      getCredentials: () => ({ apiKey: 'user-key' }),
    })

    await provider.synthesizeSentence(request)
    const pending = provider.synthesizeSentence(pendingRequest)
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(2))

    provider.cancelPending()
    expect(remote.request.mock.calls[1]?.[0].signal?.aborted).toBe(true)
    resolvePending({
      audioBase64: btoa('stale-mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1300,
    })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    const cached = await provider.synthesizeSentence(request)
    expect(cached.source).toBe('cache')
    expect(clearCache).not.toHaveBeenCalled()
    expect(remote.request).toHaveBeenCalledTimes(2)
  })

  it('removes a cache entry committed while pending cancellation invalidates its generation', async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce('blob:stale-audio')
      .mockReturnValueOnce('blob:fresh-audio')
    const remote = createRemoteRecorder(() => ({
      audioBase64: btoa('mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1200,
    } satisfies TtsEndpointResponse))
    const entries = new Map<string, Omit<TtsSynthesisResult, 'source'>>()
    let cancelDuringPut = true
    let provider!: ReturnType<typeof createMimoTtsProvider>
    const cache: SentenceAudioCache = {
      get: vi.fn(async cacheKey => entries.get(cacheKey) ?? null),
      put: vi.fn(async (cacheKey, result) => {
        entries.set(cacheKey, result)
        if (cancelDuringPut) {
          cancelDuringPut = false
          provider.cancelPending()
        }
      }),
      delete: vi.fn(async cacheKey => {
        entries.delete(cacheKey)
      }),
      clear: vi.fn(async () => {
        entries.clear()
      }),
    }
    provider = createMimoTtsProvider({
      remote: remote.adapter,
      cache,
      getCredentials: () => ({ apiKey: 'user-key' }),
    })

    await expect(provider.synthesizeSentence(request))
      .rejects.toMatchObject({ name: 'AbortError' })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-audio')
    expect(entries.size).toBe(0)

    const retry = await provider.synthesizeSentence(request)
    expect(retry).toMatchObject({ source: 'network', audioUrl: 'blob:fresh-audio' })
    expect(remote.request).toHaveBeenCalledTimes(2)
  })

  it('prefetches upcoming MiMo sentences but skips Web Speech', async () => {
    const remote = createRemoteRecorder(() => ({
      audioBase64: btoa('mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1200,
    } satisfies TtsEndpointResponse))

    let settings: TtsSettings = {
      ...defaultTtsSettings,
      provider: 'mimo',
      mimo: {
        ...defaultTtsSettings.mimo,
        apiKey: 'user-key',
      },
    }
    const player = createConfiguredSentencePlayer(() => settings, {
      browserPlayer: createTimedSentencePlayer(),
      remote: remote.adapter,
    })

    await player.prefetchSentences?.({
      language: 'en',
      sentences: [
        { id: 'p1-s2', original: 'The second sentence is ready soon.', textHash: 'hash-s2' },
        { id: 'p1-s3', original: 'The third sentence follows without a long wait.', textHash: 'hash-s3' },
      ],
    })

    settings = {
      ...settings,
      provider: 'webspeech',
    }
    await player.prefetchSentences?.({
      language: 'en',
      sentences: [
        { id: 'p1-s4', original: 'The browser voice path should not prefetch.', textHash: 'hash-s4' },
      ],
    })

    expect(remote.request).toHaveBeenCalledTimes(2)
    expect(remote.request.mock.calls.map(call => call[0].body.sentenceId)).toEqual(['p1-s2', 'p1-s3'])
    expect(remote.request.mock.calls.every(call => call[0].operation === 'mimo-tts')).toBe(true)
  })

  it('routes configured-player pending cancellation without requiring a cache clear', async () => {
    const remote = createRemoteRecorder(remoteRequest =>
      new Promise<TtsEndpointResponse>((_resolve, reject) => {
        remoteRequest.signal?.addEventListener('abort', () => reject(remoteRequest.signal?.reason), {
          once: true,
        })
      }),
    )
    const settings: TtsSettings = {
      ...defaultTtsSettings,
      provider: 'mimo',
      mimo: {
        ...defaultTtsSettings.mimo,
        apiKey: 'user-key',
      },
    }
    const player = createConfiguredSentencePlayer(() => settings, {
      browserPlayer: createTimedSentencePlayer(),
      remote: remote.adapter,
    })

    const prefetch = player.prefetchSentences?.({
      language: 'en',
      sentences: [
        { id: 'p1-s2', original: 'The pending sentence should be canceled.', textHash: 'hash-s2' },
      ],
    })
    await vi.waitFor(() => expect(remote.request).toHaveBeenCalledTimes(1))

    await player.cancelPending?.()

    expect(remote.request.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    await expect(prefetch).resolves.toBeUndefined()
  })

  it('formats the MiMo chat-completions TTS payload with assistant text and optional style guidance', () => {
    const payload = buildMimoTtsPayload({
      text: request.text,
      style: request.style,
      voice: request.voice,
      format: request.format,
      model: request.model,
    })

    expect(payload).toMatchObject({
      model: 'mimo-v2.5-tts',
      modalities: ['audio'],
      audio: { voice: 'Mia', format: 'mp3' },
    })
    expect(payload.messages).toEqual([
      { role: 'assistant', content: request.text },
      { role: 'user', content: request.style },
    ])
  })

  it('requires BYOK credentials and maps provider failures without exposing key state', async () => {
    const missingKey = await handleMimoTtsRequest(new Request('https://yomu.test/api/tts/mimo', {
      method: 'POST',
      body: JSON.stringify(request),
    }), {
      ASSETS: { fetch: vi.fn() },
    })

    expect(missingKey.status).toBe(401)
    expect(missingKey.headers.get('cache-control')).toBe('no-store')
    expect(missingKey.headers.get('pragma')).toBe('no-cache')
    expect(await missingKey.text()).not.toContain('secret-key')

    const providerFetch = vi.fn(async () => new Response('no', { status: 401 }))
    vi.stubGlobal('fetch', providerFetch)

    const rejected = await handleMimoTtsRequest(new Request('https://yomu.test/api/tts/mimo', {
      method: 'POST',
      body: JSON.stringify({ ...request, apiKey: 'secret-key' }),
    }), {
      ASSETS: { fetch: vi.fn() },
    })

    expect(rejected.status).toBe(401)
    expect(rejected.headers.get('cache-control')).toBe('no-store')
    expect(rejected.headers.get('pragma')).toBe('no-cache')
    expect(await rejected.text()).not.toContain('secret-key')
    expect(providerFetch.mock.calls[0]?.[0]).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
  })

  it('marks successful MiMo BYOK endpoint responses as no-store', async () => {
    const providerFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        audioBase64: btoa('mp3-bytes'),
        mimeType: 'audio/mpeg',
        durationMs: 1200,
      }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', providerFetch)

    const response = await handleMimoTtsRequest(new Request('https://yomu.test/api/tts/mimo', {
      method: 'POST',
      body: JSON.stringify({ ...request, apiKey: 'secret-key' }),
    }), {
      ASSETS: { fetch: vi.fn() },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(await response.text()).not.toContain('secret-key')
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported MiMo base URLs instead of proxying arbitrary hosts', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const rejected = await handleMimoTtsRequest(new Request('https://yomu.test/api/tts/mimo', {
      method: 'POST',
      body: JSON.stringify({
        ...request,
        apiKey: 'secret-key',
        baseUrl: 'https://example.com/v1',
      }),
    }), {
      ASSETS: { fetch: vi.fn() },
    })

    expect(rejected.status).toBe(400)
    expect(await rejected.text()).not.toContain('secret-key')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('keeps AI expansion BYOK responses no-store and sends only minimal context', async () => {
    const providerFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        output_text: JSON.stringify({
          meaning: '睡眠: 身体和大脑恢复的时间。',
          examples: ['Sleep helps your brain rest.'],
          background: 'Often used as both a noun and a verb.',
        }),
      }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', providerFetch)

    const response = await handleAiExpansionRequest(new Request('https://yomu.test/api/extensions/ai', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'secret-ai-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        term: 'sleep',
        localGloss: '睡眠',
        context: `${'A'.repeat(400)} should be clamped`,
      }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(await response.text()).not.toContain('secret-ai-key')
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(providerFetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses')
    const providerBody = JSON.stringify(providerFetch.mock.calls[0]?.[1]?.body)
    expect(providerBody).toContain('word: sleep')
    expect(providerBody).not.toContain('secret-ai-key')
    expect(providerBody).not.toContain('A'.repeat(361))
  })

  it('requires AI BYOK and rejects unsupported AI proxy hosts', async () => {
    const missingKey = await handleAiExpansionRequest(new Request('https://yomu.test/api/extensions/ai', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        term: 'sleep',
        context: 'Sleep helps memory.',
      }),
    }))

    expect(missingKey.status).toBe(401)
    expect(missingKey.headers.get('cache-control')).toBe('no-store')
    expect(await missingKey.text()).not.toContain('secret-ai-key')

    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    const unsupportedHost = await handleAiExpansionRequest(new Request('https://yomu.test/api/extensions/ai', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'secret-ai-key',
        baseUrl: 'https://example.com/v1',
        term: 'sleep',
        context: 'Sleep helps memory.',
      }),
    }))

    expect(unsupportedHost.status).toBe(400)
    expect(await unsupportedHost.text()).not.toContain('secret-ai-key')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('keeps AI provider network and parse failures no-store and redacted', async () => {
    const networkFailure = vi.fn(async () => {
      throw new Error('upstream failed with secret-ai-key')
    })
    vi.stubGlobal('fetch', networkFailure)

    const failedFetch = await handleAiExpansionRequest(new Request('https://yomu.test/api/extensions/ai', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'secret-ai-key',
        baseUrl: 'https://api.openai.com/v1',
        term: 'sleep',
        context: 'Sleep helps memory.',
      }),
    }))

    expect(failedFetch.status).toBe(502)
    expect(failedFetch.headers.get('cache-control')).toBe('no-store')
    expect(failedFetch.headers.get('pragma')).toBe('no-cache')
    expect(await failedFetch.text()).not.toContain('secret-ai-key')

    const invalidJson = vi.fn(async () =>
      new Response('not json', {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', invalidJson)

    const failedParse = await handleAiExpansionRequest(new Request('https://yomu.test/api/extensions/ai', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'secret-ai-key',
        baseUrl: 'https://api.openai.com/v1',
        term: 'sleep',
        context: 'Sleep helps memory.',
      }),
    }))

    expect(failedParse.status).toBe(502)
    expect(failedParse.headers.get('cache-control')).toBe('no-store')
    expect(failedParse.headers.get('pragma')).toBe('no-cache')
    expect(await failedParse.text()).not.toContain('secret-ai-key')
  })

  it('keeps URL import SSRF checks server-side before fetching remote pages', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const response = await handleUrlImportRequest(new Request('https://yomu.test/api/import/url', {
      method: 'POST',
      body: JSON.stringify({ url: 'http://localhost:8787/private' }),
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'private-url',
      variant: 'url.scheme',
    })
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('blocks DNS rebinding targets that resolve to private addresses before page fetch', async () => {
    const providerFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        Answer: [
          { type: 1, data: '127.0.0.1' },
          { type: 28, data: '::ffff:7f00:1' },
        ],
      }), {
        headers: { 'content-type': 'application/dns-json' },
      }),
    )
    vi.stubGlobal('fetch', providerFetch)

    const response = await handleUrlImportRequest(new Request('https://yomu.test/api/import/url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.test/story' }),
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'private-url',
      variant: 'url.scheme',
    })
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(providerFetch.mock.calls.every(call => String(call[0]).startsWith('https://cloudflare-dns.com/dns-query'))).toBe(true)
  })

  it('does not follow redirects to local or private URL targets', async () => {
    for (const redirectTarget of [
      'http://127.0.0.1/private',
      'http://[::1]/private',
      'http://[::ffff:7f00:1]/private',
    ]) {
      const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('type=A')) {
          return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), {
            headers: { 'content-type': 'application/dns-json' },
          })
        }
        if (url.includes('type=AAAA')) {
          return new Response(JSON.stringify({ Answer: [] }), {
            headers: { 'content-type': 'application/dns-json' },
          })
        }

        return new Response('', {
          status: 302,
          headers: { location: redirectTarget },
        })
      })
      vi.stubGlobal('fetch', providerFetch)

      const response = await handleUrlImportRequest(new Request('https://yomu.test/api/import/url', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.test/story' }),
      }))

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'private-url',
        variant: 'url.scheme',
      })
      expect(providerFetch).toHaveBeenCalledTimes(3)
      expect(providerFetch.mock.calls[2]?.[1]).toMatchObject({ redirect: 'manual' })
    }
  })

  it('stops reading URL import bodies once the byte cap is exceeded', async () => {
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxUrlResponseBytes))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() {
        canceled = true
      },
    })
    const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('type=A')) {
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          headers: { 'content-type': 'application/dns-json' },
        })
      }
      if (url.includes('type=AAAA')) {
        return new Response(JSON.stringify({ Answer: [] }), {
          headers: { 'content-type': 'application/dns-json' },
        })
      }

      return new Response(body, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    })
    vi.stubGlobal('fetch', providerFetch)

    const response = await handleUrlImportRequest(new Request('https://yomu.test/api/import/url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.test/story' }),
    }))

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'url-too-large',
      variant: 'url.tooLarge',
    })
    expect(canceled).toBe(true)
  })
})

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

function createCachedResult(audioUrl: string): Omit<TtsSynthesisResult, 'source'> {
  return {
    provider: request.provider,
    model: request.model,
    voice: request.voice,
    format: request.format,
    sentenceId: request.sentenceId,
    textHash: request.textHash,
    cacheKey: createTtsCacheKey(request),
    audioUrl,
    mimeType: 'audio/mpeg',
    durationMs: 1200,
  }
}
