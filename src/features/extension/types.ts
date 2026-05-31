import type { ArticleToken } from '@/features/article/types'

export type ReadExpansionRank = 'above-level' | 'key' | 'frequent'

export interface ReadExpansionTerm {
  id: string
  term: string
  normalizedTerm: string
  ipa?: string
  localGloss: string
  rank: ReadExpansionRank
  occurrences: number
  sentenceIds: string[]
  context: string
  tokenIds: string[]
  source: 'article-glossary' | 'local-dictionary' | 'frequency-rule'
}

export interface AiWordExpansion {
  meaning: string
  examples: string[]
  background: string
  provider: string
  model: string
}

export type AiWordExpansionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready', expansion: AiWordExpansion }
  | { status: 'failed', message: string }

export interface AiWordExpansionRequest {
  provider: 'openai'
  apiKey: string
  baseUrl: string
  model: string
  term: ReadExpansionTerm
}

export type ExpansionToken = Pick<ArticleToken, 'id' | 'text' | 'ipa' | 'kind' | 'meaning'>
