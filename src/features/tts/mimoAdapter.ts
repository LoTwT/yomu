import {
  RemoteServiceError,
  type RemoteServicesAdapter,
} from '@/platform/contracts'

import { createTtsCacheKey } from './cacheKey'
import { createNullSentenceAudioCache } from './sentenceAudioCache'
import type { SentenceAudioCache, SentenceTtsProvider, TtsEndpointResponse, TtsSynthesisRequest, TtsSynthesisResult } from './types'

export interface MimoTtsProviderOptions {
  remote: RemoteServicesAdapter
  cache?: SentenceAudioCache
  getCredentials?: () => MimoTtsCredentials
}

interface MimoTtsCredentials {
  apiKey: string
  baseUrl?: string
}

interface PendingSynthesisRequest {
  controller: AbortController
  generation: number
  promise: Promise<TtsSynthesisResult>
}

export function createMimoTtsProvider(options: MimoTtsProviderOptions): SentenceTtsProvider {
  const remote = options.remote
  const cache = options.cache ?? createNullSentenceAudioCache()
  const getCredentials: () => MimoTtsCredentials = options.getCredentials ?? (() => ({ apiKey: '' }))
  const pendingRequests = new Map<string, PendingSynthesisRequest>()
  let generation = 0
  let cacheMutationQueue: Promise<void> = Promise.resolve()
  let latestCacheClear: Promise<void> = Promise.resolve()

  function enqueueCacheMutation(task: () => Promise<void>): Promise<void> {
    const operation = cacheMutationQueue
      .catch(() => undefined)
      .then(task)
    cacheMutationQueue = operation.catch(() => undefined)
    return operation
  }

  function assertCurrentGeneration(expectedGeneration: number, signal?: AbortSignal): void {
    if (expectedGeneration !== generation || signal?.aborted) {
      throw signal ? readAbortReason(signal) : createAbortError()
    }
  }

  function cancelPending(): void {
    generation += 1
    const abortReason = createAbortError()
    const staleRequests = [...pendingRequests.values()]
    pendingRequests.clear()
    staleRequests.forEach(pending => pending.controller.abort(abortReason))
  }

  return {
    async synthesizeSentence(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
      const requestGeneration = generation
      await latestCacheClear
      await cacheMutationQueue
      assertCurrentGeneration(requestGeneration)

      const cacheKey = createTtsCacheKey(request)
      const cached = await cache.get(cacheKey)
      assertCurrentGeneration(requestGeneration)
      if (cached) {
        return { ...cached, source: 'cache' }
      }

      const pending = pendingRequests.get(cacheKey)
      if (pending?.generation === requestGeneration) {
        return pending.promise
      }

      const controller = new AbortController()
      let pendingRequest!: PendingSynthesisRequest
      const promise = synthesizeUncachedSentence({
        cacheKey,
        remote,
        getCredentials,
        request,
        signal: controller.signal,
        cacheResult: result => enqueueCacheMutation(async () => {
          assertCurrentGeneration(requestGeneration, controller.signal)
          await cache.put(cacheKey, result)
          try {
            assertCurrentGeneration(requestGeneration, controller.signal)
          }
          catch (error) {
            await cache.delete(cacheKey)
            throw error
          }
        }),
        assertCurrent: () => assertCurrentGeneration(requestGeneration, controller.signal),
      }).finally(() => {
        if (pendingRequests.get(cacheKey) === pendingRequest) {
          pendingRequests.delete(cacheKey)
        }
      })
      pendingRequest = {
        controller,
        generation: requestGeneration,
        promise,
      }
      pendingRequests.set(cacheKey, pendingRequest)
      return pendingRequest.promise
    },
    cancelPending,
    invalidateSentence(request: TtsSynthesisRequest): Promise<void> {
      const cacheKey = createTtsCacheKey(request)
      return enqueueCacheMutation(() => cache.delete(cacheKey))
    },
    clearCache(): Promise<void> {
      cancelPending()
      latestCacheClear = enqueueCacheMutation(() => cache.clear())
      return latestCacheClear
    },
  }
}

async function synthesizeUncachedSentence(options: {
  cacheKey: string
  remote: RemoteServicesAdapter
  getCredentials: () => MimoTtsCredentials
  request: TtsSynthesisRequest
  signal: AbortSignal
  cacheResult: (result: Omit<TtsSynthesisResult, 'source'>) => Promise<void>
  assertCurrent: () => void
}): Promise<TtsSynthesisResult> {
  const {
    cacheKey,
    remote,
    getCredentials,
    request,
    signal,
    cacheResult,
    assertCurrent,
  } = options
  const credentials = getCredentials()
  let payload: TtsEndpointResponse
  try {
    payload = await remote.request<TtsEndpointResponse>({
      operation: 'mimo-tts',
      body: {
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
      },
      signal,
    })
  }
  catch (error) {
    if (error instanceof RemoteServiceError) {
      throw new Error(toUserSafeTtsError(error.status))
    }
    throw error
  }

  assertCurrent()
  const audioUrl = createAudioObjectUrl(payload)
  const result: Omit<TtsSynthesisResult, 'source'> = {
    provider: request.provider,
    model: request.model,
    voice: request.voice,
    format: request.format,
    sentenceId: request.sentenceId,
    textHash: request.textHash,
    cacheKey,
    audioUrl,
    mimeType: payload.mimeType,
    durationMs: payload.durationMs ?? estimateDurationMs(request.text),
  }

  try {
    await cacheResult(result)
    return { ...result, source: 'network' }
  }
  catch (error) {
    URL.revokeObjectURL(audioUrl)
    throw error
  }
}

function createAbortError(): Error {
  const error = new Error('MiMo synthesis was invalidated.')
  error.name = 'AbortError'
  return error
}

function readAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : createAbortError()
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
