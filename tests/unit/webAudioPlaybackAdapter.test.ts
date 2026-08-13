import { describe, expect, it, vi } from 'vitest'

import { WebAudioPlaybackAdapter } from '@/platform/web/runtimeAdapters'
import type { AudioPlaybackRequest } from '@/platform/contracts'

describe('WebAudioPlaybackAdapter', () => {
  it('preserves the abort reason and ignores a late play resolution', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const controller = new AbortController()
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(controller, callbacks))
    const audio = runtime.instances[0]!
    const abortReason = new Error('Reader changed article.')
    abortReason.name = 'AbortError'
    const rejectedPlayback = expect(playback).rejects.toBe(abortReason)

    controller.abort(abortReason)
    await rejectedPlayback

    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()

    audio.playOperations[0]!.resolve(undefined)
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('error'))
    await Promise.resolve()

    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('stops a pending start synchronously and cannot be revived by late media events', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!
    const rejectedPlayback = expect(playback).rejects.toMatchObject({ name: 'AbortError' })

    adapter.stop()
    await rejectedPlayback
    adapter.stop()

    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledTimes(1)
    expect(audio.load).toHaveBeenCalledTimes(1)

    audio.playOperations[0]!.resolve(undefined)
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('error'))
    await Promise.resolve()

    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('rejects and releases media when ended fires before the initial play settles', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!
    const rejectedPlayback = expect(playback).rejects
      .toThrow('Audio playback ended before it started.')

    audio.dispatchEvent(new Event('ended'))
    await rejectedPlayback

    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()

    audio.playOperations[0]!.resolve(undefined)
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('error'))
    await Promise.resolve()

    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('settles playback and natural end even when lifecycle callbacks throw', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = {
      onStart: vi.fn(() => {
        throw new Error('Consumer start callback failed.')
      }),
      onEnd: vi.fn(() => {
        throw new Error('Consumer end callback failed.')
      }),
      onError: vi.fn(),
    }
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!

    audio.playOperations[0]!.resolve(undefined)
    const handle = await playback

    expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(audio.pause).not.toHaveBeenCalled()

    audio.dispatchEvent(new Event('ended'))

    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
    expect(audio.load).toHaveBeenCalledTimes(1)

    handle.cancel()
    adapter.stop()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('delivers start and natural end at most once across stale error, abort, and stop signals', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const controller = new AbortController()
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(controller, callbacks, 1.25))
    const audio = runtime.instances[0]!

    expect(audio.src).toBe('blob:sentence-audio')
    expect(audio.preload).toBe('auto')
    expect(audio.playbackRate).toBe(1.25)
    audio.playOperations[0]!.resolve(undefined)
    const handle = await playback

    expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('error'))
    controller.abort()
    adapter.stop()
    handle.cancel()

    expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('reports a rejected initial play once and releases the media element', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!
    const startError = new Error('Autoplay was rejected.')
    const rejectedPlayback = expect(playback).rejects.toBe(startError)

    audio.playOperations[0]!.reject(startError)
    await rejectedPlayback

    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(startError)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledExactlyOnceWith('src')
    expect(audio.load).toHaveBeenCalledTimes(1)

    audio.dispatchEvent(new Event('error'))
    audio.dispatchEvent(new Event('ended'))
    adapter.stop()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })

  it('reports only the first failure when an error event races a late play rejection', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!
    const rejectedPlayback = expect(playback).rejects.toThrow('Audio playback failed.')

    audio.dispatchEvent(new Event('error'))
    await rejectedPlayback
    audio.playOperations[0]!.reject(new Error('Late browser play rejection.'))
    await Promise.resolve()

    audio.dispatchEvent(new Event('error'))
    audio.dispatchEvent(new Event('ended'))
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError.mock.calls[0]?.[0]).toMatchObject({
      message: 'Audio playback failed.',
    })
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.removeAttribute).toHaveBeenCalledTimes(1)
    expect(audio.load).toHaveBeenCalledTimes(1)
  })

  it('turns a resume rejection into one terminal error and blocks later callbacks', async () => {
    const runtime = createControlledAudioRuntime()
    const adapter = new WebAudioPlaybackAdapter({ Audio: runtime.Audio })
    const callbacks = createCallbacks()
    const playback = adapter.play(createRequest(new AbortController(), callbacks))
    const audio = runtime.instances[0]!
    audio.playOperations[0]!.resolve(undefined)
    const handle = await playback

    handle.resume()
    const resumeError = new Error('Resume was rejected.')
    audio.playOperations[1]!.reject(resumeError)
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalledTimes(1))

    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(resumeError)
    audio.dispatchEvent(new Event('ended'))
    audio.dispatchEvent(new Event('error'))
    handle.cancel()
    adapter.stop()
    expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })
})

function createRequest(
  controller: AbortController,
  callbacks: ReturnType<typeof createCallbacks>,
  playbackRate = 1,
): AudioPlaybackRequest {
  return {
    sourceUrl: 'blob:sentence-audio',
    playbackRate,
    signal: controller.signal,
    ...callbacks,
  }
}

function createCallbacks() {
  return {
    onStart: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

interface ControlledAudio extends EventTarget {
  src: string
  preload: string
  playbackRate: number
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  removeAttribute: ReturnType<typeof vi.fn>
  playOperations: Array<Deferred<void>>
}

function createControlledAudioRuntime(): {
  Audio: typeof Audio
  instances: ControlledAudio[]
} {
  const instances: ControlledAudio[] = []
  class TestAudio extends EventTarget implements ControlledAudio {
    src: string
    preload = ''
    playbackRate = 1
    playOperations: Array<Deferred<void>> = []
    pause = vi.fn()
    load = vi.fn()
    removeAttribute = vi.fn((name: string) => {
      if (name === 'src') {
        this.src = ''
      }
    })
    play = vi.fn(() => {
      const operation = createDeferred<void>()
      this.playOperations.push(operation)
      return operation.promise
    })

    constructor(sourceUrl = '') {
      super()
      this.src = sourceUrl
      instances.push(this)
    }
  }
  return {
    Audio: TestAudio as unknown as typeof Audio,
    instances,
  }
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
