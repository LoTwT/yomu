export type LanguageCode = 'en'

export type ArticleTopic = 'knowledge' | 'story'

export type PublicDomainDifficultyKey = 'beginner' | 'intermediate' | 'advanced'

export interface PublicDomainDifficultyMetadata {
  key: PublicDomainDifficultyKey
  label: string
  basis: string
}

export interface ArticleRights {
  sourceType: 'ai-generated' | 'public-domain' | 'user-import'
  rightsStatus: 'owned' | 'public-domain'
  licenseNote: string
  ttsAllowed: boolean
  translationAllowed: boolean
  cacheAllowed: boolean
}

export interface ImportedArticleMetadata {
  articleId: string
  textHash: string
  importedAt: string
  sourceType: 'paste' | 'file' | 'url'
  sourceRef: {
    kind: 'paste' | 'file' | 'url'
    label: string
    url?: string
    fileName?: string
  }
  title: string
}

export interface PublicDomainArticleMetadata {
  id: string
  title: string
  author: string
  publicationYear: string
  language: LanguageCode
  sourceUrl: string
  sourceName: string
  retrievedAt: string
  publicDomainBasis: string
  regionPosture: string
  rightsStatus: 'public-domain-us' | 'unknown' | 'restricted'
  allowedUses: {
    tts: boolean
    cache: boolean
    translation: boolean
  }
  difficulty: PublicDomainDifficultyMetadata
  excerptRange: string
  noRewrite: true
  sourceLabel: string
  providerCachePolicy: string
}

export interface ArticleToken {
  id: string
  text: string
  ipa?: string
  kind?: 'word' | 'punctuation'
  meaning?: string
}

export interface ArticleSentence {
  id: string
  order?: number
  original: string
  paragraphIndex?: number
  textHash?: string
  annotations?: {
    ipa?: string
    furigana?: Array<{
      tokenId: string
      text: string
      reading: string
    }>
  }
  bilingual?: {
    zh?: string
  }
  audio?: {
    cacheKey: string
    status: 'idle' | 'loading' | 'ready' | 'failed'
  }
  translation: string
  tokens: ArticleToken[]
  audioRef: {
    id: string
    url: string
    durationMs: number
  }
  vocab?: Array<{
    term: string
    meaning: string
  }>
}

export interface DailyArticle {
  id: string
  contentVersion: string
  language: LanguageCode
  level: 'B1' | 'B2'
  topic: ArticleTopic
  title: string
  deck: string
  estimatedReadTimeMinutes: number
  factSources: Array<{
    title: string
    url: string
  }>
  rights: ArticleRights
  model: {
    provider: string
    name: string
    version: string
    promptHash: string
  }
  qaStatus: 'draft' | 'approved'
  importMetadata?: ImportedArticleMetadata
  publicDomainMetadata?: PublicDomainArticleMetadata
  sentences: ArticleSentence[]
}
