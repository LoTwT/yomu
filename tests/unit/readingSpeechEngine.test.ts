import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createReadingSpeechEngine,
  type ReadingSpeechRequest,
  type ReadingSpeechSentence,
} from '@/features/tts/readingSpeechEngine'
import { defaultTtsSettings, type TtsSettings } from '@/features/tts/settings'
import type { TtsEndpointResponse } from '@/features/tts/types'
import type {
  AudioPlaybackAdapter,
  AudioPlaybackRequest,
  RemoteServiceRequest,
  RemoteServicesAdapter,
  SpeechAdapter,
  SpeechRequest,
} from '@/platform/contracts'
import { WebCloudSpeechAdapter } from '@/platform/web/runtimeAdapters'

const sentences: ReadingSpeechSentence[] = [1, 2, 3, 4, 5].map(index => ({
  id: `article-a:s${index}`,
  original: `This is sentence ${index}.`,
  textHash: `sentence-hash-${index}`,
}))

describe('reading speech engine', () => {
  beforeEach(() => {
    let objectUrlSequence = 0
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => `blob:yomu-audio-${++objectUrlSequence}`)
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestUrl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aborts the active MiMo request and its prefetch window without accepting late audio', async () => {
    const remote = createDeferredRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })
    const active = createRequest(sentences[0]!)

    const playback = engine.playSentence(active.request)
    const prefetch = engine.prefetchSentences([
      sentences[1]!,
      sentences[2]!,
      sentences[3]!,
    ], true)
    await vi.waitFor(() => expect(remote.pending).toHaveLength(3))
    expect(remote.pending.map(entry => entry.request.body.sentenceId)).toEqual([
      'article-a:s1',
      'article-a:s2',
      'article-a:s3',
    ])

    const rejectedPlayback = expect(playback).rejects.toMatchObject({ name: 'AbortError' })
    active.controller.abort()

    expect(remote.pending.every(entry => entry.request.signal?.aborted)).toBe(true)
    remote.pending.forEach(entry => entry.operation.resolve(createTtsResponse()))
    await rejectedPlayback
    await expect(prefetch).resolves.toBeUndefined()

    expect(audio.play).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(active.callbacks.onStart).not.toHaveBeenCalled()
    expect(active.callbacks.onEnd).not.toHaveBeenCalled()
    expect(active.callbacks.onError).not.toHaveBeenCalled()

    const retry = createRequest(sentences[0]!)
    const retryPlayback = engine.playSentence(retry.request)
    await vi.waitFor(() => expect(remote.pending).toHaveLength(4))
    remote.pending[3]!.operation.resolve(createTtsResponse())
    await retryPlayback

    expect(remote.pending[3]!.request.body.sentenceId).toBe('article-a:s1')
    expect(audio.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sourceUrl: 'blob:yomu-audio-1',
      signal: retry.controller.signal,
    }))
    expect(retry.callbacks.onStart).toHaveBeenCalledTimes(1)

    await engine.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yomu-audio-1')
  })

  it('stops active and prefetched synthesis even when the caller signal remains active', async () => {
    const remote = createDeferredRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })
    const active = createRequest(sentences[0]!)
    const playback = engine.playSentence(active.request)
    const prefetch = engine.prefetchSentences([sentences[1]!, sentences[2]!], true)
    await vi.waitFor(() => expect(remote.pending).toHaveLength(3))
    const rejectedPlayback = expect(playback).rejects.toMatchObject({ name: 'AbortError' })

    engine.stop()

    expect(active.controller.signal.aborted).toBe(false)
    expect(remote.pending.every(entry => entry.request.signal?.aborted)).toBe(true)
    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(speech.stop).toHaveBeenCalledTimes(1)
    remote.pending.forEach(entry => entry.operation.resolve(createTtsResponse()))
    await rejectedPlayback
    await expect(prefetch).resolves.toBeUndefined()
    expect(audio.play).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('limits prefetch to two, reuses prefetched audio, and evicts the least recently used Blob', async () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })

    await engine.prefetchSentences([
      sentences[1]!,
      sentences[2]!,
      sentences[3]!,
    ], true)
    expect(remote.request.mock.calls.map(([request]) => request.body.sentenceId)).toEqual([
      'article-a:s2',
      'article-a:s3',
    ])
    expect(audio.play).not.toHaveBeenCalled()

    const cachedPlayback = createRequest(sentences[1]!)
    await engine.playSentence(cachedPlayback.request)
    expect(remote.request).toHaveBeenCalledTimes(2)
    expect(audio.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sourceUrl: 'blob:yomu-audio-1',
    }))

    await engine.prefetchSentences([sentences[3]!, sentences[4]!], true)
    expect(remote.request.mock.calls.map(([request]) => request.body.sentenceId)).toEqual([
      'article-a:s2',
      'article-a:s3',
      'article-a:s4',
      'article-a:s5',
    ])
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:yomu-audio-2')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:yomu-audio-1')

    await engine.dispose()
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual([
      'blob:yomu-audio-2',
      'blob:yomu-audio-1',
      'blob:yomu-audio-3',
      'blob:yomu-audio-4',
    ])
  })

  it('isolates a failed prefetch sentence from current playback and later cache hits', async () => {
    const remote = createRemoteRecorder((request) => {
      if (request.body.sentenceId === 'article-a:s2') {
        throw new Error('Prefetch sentence failed.')
      }
      return createTtsResponse()
    })
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })

    await expect(engine.prefetchSentences([sentences[1]!, sentences[2]!], true))
      .resolves.toBeUndefined()
    const active = createRequest(sentences[0]!)
    await expect(engine.playSentence(active.request)).resolves.toBeDefined()
    const cached = createRequest(sentences[2]!)
    await expect(engine.playSentence(cached.request)).resolves.toBeDefined()

    expect(remote.request.mock.calls.map(([request]) => request.body.sentenceId)).toEqual([
      'article-a:s2',
      'article-a:s3',
      'article-a:s1',
    ])
    expect(audio.play.mock.calls.map(([request]) => request.sourceUrl)).toEqual([
      'blob:yomu-audio-2',
      'blob:yomu-audio-1',
    ])
    expect(active.callbacks.onError).not.toHaveBeenCalled()
    expect(cached.callbacks.onError).not.toHaveBeenCalled()

    await engine.dispose()
  })

  it('evicts audio that fails after playback starts so retry synthesizes it again', async () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })

    await engine.playSentence(createRequest(sentences[0]!).request)
    audio.play.mock.calls[0]?.[0].onError?.(new Error('Decoded audio failed.'))
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yomu-audio-1'))

    await engine.playSentence(createRequest(sentences[0]!).request)
    expect(remote.request).toHaveBeenCalledTimes(2)
    expect(audio.play.mock.calls.map(([request]) => request.sourceUrl)).toEqual([
      'blob:yomu-audio-1',
      'blob:yomu-audio-2',
    ])
  })

  it('does not retain synthesized audio when article caching is not allowed', async () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })

    await engine.playSentence(createRequest(sentences[0]!, { cacheAllowed: false }).request)
    await engine.playSentence(createRequest(sentences[0]!, { cacheAllowed: false }).request)

    expect(remote.request).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yomu-audio-1')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yomu-audio-2')
  })

  it('keeps Web Speech provider-neutral and never sends its prefetch window remotely', async () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: () => defaultTtsSettings,
    })
    const active = createRequest(sentences[0]!, { language: 'en-GB', playbackRate: 1.15 })

    await engine.prefetchSentences([sentences[1]!, sentences[2]!])
    const handle = await engine.playSentence(active.request)

    expect(engine.activeProvider()).toBe('webspeech')
    expect(engine.isAvailable()).toBe(true)
    expect(remote.request).not.toHaveBeenCalled()
    expect(audio.play).not.toHaveBeenCalled()
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith({
      text: sentences[0]!.original,
      language: 'en-GB',
      rate: 1.15,
      signal: active.controller.signal,
      onStart: active.callbacks.onStart,
      onEnd: active.callbacks.onEnd,
      onError: active.callbacks.onError,
    })

    handle.cancel()
    expect(speech.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects MiMo playback and prefetch before consent without touching remote services', async () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })
    const denied = createRequest(sentences[0]!, { cloudConsentGranted: false })

    await expect(engine.playSentence(denied.request))
      .rejects.toThrow('Cloud speech consent is required')
    await expect(engine.prefetchSentences([sentences[1]!, sentences[2]!], false))
      .rejects.toThrow('Cloud speech consent is required')

    expect(remote.request).not.toHaveBeenCalled()
    expect(audio.play).not.toHaveBeenCalled()
    expect(speech.speak).not.toHaveBeenCalled()
  })

  it('attempts every playback cleanup even when individual platform adapters throw', () => {
    const remote = createImmediateRemote()
    const speech = createSpeechHarness()
    const audio = createAudioHarness()
    audio.stop.mockImplementation(() => {
      throw new Error('Audio cleanup failed.')
    })
    speech.stop.mockImplementation(() => {
      throw new Error('Speech cleanup failed.')
    })
    const engine = createReadingSpeechEngine({
      speech: speech.adapter,
      audio: audio.adapter,
      cloudSpeech: new WebCloudSpeechAdapter(remote.adapter),
      getSettings: createMimoSettings,
    })

    expect(() => engine.stop()).not.toThrow()
    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(speech.stop).toHaveBeenCalledTimes(1)
  })
})

function createMimoSettings(): TtsSettings {
  return {
    ...defaultTtsSettings,
    provider: 'mimo',
    mimo: {
      ...defaultTtsSettings.mimo,
      apiKey: 'user-key',
    },
  }
}

function createRequest(
  sentence: ReadingSpeechSentence,
  overrides: Partial<Pick<
    ReadingSpeechRequest,
    'cacheAllowed' | 'cloudConsentGranted' | 'language' | 'playbackRate'
  >> = {},
) {
  const controller = new AbortController()
  const callbacks = {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
  }
  const request: ReadingSpeechRequest = {
    ...sentence,
    cacheAllowed: overrides.cacheAllowed ?? true,
    cloudConsentGranted: overrides.cloudConsentGranted ?? true,
    language: overrides.language ?? 'en-US',
    playbackRate: overrides.playbackRate ?? 1,
    signal: controller.signal,
    ...callbacks,
  }
  return { callbacks, controller, request }
}

function createTtsResponse(): TtsEndpointResponse {
  return {
    audioBase64: btoa('mp3-bytes'),
    mimeType: 'audio/mpeg',
    durationMs: 1_200,
  }
}

function createSpeechHarness() {
  const cancel = vi.fn()
  const speak = vi.fn(async (request: SpeechRequest) => {
    request.onStart?.()
    return {
      pause: vi.fn(),
      resume: vi.fn(),
      cancel,
    }
  })
  const stop = vi.fn()
  const adapter: SpeechAdapter = {
    isAvailable: vi.fn(() => true),
    listVoices: vi.fn(async () => []),
    speak,
    stop,
  }
  return { adapter, cancel, speak, stop }
}

function createAudioHarness() {
  const cancel = vi.fn()
  const play = vi.fn(async (request: AudioPlaybackRequest) => {
    request.onStart?.()
    return {
      pause: vi.fn(),
      resume: vi.fn(),
      cancel,
    }
  })
  const stop = vi.fn()
  const isAvailable = vi.fn(() => true)
  const adapter: AudioPlaybackAdapter = { isAvailable, play, stop }
  return { adapter, cancel, isAvailable, play, stop }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function createDeferredRemote() {
  const pending: Array<{
    request: RemoteServiceRequest
    operation: Deferred<unknown>
  }> = []
  const recorded = createRemoteRecorder((request) => {
    const operation = createDeferred<unknown>()
    pending.push({ request, operation })
    return operation.promise
  })
  return { ...recorded, pending }
}

function createImmediateRemote() {
  return createRemoteRecorder(() => createTtsResponse())
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
