import type { TtsSynthesisRequest } from './types'

export function createTtsCacheKey(request: Pick<TtsSynthesisRequest, 'provider' | 'model' | 'voice' | 'style' | 'format' | 'textHash'>): string {
  const styleHash = request.style ? hashShort(request.style) : 'no-style'
  return [
    'tts',
    request.provider,
    request.model,
    request.voice,
    request.format,
    styleHash,
    request.textHash,
  ].map(encodeURIComponent).join(':')
}

function hashShort(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16)
}
