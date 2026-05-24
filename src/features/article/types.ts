export type LanguageCode = 'en'

export type ArticleTopic = 'knowledge' | 'story'

export interface ArticleRights {
  sourceType: 'ai-generated' | 'public-domain'
  rightsStatus: 'owned' | 'public-domain'
  licenseNote: string
  ttsAllowed: boolean
  translationAllowed: boolean
  cacheAllowed: boolean
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
  original: string
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
  sentences: ArticleSentence[]
}
