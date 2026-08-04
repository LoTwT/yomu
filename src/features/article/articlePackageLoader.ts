import type { DailyArticle } from './types'

export const TODAY_ARTICLE_PACKAGE_URL = '/articles/today.json'

const CACHED_ARTICLE_PACKAGE_KEY = 'yomu:cached-article-package'

export type ArticlePackageLoadResult =
  | { status: 'loading' }
  | { status: 'ready', article: DailyArticle, source: 'network' | 'cache' | 'public-domain' }
  | { status: 'not-ready', cachedArticle: DailyArticle | null }
  | { status: 'offline', cachedArticle: DailyArticle | null }
  | { status: 'error', message: string, cachedArticle: DailyArticle | null }

export interface ArticlePackageStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

interface LoadTodayArticlePackageOptions {
  fetchImpl?: typeof fetch
  online?: boolean
  packageUrl?: string
  storage: ArticlePackageStorage
}

export async function loadTodayArticlePackage(
  options: LoadTodayArticlePackageOptions,
): Promise<ArticlePackageLoadResult> {
  const fetchImpl = options.fetchImpl
  const online = options.online ?? true
  const packageUrl = options.packageUrl ?? TODAY_ARTICLE_PACKAGE_URL
  const storage = options.storage
  const cachedArticle = loadCachedArticlePackage(storage)

  if (!online) {
    return cachedArticle
      ? { status: 'ready', article: cachedArticle, source: 'cache' }
      : { status: 'offline', cachedArticle: null }
  }

  if (!fetchImpl) {
    return {
      status: 'error',
      message: 'The article package loader is unavailable on this platform.',
      cachedArticle,
    }
  }

  try {
    const response = await fetchImpl(packageUrl, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })

    if (response.status === 204 || response.status === 404) {
      return { status: 'not-ready', cachedArticle }
    }

    if (!response.ok) {
      return {
        status: 'error',
        message: `The article package returned HTTP ${response.status}.`,
        cachedArticle,
      }
    }

    const payload = await response.json()
    if (!isArticlePackageReady(payload)) {
      return {
        status: 'error',
        message: 'The article package is not ready for practice yet.',
        cachedArticle,
      }
    }

    saveCachedArticlePackage(storage, payload)
    return { status: 'ready', article: payload, source: 'network' }
  }
  catch {
    return cachedArticle
      ? { status: 'ready', article: cachedArticle, source: 'cache' }
      : { status: 'offline', cachedArticle: null }
  }
}

export function loadCachedArticlePackage(storage: ArticlePackageStorage): DailyArticle | null {
  try {
    const raw = storage.getItem(CACHED_ARTICLE_PACKAGE_KEY)
    if (!raw) {
      return null
    }

    const payload: unknown = JSON.parse(raw)
    return isDailyArticle(payload) && payload.rights.cacheAllowed ? payload : null
  }
  catch {
    return null
  }
}

export function saveCachedArticlePackage(storage: ArticlePackageStorage, article: DailyArticle): void {
  if (!article.rights.cacheAllowed || article.qaStatus !== 'approved') {
    return
  }

  storage.setItem(CACHED_ARTICLE_PACKAGE_KEY, JSON.stringify(article))
}

export function isArticlePackageReady(value: unknown): value is DailyArticle {
  return isDailyArticle(value) && value.qaStatus === 'approved'
}

function isDailyArticle(value: unknown): value is DailyArticle {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && typeof value.contentVersion === 'string'
    && value.language === 'en'
    && (value.level === 'B1' || value.level === 'B2')
    && (value.topic === 'knowledge' || value.topic === 'story')
    && typeof value.title === 'string'
    && typeof value.deck === 'string'
    && typeof value.estimatedReadTimeMinutes === 'number'
    && Array.isArray(value.factSources)
    && isRights(value.rights)
    && isRecord(value.model)
    && typeof value.model.provider === 'string'
    && typeof value.model.name === 'string'
    && typeof value.model.version === 'string'
    && typeof value.model.promptHash === 'string'
    && (value.qaStatus === 'draft' || value.qaStatus === 'approved')
    && (value.importMetadata === undefined || isImportMetadata(value.importMetadata))
    && (value.publicDomainMetadata === undefined || isPublicDomainMetadata(value.publicDomainMetadata))
    && isRecord(value.rights)
    && (value.rights.sourceType !== 'public-domain' || isPublicDomainMetadata(value.publicDomainMetadata))
    && (value.rights.sourceType !== 'user-import' || isImportMetadata(value.importMetadata))
    && Array.isArray(value.sentences)
    && value.sentences.length > 0
    && value.sentences.every(isArticleSentence)
}

function isRights(value: unknown): boolean {
  return isRecord(value)
    && (value.sourceType === 'ai-generated' || value.sourceType === 'public-domain' || value.sourceType === 'user-import')
    && (value.rightsStatus === 'owned' || value.rightsStatus === 'public-domain')
    && typeof value.licenseNote === 'string'
    && typeof value.ttsAllowed === 'boolean'
    && typeof value.translationAllowed === 'boolean'
    && typeof value.cacheAllowed === 'boolean'
}

function isArticleSentence(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.audioRef)) {
    return false
  }

  return typeof value.id === 'string'
    && (value.order === undefined || typeof value.order === 'number')
    && typeof value.original === 'string'
    && (value.paragraphIndex === undefined || typeof value.paragraphIndex === 'number')
    && (value.textHash === undefined || typeof value.textHash === 'string')
    && (value.annotations === undefined || isRecord(value.annotations))
    && (value.bilingual === undefined || isRecord(value.bilingual))
    && (value.audio === undefined || isSentenceAudioState(value.audio))
    && typeof value.translation === 'string'
    && Array.isArray(value.tokens)
    && value.tokens.length > 0
    && value.tokens.every(isArticleToken)
    && typeof value.audioRef.id === 'string'
    && typeof value.audioRef.url === 'string'
    && typeof value.audioRef.durationMs === 'number'
}

function isSentenceAudioState(value: unknown): boolean {
  return isRecord(value)
    && typeof value.cacheKey === 'string'
    && (value.status === 'idle' || value.status === 'loading' || value.status === 'ready' || value.status === 'failed')
}

function isArticleToken(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && (value.ipa === undefined || typeof value.ipa === 'string')
    && (value.kind === undefined || value.kind === 'word' || value.kind === 'punctuation')
    && (value.meaning === undefined || typeof value.meaning === 'string')
}

function isImportMetadata(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.sourceRef)) {
    return false
  }

  return typeof value.articleId === 'string'
    && typeof value.textHash === 'string'
    && typeof value.importedAt === 'string'
    && (value.sourceType === 'paste' || value.sourceType === 'file' || value.sourceType === 'url')
    && typeof value.title === 'string'
    && (value.sourceRef.kind === 'paste' || value.sourceRef.kind === 'file' || value.sourceRef.kind === 'url')
    && typeof value.sourceRef.label === 'string'
    && (value.sourceRef.url === undefined || typeof value.sourceRef.url === 'string')
    && (value.sourceRef.fileName === undefined || typeof value.sourceRef.fileName === 'string')
}

function isPublicDomainMetadata(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.allowedUses)) {
    return false
  }

  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.author === 'string'
    && typeof value.publicationYear === 'string'
    && value.language === 'en'
    && typeof value.sourceUrl === 'string'
    && typeof value.sourceName === 'string'
    && typeof value.retrievedAt === 'string'
    && typeof value.publicDomainBasis === 'string'
    && typeof value.regionPosture === 'string'
    && (value.rightsStatus === 'public-domain-us' || value.rightsStatus === 'unknown' || value.rightsStatus === 'restricted')
    && typeof value.allowedUses.tts === 'boolean'
    && typeof value.allowedUses.cache === 'boolean'
    && typeof value.allowedUses.translation === 'boolean'
    && isPublicDomainDifficulty(value.difficulty)
    && typeof value.excerptRange === 'string'
    && value.noRewrite === true
    && typeof value.sourceLabel === 'string'
    && typeof value.providerCachePolicy === 'string'
}

function isPublicDomainDifficulty(value: unknown): boolean {
  return isRecord(value)
    && (value.key === 'beginner' || value.key === 'intermediate' || value.key === 'advanced')
    && typeof value.label === 'string'
    && typeof value.basis === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
