export const YOMU_ENTITY_SCHEMA_VERSION = 2 as const

export type CapabilityCoverage = 'none' | 'partial' | 'complete'

export interface ArticleTokenRecord {
  id: string
  text: string
  kind: 'word' | 'punctuation'
  ipa?: string
  meaning?: string
}

export interface ArticleSentenceRecord {
  id: string
  order: number
  paragraphIndex: number
  textHash: string
  original: string
  translation?: string
  sentenceIpa?: string
  tokens: ArticleTokenRecord[]
}

export interface ArticleRecord {
  id: string
  schemaVersion: typeof YOMU_ENTITY_SCHEMA_VERSION
  contentHash: string
  title: string
  description?: string
  language: 'en'
  level: 'B1' | 'B2' | 'unassessed'
  source: {
    kind: 'paste' | 'file' | 'url' | 'today' | 'public-domain'
    label: string
    url?: string
    itemId?: string
    itemVersion?: string
    author?: string
    publicationYear?: string
  }
  rights: {
    status: 'user-provided-unknown' | 'public-domain' | 'app-provided'
    note: string
    ttsAllowed: boolean
    translationAllowed: boolean
    cacheAllowed: boolean
  }
  capabilities: {
    sentenceTranslation: CapabilityCoverage
    sentenceIpa: CapabilityCoverage
    tokenMeaning: CapabilityCoverage
  }
  sentences: ArticleSentenceRecord[]
  factSources: Array<{ title: string, url: string }>
  wordCount: number
  estimatedReadTimeMinutes: number
  createdAt: string
  updatedAt: string
}

export interface ReadingAttempt {
  id: string
  articleId: string
  currentSentenceId?: string
  furthestSentenceOrdinal: number
  activeDurationSec: number
  status: 'active' | 'completed'
  startedAt: string
  lastOpenedAt: string
  completedAt?: string
}

export interface VocabularyTerm {
  id: string
  normalizedTerm: string
  displayTerm: string
  meaning?: string
  orphanedContextCount: number
  savedAt: string
  updatedAt: string
}

export interface VocabularyContext {
  id: string
  termId: string
  articleId: string
  sentenceId: string
  sentenceText: string
  displayTerm: string
  savedAt: string
}

export interface YomuExportV1 {
  format: 'yomu-export'
  formatVersion: 1
  exportedAt: string
  articles: ArticleRecord[]
  attempts: ReadingAttempt[]
  vocabularyTerms: VocabularyTerm[]
  vocabularyContexts: VocabularyContext[]
  preferences: {
    theme: 'system' | 'light' | 'dark'
    readerFontScale: number
    defaultExpandTranslation: boolean
    speechProvider: 'web-speech' | 'mimo'
    speechRate: number
    voiceId?: string
    model?: string
  }
}

export type YomuExportPreferences = YomuExportV1['preferences']

export const defaultExportPreferences: YomuExportPreferences = {
  theme: 'system',
  readerFontScale: 1,
  defaultExpandTranslation: false,
  speechProvider: 'web-speech',
  speechRate: 1,
}

export function isArticleRecord(value: unknown): value is ArticleRecord {
  if (!isRecord(value) || value.schemaVersion !== YOMU_ENTITY_SCHEMA_VERSION) {
    return false
  }

  return isNonEmptyString(value.id)
    && isNonEmptyString(value.contentHash)
    && isNonEmptyString(value.title)
    && value.language === 'en'
    && (value.level === 'B1' || value.level === 'B2' || value.level === 'unassessed')
    && isArticleSource(value.source)
    && isArticleRights(value.rights)
    && isArticleCapabilities(value.capabilities)
    && Array.isArray(value.sentences)
    && value.sentences.length > 0
    && value.sentences.every(isArticleSentenceRecord)
    && Array.isArray(value.factSources)
    && value.factSources.every(isFactSource)
    && isNonNegativeFiniteNumber(value.wordCount)
    && isNonNegativeFiniteNumber(value.estimatedReadTimeMinutes)
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
}

export function isReadingAttempt(value: unknown): value is ReadingAttempt {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && isNonEmptyString(value.articleId)
    && (value.currentSentenceId === undefined || isNonEmptyString(value.currentSentenceId))
    && isNonNegativeFiniteNumber(value.furthestSentenceOrdinal)
    && isNonNegativeFiniteNumber(value.activeDurationSec)
    && (value.status === 'active' || value.status === 'completed')
    && isIsoDate(value.startedAt)
    && isIsoDate(value.lastOpenedAt)
    && (value.completedAt === undefined || isIsoDate(value.completedAt))
    && (value.status !== 'completed' || isIsoDate(value.completedAt))
}

export function isVocabularyTerm(value: unknown): value is VocabularyTerm {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && isNonEmptyString(value.normalizedTerm)
    && isNonEmptyString(value.displayTerm)
    && (value.meaning === undefined || typeof value.meaning === 'string')
    && isNonNegativeFiniteNumber(value.orphanedContextCount)
    && isIsoDate(value.savedAt)
    && isIsoDate(value.updatedAt)
}

export function isVocabularyContext(value: unknown): value is VocabularyContext {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && isNonEmptyString(value.termId)
    && isNonEmptyString(value.articleId)
    && isNonEmptyString(value.sentenceId)
    && typeof value.sentenceText === 'string'
    && isNonEmptyString(value.displayTerm)
    && isIsoDate(value.savedAt)
}

function isArticleSentenceRecord(value: unknown): value is ArticleSentenceRecord {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && isNonNegativeFiniteNumber(value.order)
    && isNonNegativeFiniteNumber(value.paragraphIndex)
    && isNonEmptyString(value.textHash)
    && isNonEmptyString(value.original)
    && (value.translation === undefined || typeof value.translation === 'string')
    && (value.sentenceIpa === undefined || typeof value.sentenceIpa === 'string')
    && Array.isArray(value.tokens)
    && value.tokens.every(isArticleTokenRecord)
}

function isArticleTokenRecord(value: unknown): value is ArticleTokenRecord {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && typeof value.text === 'string'
    && (value.kind === 'word' || value.kind === 'punctuation')
    && (value.ipa === undefined || typeof value.ipa === 'string')
    && (value.meaning === undefined || typeof value.meaning === 'string')
}

function isArticleSource(value: unknown): value is ArticleRecord['source'] {
  if (!isRecord(value)) {
    return false
  }

  return (value.kind === 'paste'
    || value.kind === 'file'
    || value.kind === 'url'
    || value.kind === 'today'
    || value.kind === 'public-domain')
    && isNonEmptyString(value.label)
    && optionalString(value.url)
    && optionalString(value.itemId)
    && optionalString(value.itemVersion)
    && optionalString(value.author)
    && optionalString(value.publicationYear)
}

function isArticleRights(value: unknown): value is ArticleRecord['rights'] {
  if (!isRecord(value)) {
    return false
  }

  return (value.status === 'user-provided-unknown'
    || value.status === 'public-domain'
    || value.status === 'app-provided')
    && typeof value.note === 'string'
    && typeof value.ttsAllowed === 'boolean'
    && typeof value.translationAllowed === 'boolean'
    && typeof value.cacheAllowed === 'boolean'
}

function isArticleCapabilities(value: unknown): value is ArticleRecord['capabilities'] {
  if (!isRecord(value)) {
    return false
  }

  return isCapabilityCoverage(value.sentenceTranslation)
    && isCapabilityCoverage(value.sentenceIpa)
    && isCapabilityCoverage(value.tokenMeaning)
}

function isCapabilityCoverage(value: unknown): value is CapabilityCoverage {
  return value === 'none' || value === 'partial' || value === 'complete'
}

function isFactSource(value: unknown): value is ArticleRecord['factSources'][number] {
  return isRecord(value) && isNonEmptyString(value.title) && isNonEmptyString(value.url)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !Number.isNaN(Date.parse(value))
}
