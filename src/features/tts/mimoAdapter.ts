import { createTtsCacheKey } from './cacheKey'
import { createNullSentenceAudioCache } from './sentenceAudioCache'
import type { SentenceAudioCache, SentenceTtsProvider, TtsEndpointResponse, TtsSynthesisRequest, TtsSynthesisResult } from './types'

export interface MimoTtsProviderOptions {
  endpoint?: string
  fetchImpl?: typeof fetch
  cache?: SentenceAudioCache
  getCredentials?: () => MimoTtsCredentials
}

interface MimoTtsCredentials {
  apiKey: string
  baseUrl?: string
}

export function createMimoTtsProvider(options: MimoTtsProviderOptions = {}): SentenceTtsProvider {
  const endpoint = options.endpoint ?? '/api/tts/mimo'
  const fetchImpl = options.fetchImpl ?? fetch
  const cache = options.cache ?? createNullSentenceAudioCache()
  const getCredentials: () => MimoTtsCredentials = options.getCredentials ?? (() => ({ apiKey: '' }))

  return {
    async synthesizeSentence(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
      const cacheKey = createTtsCacheKey(request)
      const cached = await cache.get(cacheKey)
      if (cached) {
        return { ...cached, source: 'cache' }
      }

      const credentials = getCredentials()
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          sentenceId: request.sentenceId,
          text: request.text,
          textHash: request.textHash,
          language: request.language,
          model: request.model,
          voice: request.voice,
          style: request.style,
          format: request.format,
        }),
      })

      if (!response.ok) {
        throw new Error(toUserSafeTtsError(response.status))
      }

      const payload = await response.json() as TtsEndpointResponse
      const result: Omit<TtsSynthesisResult, 'source'> = {
        provider: request.provider,
        model: request.model,
        voice: request.voice,
        format: request.format,
        sentenceId: request.sentenceId,
        textHash: request.textHash,
        cacheKey,
        audioUrl: createAudioObjectUrl(payload),
        mimeType: payload.mimeType,
        durationMs: payload.durationMs ?? estimateDurationMs(request.text),
      }

      await cache.put(cacheKey, result)
      return { ...result, source: 'network' }
    },
  }
}

function createAudioObjectUrl(payload: TtsEndpointResponse): string {
  const binary = globalThis.atob(payload.audioBase64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const blob = new Blob([bytes], { type: payload.mimeType })
  return URL.createObjectURL(blob)
}

function estimateDurationMs(text: string): number {
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 1
  return Math.max(900, Math.round((words / 155) * 60_000))
}

function toUserSafeTtsError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The speech provider rejected this sentence.'
  }
  if (status === 429) {
    return 'The speech provider is rate-limited right now.'
  }
  if (status >= 500) {
    return 'The speech provider is temporarily unavailable.'
  }

  return 'This sentence could not be synthesized.'
}
