import type { SentenceAudioCache, TtsSynthesisResult } from './types'

type CacheEntry = Omit<TtsSynthesisResult, 'source'>

export function createMemorySentenceAudioCache(): SentenceAudioCache {
  const entries = new Map<string, CacheEntry>()

  return {
    async get(cacheKey) {
      return entries.get(cacheKey) ?? null
    },
    async put(cacheKey, result) {
      const previous = entries.get(cacheKey)
      entries.set(cacheKey, result)
      if (previous?.audioUrl !== result.audioUrl) {
        revokeCachedObjectUrl(previous?.audioUrl)
      }
    },
    async delete(cacheKey) {
      const entry = entries.get(cacheKey)
      if (entries.delete(cacheKey)) {
        revokeCachedObjectUrl(entry?.audioUrl)
      }
    },
    async clear() {
      const audioUrls = new Set([...entries.values()].map(entry => entry.audioUrl))
      entries.clear()
      audioUrls.forEach(revokeCachedObjectUrl)
    },
  }
}

export function createNullSentenceAudioCache(): SentenceAudioCache {
  return {
    async get() {
      return null
    },
    async put() {},
    async delete() {},
    async clear() {},
  }
}

function revokeCachedObjectUrl(audioUrl: string | undefined): void {
  if (!audioUrl?.startsWith('blob:') || typeof globalThis.URL.revokeObjectURL !== 'function') {
    return
  }
  globalThis.URL.revokeObjectURL(audioUrl)
}
