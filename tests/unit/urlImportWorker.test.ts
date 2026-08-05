import { afterEach, describe, expect, it, vi } from 'vitest'

import worker, { handleUrlImportRequest } from '@/worker'

afterEach(() => {
  vi.useRealTimers()
})

describe('URL import Worker boundary', () => {
  it('rate-limits the public Worker route before starting URL processing', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const assetsFetch = vi.fn<typeof fetch>()
    const request = createRequest('http://localhost/private')
    request.headers.set('cf-connecting-ip', '203.0.113.42')
    const response = await worker.fetch(
      request,
      {
        ASSETS: { fetch: assetsFetch },
        MIMO_TTS_MODEL: 'mimo-v2.5-tts',
        URL_IMPORT_RATE_LIMITER: { limit },
      },
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      code: 'url-unavailable',
      variant: 'url.unavailable',
    })
    expect(limit).toHaveBeenCalledWith({ key: 'yomu:url-import:203.0.113.42' })
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('rejects reserved IPv6 literals before any network request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const response = await handleUrlImportRequest(createRequest('http://[fec0::1]/internal'), { fetchImpl })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'private-url',
      variant: 'url.scheme',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an oversized streamed JSON body before URL processing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const request = new Request('https://yomu.test/api/import/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://origin.example/story',
        padding: 'x'.repeat(100_000),
      }),
    })

    expect(request.headers.get('content-length')).toBeNull()

    const response = await handleUrlImportRequest(request, { fetchImpl })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'extract-failed',
      variant: 'url.extractFailed',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns size-limited raw HTML as no-store JSON without executing or cleaning it', async () => {
    const rawHtml = '<article><h1>Remote title</h1><p>Readable body.</p><script>globalThis.compromised = true</script></article>'
    const fetchImpl = createPublicFetch(async () => new Response(rawHtml, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))

    const response = await handleUrlImportRequest(createRequest('https://origin.example/story'), { fetchImpl })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(await response.json()).toEqual({
      sourceUrl: 'https://origin.example/story',
      contentType: 'text/html; charset=utf-8',
      content: rawHtml,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'manual',
    })
    expect((globalThis as Record<string, unknown>).compromised).toBeUndefined()
  })

  it('follows at most three redirects manually and revalidates DNS for every hop', async () => {
    const origins: string[] = []
    const fetchImpl = createPublicFetch(async (url) => {
      origins.push(url.toString())
      if (url.hostname === 'first.example') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://second.example/final' },
        })
      }
      return new Response('<article><p>Final public article body.</p></article>', {
        headers: { 'content-type': 'text/html' },
      })
    })

    const response = await handleUrlImportRequest(createRequest('https://first.example/start'), { fetchImpl })
    const payload = await response.json() as Record<string, unknown>
    const dnsHosts = fetchImpl.mock.calls
      .map(call => new URL(String(call[0])))
      .filter(url => url.hostname === 'cloudflare-dns.com')
      .map(url => url.searchParams.get('name'))

    expect(response.status).toBe(200)
    expect(payload.sourceUrl).toBe('https://second.example/final')
    expect(origins).toEqual([
      'https://first.example/start',
      'https://second.example/final',
    ])
    expect(dnsHosts).toEqual([
      'first.example',
      'first.example',
      'second.example',
      'second.example',
    ])
  })

  it('fails closed before a fourth redirect can be followed', async () => {
    let originFetches = 0
    const fetchImpl = createPublicFetch(async (url) => {
      originFetches += 1
      const hop = Number(url.hostname.match(/hop-(\d+)/)?.[1] ?? 0)
      return new Response(null, {
        status: 302,
        headers: { location: `https://hop-${hop + 1}.example/story` },
      })
    })

    const response = await handleUrlImportRequest(createRequest('https://hop-0.example/story'), { fetchImpl })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      code: 'url-unavailable',
      variant: 'url.unavailable',
    })
    expect(originFetches).toBe(4)
  })

  it('applies the total timeout to DNS lookups as well as the origin request', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })) as unknown as typeof fetch

    const pending = handleUrlImportRequest(createRequest('https://slow.example/story', 1_000), { fetchImpl })
    await vi.advanceTimersByTimeAsync(1_000)
    const response = await pending

    expect(response.status).toBe(504)
    expect(await response.json()).toMatchObject({
      code: 'url-timeout',
      variant: 'url.timeout',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported response types before reading their body', async () => {
    const fetchImpl = createPublicFetch(async () => new Response('%PDF-1.7', {
      headers: { 'content-type': 'application/pdf' },
    }))

    const response = await handleUrlImportRequest(createRequest('https://origin.example/document.pdf'), { fetchImpl })

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({
      code: 'unsupported-content-type',
      variant: 'url.unsupportedType',
    })
  })

  it.each([
    'text/htmlx',
    'application/json; profile=text/html',
    'application/xhtml+xml-evil',
  ])('rejects deceptive response media type %s', async (contentType) => {
    const fetchImpl = createPublicFetch(async () => new Response('<article>Not HTML.</article>', {
      headers: { 'content-type': contentType },
    }))

    const response = await handleUrlImportRequest(createRequest('https://origin.example/deceptive'), { fetchImpl })

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({
      code: 'unsupported-content-type',
      variant: 'url.unsupportedType',
    })
  })
})

function createRequest(url: string, timeoutMs?: number): Request {
  return new Request('https://yomu.test/api/import/url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, timeoutMs }),
  })
}

function createPublicFetch(
  fetchOrigin: (url: URL, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.hostname === 'cloudflare-dns.com') {
      const type = url.searchParams.get('type')
      return new Response(JSON.stringify({
        Answer: type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [],
      }), {
        headers: { 'content-type': 'application/dns-json' },
      })
    }
    return fetchOrigin(url, init)
  })
}
