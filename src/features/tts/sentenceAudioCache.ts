import type { SentenceAudioCache, TtsSynthesisResult } from './types'

type CacheEntry = Omit<TtsSynthesisResult, 'source'>

export function createMemorySentenceAudioCache(
  maxEntries = Number.POSITIVE_INFINITY,
): SentenceAudioCache {
  if (!(maxEntries > 0)) {
    throw new RangeError('Sentence audio cache size must be greater than zero.')
  }
  const entries = new Map<string, CacheEntry>()

  return {
    async get(cacheKey) {
      const entry = entries.get(cacheKey)
      if (!entry) {
        return null
      }
      entries.delete(cacheKey)
      entries.set(cacheKey, entry)
      return entry
    },
    async put(cacheKey, result) {
      const previous = entries.get(cacheKey)
      entries.delete(cacheKey)
      entries.set(cacheKey, result)
      if (previous?.audioUrl !== result.audioUrl) {
        revokeCachedObjectUrl(previous?.audioUrl)
      }
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value
        if (typeof oldestKey !== 'string') {
          break
        }
        const oldestEntry = entries.get(oldestKey)
        entries.delete(oldestKey)
        revokeCachedObjectUrl(oldestEntry?.audioUrl)
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
