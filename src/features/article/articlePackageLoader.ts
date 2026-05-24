import type { DailyArticle } from './types'

export const TODAY_ARTICLE_PACKAGE_URL = '/articles/today.json'

const CACHED_ARTICLE_PACKAGE_KEY = 'yomu:cached-article-package'

export type ArticlePackageLoadResult =
  | { status: 'loading' }
  | { status: 'ready', article: DailyArticle, source: 'network' | 'cache' }
  | { status: 'not-ready', cachedArticle: DailyArticle | null }
  | { status: 'offline', cachedArticle: DailyArticle | null }
  | { status: 'error', message: string, cachedArticle: DailyArticle | null }

interface LoadTodayArticlePackageOptions {
  fetchImpl?: typeof fetch
  online?: boolean
  packageUrl?: string
  storage?: Storage
}

export async function loadTodayArticlePackage(
  options: LoadTodayArticlePackageOptions = {},
): Promise<ArticlePackageLoadResult> {
  const fetchImpl = options.fetchImpl ?? window.fetch.bind(window)
  const online = options.online ?? navigator.onLine
  const packageUrl = options.packageUrl ?? TODAY_ARTICLE_PACKAGE_URL
  const storage = options.storage ?? window.localStorage
  const cachedArticle = loadCachedArticlePackage(storage)

  if (!online) {
    return cachedArticle
      ? { status: 'ready', article: cachedArticle, source: 'cache' }
      : { status: 'offline', cachedArticle: null }
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
    if (!isDailyArticle(payload) || payload.qaStatus !== 'approved') {
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

export function loadCachedArticlePackage(storage: Storage): DailyArticle | null {
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

export function saveCachedArticlePackage(storage: Storage, article: DailyArticle): void {
  if (!article.rights.cacheAllowed || article.qaStatus !== 'approved') {
    return
  }

  storage.setItem(CACHED_ARTICLE_PACKAGE_KEY, JSON.stringify(article))
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
    && Array.isArray(value.sentences)
    && value.sentences.length > 0
    && value.sentences.every(isArticleSentence)
}

function isRights(value: unknown): boolean {
  return isRecord(value)
    && (value.sourceType === 'ai-generated' || value.sourceType === 'public-domain')
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
    && typeof value.original === 'string'
    && typeof value.translation === 'string'
    && Array.isArray(value.tokens)
    && value.tokens.length > 0
    && value.tokens.every(isArticleToken)
    && typeof value.audioRef.id === 'string'
    && typeof value.audioRef.url === 'string'
    && typeof value.audioRef.durationMs === 'number'
}

function isArticleToken(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && (value.ipa === undefined || typeof value.ipa === 'string')
    && (value.kind === undefined || value.kind === 'word' || value.kind === 'punctuation')
    && (value.meaning === undefined || typeof value.meaning === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
