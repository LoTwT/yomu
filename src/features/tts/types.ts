export type TtsProviderId = 'webspeech' | 'mimo'
export type TtsAudioFormat = 'mp3' | 'wav'
export type TtsCacheSource = 'cache' | 'network'

export interface TtsSynthesisRequest {
  provider: TtsProviderId
  model: string
  voice: string
  style?: string
  format: TtsAudioFormat
  sentenceId: string
  text: string
  textHash: string
  language: 'en'
}

export interface TtsSynthesisResult {
  provider: TtsProviderId
  model: string
  voice: string
  format: TtsAudioFormat
  sentenceId: string
  textHash: string
  cacheKey: string
  audioUrl: string
  mimeType: string
  durationMs: number
  source: TtsCacheSource
}

export interface SentenceTtsProvider {
  synthesizeSentence: (request: TtsSynthesisRequest) => Promise<TtsSynthesisResult>
  cancelPending: () => void
  invalidateSentence: (request: TtsSynthesisRequest) => Promise<void>
  clearCache: () => Promise<void>
}

export interface SentenceAudioCache {
  get: (cacheKey: string) => Promise<Omit<TtsSynthesisResult, 'source'> | null>
  put: (cacheKey: string, result: Omit<TtsSynthesisResult, 'source'>) => Promise<void>
  delete: (cacheKey: string) => Promise<void>
  clear: () => Promise<void>
}

export interface TtsEndpointResponse {
  audioBase64: string
  mimeType: string
  durationMs?: number
  providerRequestId?: string
}
