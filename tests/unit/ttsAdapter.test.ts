import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTtsCacheKey } from '@/features/tts/cacheKey'
import { maxUrlResponseBytes } from '@/features/import/sourceGuards'
import { createConfiguredSentencePlayer } from '@/features/tts/configuredSentencePlayer'
import { createMimoTtsProvider } from '@/features/tts/mimoAdapter'
import { buildMimoTtsPayload } from '@/features/tts/mimoPayload'
import { createMemorySentenceAudioCache } from '@/features/tts/sentenceAudioCache'
import { defaultTtsSettings, type TtsSettings } from '@/features/tts/settings'
import type { TtsSynthesisRequest } from '@/features/tts/types'
import { handleMimoTtsRequest, handleUrlImportRequest } from '@/worker'

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

  it('calls the same-origin yomu endpoint and reuses sentence-level cache hits', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        audioBase64: btoa('mp3-bytes'),
        mimeType: 'audio/mpeg',
        durationMs: 1200,
      }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    const provider = createMimoTtsProvider({
      endpoint: '/api/tts/mimo',
      fetchImpl,
      cache: createMemorySentenceAudioCache(),
      getCredentials: () => ({ apiKey: 'user-key', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }),
    })

    const first = await provider.synthesizeSentence(request)
    const second = await provider.synthesizeSentence(request)

    expect(first.source).toBe('network')
    expect(second.source).toBe('cache')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/tts/mimo')
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1])).toContain('user-key')
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1])).not.toContain('MIMO_API_KEY')
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('xiaomimimo.com')
  })

  it('dedupes in-flight MiMo synthesis requests for the same sentence cache key', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchImpl = vi.fn(() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    const provider = createMimoTtsProvider({
      endpoint: '/api/tts/mimo',
      fetchImpl,
      cache: createMemorySentenceAudioCache(),
      getCredentials: () => ({ apiKey: 'user-key', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }),
    })

    const first = provider.synthesizeSentence(request)
    const second = provider.synthesizeSentence(request)
    await Promise.resolve()

    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({
      audioBase64: btoa('mp3-bytes'),
      mimeType: 'audio/mpeg',
      durationMs: 1200,
    }), {
      headers: { 'content-type': 'application/json' },
    }))

    const [firstResult, secondResult] = await Promise.all([first, second])
    const cached = await provider.synthesizeSentence(request)

    expect(firstResult.source).toBe('network')
    expect(secondResult.source).toBe('network')
    expect(cached.source).toBe('cache')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('prefetches upcoming MiMo sentences but skips Web Speech', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        audioBase64: btoa('mp3-bytes'),
        mimeType: 'audio/mpeg',
        durationMs: 1200,
      }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    let settings: TtsSettings = {
      ...defaultTtsSettings,
      provider: 'mimo',
      mimo: {
        ...defaultTtsSettings.mimo,
        apiKey: 'user-key',
      },
    }
    const player = createConfiguredSentencePlayer(() => settings)

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

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(call => JSON.parse(String(call[1]?.body)).sentenceId)).toEqual(['p1-s2', 'p1-s3'])
    expect(fetchImpl.mock.calls.every(call => String(call[0]) === '/api/tts/mimo')).toBe(true)
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
      variant: 'url.extractFailed',
    })
    expect(canceled).toBe(true)
  })
})
