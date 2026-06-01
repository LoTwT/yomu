import { describe, expect, it, vi } from 'vitest'

import {
  loadCachedArticlePackage,
  loadTodayArticlePackage,
  saveCachedArticlePackage,
} from '@/features/article/articlePackageLoader'
import { getPublicDomainFallbackArticle as getBundledPublicDomainFallbackArticle } from '@/features/article/publicDomainSample'
import { sampleArticle } from '@/features/article/sampleArticle'

describe('article package loader', () => {
  it('loads an approved article package and caches it locally', async () => {
    const storage = window.localStorage
    storage.clear()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(sampleArticle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await loadTodayArticlePackage({ fetchImpl, storage, online: true })

    expect(result.status).toBe('ready')
    expect(result.status === 'ready' ? result.source : null).toBe('network')
    expect(loadCachedArticlePackage(storage)?.id).toBe(sampleArticle.id)
  })

  it('returns not-ready with cached fallback for empty daily package responses', async () => {
    const storage = window.localStorage
    storage.clear()
    saveCachedArticlePackage(storage, sampleArticle)
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    const result = await loadTodayArticlePackage({ fetchImpl, storage, online: true })

    expect(result.status).toBe('not-ready')
    expect(result.status === 'not-ready' ? result.cachedArticle?.id : null).toBe(sampleArticle.id)
  })

  it('serves cached content offline and reports offline when no cache exists', async () => {
    const storage = window.localStorage
    storage.clear()

    expect((await loadTodayArticlePackage({ storage, online: false })).status).toBe('offline')

    saveCachedArticlePackage(storage, sampleArticle)
    const result = await loadTodayArticlePackage({ storage, online: false })

    expect(result.status).toBe('ready')
    expect(result.status === 'ready' ? result.source : null).toBe('cache')
  })

  it('keeps public-domain fallback articles ready for same-origin bundled use', () => {
    window.localStorage.clear()
    const article = getBundledPublicDomainFallbackArticle('advanced')

    expect(article.publicDomainMetadata?.difficulty.key).toBe('advanced')
    expect(article.publicDomainMetadata?.noRewrite).toBe(true)
    expect(article.publicDomainMetadata?.sourceUrl).toBe('https://www.gutenberg.org/ebooks/35')
    expect(loadCachedArticlePackage(window.localStorage)?.id).not.toBe(article.id)
  })
})
