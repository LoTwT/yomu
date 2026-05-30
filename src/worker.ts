import {
  createImportFailure,
  isPrivateOrLocalHost,
  maxUrlResponseBytes,
  parseSupportedHttpUrl,
  validateUrlResponseMetadata,
  type ImportFailure,
} from './features/import/sourceGuards'
import { cleanImportedText } from './features/import/textCleaning'
import { buildMimoTtsPayload, defaultMimoTtsFormat, defaultMimoTtsModel, defaultMimoTtsVoice } from './features/tts/mimoPayload'
import type { TtsAudioFormat, TtsEndpointResponse } from './features/tts/types'

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
  MIMO_API_KEY?: string
  MIMO_BASE_URL?: string
  MIMO_TTS_MODEL?: string
}

const mimoTtsPath = '/api/tts/mimo'
const urlImportPath = '/api/import/url'
const defaultTokenPlanBaseUrl = 'https://token-plan-cn.xiaomimimo.com/v1'
const maxTtsSentenceChars = 1_200

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === mimoTtsPath) {
      return handleMimoTtsRequest(request, env)
    }
    if (url.pathname === urlImportPath) {
      return handleUrlImportRequest(request)
    }

    return env.ASSETS.fetch(request)
  },
}

export async function handleUrlImportRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError('Only POST is supported for URL import.', 405)
  }

  const body = await readJsonBody(request)
  if (!body.ok) {
    return jsonImportFailure(createImportFailure('extract-failed', body.message, 'url.extractFailed'), 400)
  }

  const urlInput = typeof body.value.url === 'string' ? body.value.url : ''
  const parsedUrl = parseSupportedHttpUrl(urlInput)
  if (!(parsedUrl instanceof URL)) {
    return jsonImportFailure(parsedUrl, parsedUrl.code === 'private-url' ? 403 : 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getUrlImportTimeoutMs(body.value.timeoutMs))

  try {
    const dnsFailure = await validateResolvedHostIsPublic(parsedUrl.hostname)
    if (dnsFailure) {
      return jsonImportFailure(dnsFailure, 403)
    }

    const response = await fetch(parsedUrl, {
      headers: { accept: 'text/html,text/plain,text/markdown,application/xhtml+xml;q=0.9,*/*;q=0.1' },
      redirect: 'manual',
      signal: controller.signal,
    })

    if (isRedirectStatus(response.status)) {
      const failure = createRedirectImportFailure(response, parsedUrl)
      return jsonImportFailure(failure, failure.code === 'private-url' ? 403 : 400)
    }

    if (!response.ok) {
      return jsonImportFailure(createImportFailure(
        'url-http-error',
        `This URL returned HTTP ${response.status}.`,
        response.status === 404 ? 'url.notFound' : 'url.extractFailed',
      ), response.status === 404 ? 404 : 502)
    }

    const metadataFailure = validateUrlResponseMetadata(response)
    if (metadataFailure) {
      return jsonImportFailure(metadataFailure, 400)
    }

    const rawText = await readLimitedImportText(response)
    if (typeof rawText !== 'string') {
      return jsonImportFailure(rawText, 413)
    }

    const cleanResult = cleanImportedText(rawText, {
      sourceKind: 'url',
      contentType: response.headers.get('content-type'),
    })

    return json({
      sourceUrl: parsedUrl.toString(),
      contentType: 'text/plain',
      text: cleanResult.text,
      removedDangerousBlocks: cleanResult.removedDangerousBlocks,
    })
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return jsonImportFailure(createImportFailure('url-timeout', 'This URL took too long to respond.', 'url.timeout'), 504)
    }

    return jsonImportFailure(createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed'), 502)
  }
  finally {
    clearTimeout(timeout)
  }
}

async function validateResolvedHostIsPublic(hostname: string): Promise<ImportFailure | null> {
  if (isIpLiteral(hostname)) {
    return null
  }

  const answers = await Promise.all([
    resolveDnsAnswers(hostname, 'A'),
    resolveDnsAnswers(hostname, 'AAAA'),
  ])
  const addresses = answers.flat()

  if (addresses.length === 0) {
    return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
  }
  if (addresses.some(isPrivateOrLocalHost)) {
    return createImportFailure('private-url', 'Local and private-network URLs cannot be imported.', 'url.scheme')
  }

  return null
}

async function resolveDnsAnswers(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
    headers: { accept: 'application/dns-json' },
  })
  if (!response.ok) {
    return []
  }

  const payload = await response.json() as {
    Answer?: Array<{ type?: number, data?: string }>
  }
  const answerType = type === 'A' ? 1 : 28
  return payload.Answer
    ?.filter(answer => answer.type === answerType && typeof answer.data === 'string')
    .map(answer => answer.data as string) ?? []
}

export async function handleMimoTtsRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError('Only POST is supported for sentence synthesis.', 405)
  }
  if (!env.MIMO_API_KEY) {
    return jsonError('Speech synthesis is not configured.', 503)
  }

  const body = await readJsonBody(request)
  if (!body.ok) {
    return jsonError(body.message, 400)
  }

  const text = typeof body.value.text === 'string' ? body.value.text.trim() : ''
  if (!text) {
    return jsonError('Sentence text is required.', 400)
  }
  if (text.length > maxTtsSentenceChars) {
    return jsonError('This sentence is too long for one synthesis request.', 413)
  }

  const format = body.value.format === 'wav' ? 'wav' : defaultMimoTtsFormat
  const payload = buildMimoTtsPayload({
    text,
    style: typeof body.value.style === 'string' ? body.value.style : undefined,
    voice: typeof body.value.voice === 'string' ? body.value.voice : defaultMimoTtsVoice,
    model: typeof body.value.model === 'string' ? body.value.model : env.MIMO_TTS_MODEL ?? defaultMimoTtsModel,
    format,
  })

  const providerResponse = await fetch(`${normalizeBaseUrl(env.MIMO_BASE_URL ?? defaultTokenPlanBaseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.MIMO_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json, audio/mpeg, audio/wav',
    },
    body: JSON.stringify(payload),
  })

  if (!providerResponse.ok) {
    return mapProviderError(providerResponse.status)
  }

  const normalized = await normalizeProviderAudioResponse(providerResponse, format)
  if (!normalized) {
    return jsonError('The speech provider did not return audio for this sentence.', 502)
  }

  return json(normalized)
}

async function readJsonBody(request: Request): Promise<
  | { ok: true, value: Record<string, unknown> }
  | { ok: false, message: string }
> {
  try {
    const value = await request.json()
    if (typeof value !== 'object' || value === null) {
      return { ok: false, message: 'A JSON object is required.' }
    }

    return { ok: true, value: value as Record<string, unknown> }
  }
  catch {
    return { ok: false, message: 'Invalid JSON body.' }
  }
}

async function normalizeProviderAudioResponse(response: Response, format: TtsAudioFormat): Promise<TtsEndpointResponse | null> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.startsWith('audio/')) {
    return {
      audioBase64: encodeBase64(await response.arrayBuffer()),
      mimeType: contentType.split(';')[0] ?? mimeTypeForFormat(format),
    }
  }

  const payload = await response.json() as Record<string, unknown>
  const audioBase64 = findAudioBase64(payload)
  if (!audioBase64) {
    return null
  }

  return {
    audioBase64,
    mimeType: findMimeType(payload) ?? mimeTypeForFormat(format),
    durationMs: findDurationMs(payload),
    providerRequestId: typeof payload.id === 'string' ? payload.id : undefined,
  }
}

function findAudioBase64(payload: Record<string, unknown>): string | null {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null
  const messageAudio = message && isRecord(message.audio) ? message.audio : null
  const rootAudio = isRecord(payload.audio) ? payload.audio : null

  for (const candidate of [
    messageAudio?.data,
    messageAudio?.audio_base64,
    rootAudio?.data,
    rootAudio?.audio_base64,
    payload.audioBase64,
    payload.audio_base64,
    payload.data,
  ]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

function findMimeType(payload: Record<string, unknown>): string | null {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null
  const messageAudio = message && isRecord(message.audio) ? message.audio : null
  const rootAudio = isRecord(payload.audio) ? payload.audio : null

  for (const candidate of [messageAudio?.mime_type, rootAudio?.mime_type, payload.mimeType, payload.mime_type]) {
    if (typeof candidate === 'string' && candidate.startsWith('audio/')) {
      return candidate
    }
  }

  return null
}

function findDurationMs(payload: Record<string, unknown>): number | undefined {
  const candidate = payload.durationMs ?? payload.duration_ms
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

function mapProviderError(status: number): Response {
  if (status === 401 || status === 403) {
    return jsonError('The speech provider rejected this sentence.', status)
  }
  if (status === 429) {
    return jsonError('The speech provider is rate-limited right now.', 429)
  }
  if (status >= 500) {
    return jsonError('The speech provider is temporarily unavailable.', 502)
  }

  return jsonError('This sentence could not be synthesized.', 502)
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status)
}

function jsonImportFailure(failure: ImportFailure, status: number): Response {
  return json({
    code: failure.code,
    variant: failure.variant,
    message: failure.message,
  }, status)
}

async function readLimitedImportText(response: Response): Promise<string | ImportFailure> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      bytesRead += value.byteLength
      if (bytesRead > maxUrlResponseBytes) {
        await reader.cancel()
        return createImportFailure('url-too-large', 'This page is too large for one read-aloud session.', 'url.extractFailed')
      }

      text += decoder.decode(value, { stream: true })
    }

    text += decoder.decode()
    return text
  }
  finally {
    reader.releaseLock()
  }
}

function getUrlImportTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 10_000
  }

  return Math.min(Math.max(1_000, value), 15_000)
}

function isIpLiteral(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(normalized)
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

function createRedirectImportFailure(response: Response, baseUrl: URL): ImportFailure {
  const location = response.headers.get('location')
  if (location) {
    try {
      const parsedRedirect = parseSupportedHttpUrl(new URL(location, baseUrl).toString())
      if (!(parsedRedirect instanceof URL)) {
        return parsedRedirect
      }
    }
    catch {
      return createImportFailure('unsupported-url', 'Redirecting URLs are not supported for URL import.', 'url.extractFailed')
    }
  }

  return createImportFailure('unsupported-url', 'Redirecting URLs are not supported for URL import. Please paste the final article URL.', 'url.extractFailed')
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function mimeTypeForFormat(format: TtsAudioFormat): string {
  return format === 'wav' ? 'audio/wav' : 'audio/mpeg'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
