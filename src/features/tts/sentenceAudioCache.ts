import type { SentenceAudioCache, TtsSynthesisResult } from './types'

type CacheEntry = Omit<TtsSynthesisResult, 'source'>

export function createMemorySentenceAudioCache(): SentenceAudioCache {
  const entries = new Map<string, CacheEntry>()

  return {
    async get(cacheKey) {
      return entries.get(cacheKey) ?? null
    },
    async put(cacheKey, result) {
      entries.set(cacheKey, result)
    },
  }
}

export function createNullSentenceAudioCache(): SentenceAudioCache {
  return {
    async get() {
      return null
    },
    async put() {},
  }
}
