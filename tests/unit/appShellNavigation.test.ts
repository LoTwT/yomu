/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { themeControllerKey } from '@/app/themePreference'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { DataStoreName, RepositoryMode, RepositoryScope } from '@/data/repositories'
import type { PlatformKind } from '@/platform/contracts'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import type { ThemeController, ThemePreference, ThemeSnapshot } from '@/platform/themeController'

const mountedApps: Array<ReturnType<typeof createApp>> = []

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

async function mountAt(
  path: string,
  seed: { articles?: ArticleRecord[], attempts?: ReadingAttempt[] } = {},
  kind: PlatformKind = 'web',
) {
  const host = document.createElement('div')
  document.body.append(host)

  const router = createYomuRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const repositories = createMemoryLocalRepositories(seed)
  const harness = createFakePlatformServices({ kind, repositories })
  const app = createApp(App)
  mountedApps.push(app)
  app.provide(platformServicesKey, harness.services)
  app.provide(themeControllerKey, createTestThemeController())
  app.use(router)
  app.mount(host)
  await settleView()

  return { host, router, repositories, harness }
}

function createTestThemeController(): ThemeController {
  let snapshot: ThemeSnapshot = { preference: 'system', resolvedTheme: 'light' }
  const listeners = new Set<(value: ThemeSnapshot) => void>()

  return {
    getSnapshot: () => ({ ...snapshot }),
    async setPreference(preference: ThemePreference) {
      snapshot = {
        preference,
        resolvedTheme: preference === 'dark' ? 'dark' : 'light',
      }
      listeners.forEach(listener => listener(snapshot))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      listeners.clear()
    },
  }
}

async function settleView(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('responsive app shell', () => {
  it('exposes one primary navigation and routes every shell destination', async () => {
    const { host, router } = await mountAt('/')

    expect(host.querySelectorAll('nav[aria-label="一级导航"]')).toHaveLength(1)
    expect(
      [...host.querySelectorAll<HTMLAnchorElement>('.shell-actions__link')]
        .map(link => link.getAttribute('href')),
    ).toEqual(['/import', '/settings'])
    expect(host.textContent).toContain('我的阅读')
    expect(host.textContent).toContain('收藏词')
    expect(host.textContent).toContain('导入内容')
    expect(host.textContent).toContain('设置')

    await router.push('/words')
    await nextTick()
    expect(host.querySelector('h1')?.textContent).toContain('收藏词')
    expect(document.activeElement).toBe(host.querySelector('h1'))

    await router.push('/import')
    await nextTick()
    expect(host.querySelector('h1')?.textContent).toContain('导入内容')

    await router.push('/settings')
    await nextTick()
    expect(host.querySelector('h1')?.textContent).toContain('设置')
  })

  it('renders repository articles once and links them to the canonical reader', async () => {
    const article = createArticle()
    const attempt = createAttempt(article)
    const { host } = await mountAt('/', {
      articles: [article],
      attempts: [attempt],
    })
    const articleObjects = [...host.querySelectorAll<HTMLElement>('[data-article-id]')]

    expect(articleObjects).toHaveLength(1)
    expect(articleObjects[0]?.dataset.articleId).toBe(article.id)
    expect(host.querySelectorAll('[data-testid="article-collection"]')).toHaveLength(1)
    expect(host.querySelector('.article-object__link')?.getAttribute('href'))
      .toBe(`/read/${article.id}`)
    expect(host.querySelector('.continue-card__button')?.getAttribute('href'))
      .toBe(`/read/${article.id}`)
    expect(host.textContent).toContain('未评估')
    expect(host.textContent).toContain('第 2 / 3 句')
    const sampleAction = host.querySelector<HTMLButtonElement>('.recommendation-card__action')
    expect(sampleAction?.textContent).toContain('加入并阅读')
    expect(sampleAction?.hasAttribute('disabled')).toBe(false)
    expect(host.querySelector('a[href="/legacy"], a[href="/today"]')).toBeNull()
  })

  it('shows an honest empty library while retaining the direct legacy compatibility route', async () => {
    const { host, router } = await mountAt('/')
    expect(host.querySelector('[data-testid="library-empty-state"]')).not.toBeNull()
    expect(host.textContent).toContain('导入一段英文即可开始')
    expect(host.querySelector<HTMLButtonElement>('.library-empty__secondary')?.textContent)
      .toContain('加入并阅读')
    expect(host.querySelector('a[href="/legacy"], a[href="/today"]')).toBeNull()

    await router.push('/legacy')
    expect(router.currentRoute.value.name).toBe('legacy')

    const missing = await mountAt('/read/not-integrated')
    expect(missing.router.currentRoute.value.name).toBe('reader')
    expect(missing.router.currentRoute.value.fullPath).toBe('/read/not-integrated')
    expect(missing.host.querySelector('.shell-header')).toBeNull()
    expect(missing.host.textContent).toContain('找不到这篇文章')
    expect(missing.host.textContent).toContain('不会用 Today 或其他正文替代它')
  })

  it.each([
    { kind: 'desktop', source: 'desktop' },
    { kind: 'mobile', source: 'android' },
  ] as const)(
    'opens the shared Reader and flushes it before $kind system back',
    async ({ kind, source }) => {
      const article = createArticle()
      const attempt: ReadingAttempt = {
        ...createAttempt(article),
        currentSentenceId: article.sentences[0]?.id,
        furthestSentenceOrdinal: 0,
      }
      const { harness, host, repositories, router } = await mountAt('/', {
        articles: [article],
        attempts: [attempt],
      }, kind)

      await router.push(`/read/${article.id}`)
      await vi.waitFor(() => expect(
        host.querySelector(`[data-sentence-id="${article.sentences[0]?.id}"]`),
      ).not.toBeNull())

      expect(host.querySelector('.shell-header')).toBeNull()
      expect(host.textContent).toContain(article.title)
      const settingsButton = host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')
      expect(settingsButton).not.toBeNull()
      settingsButton?.focus()
      settingsButton?.click()
      await nextTick()
      expect(host.querySelector('#reader-settings[open]')).not.toBeNull()

      const updateImmediately = vi.spyOn(harness.preferences, 'updateImmediately')
      harness.backNavigation.emit(source)
      await settleView()

      expect(router.currentRoute.value.name).toBe('reader')
      expect(host.querySelector('#reader-settings')).toBeNull()
      expect(document.activeElement).toBe(settingsButton)
      expect(updateImmediately).not.toHaveBeenCalled()

      const finalSentence = host.querySelector<HTMLButtonElement>(
        `[data-sentence-id="${article.sentences[2]?.id}"]`,
      )
      finalSentence?.click()
      await nextTick()
      expect(finalSentence?.getAttribute('aria-current')).toBe('true')

      const originalTransaction = repositories.transaction.bind(repositories)
      let releaseFlush!: () => void
      let reportFlushStarted!: () => void
      const flushGate = new Promise<void>((resolve) => {
        releaseFlush = resolve
      })
      const flushStarted = new Promise<void>((resolve) => {
        reportFlushStarted = resolve
      })
      let gateNextAttemptWrite = true
      repositories.transaction = async <T>(
        stores: readonly DataStoreName[],
        mode: RepositoryMode,
        operation: (scope: RepositoryScope) => Promise<T>,
      ): Promise<T> => {
        if (gateNextAttemptWrite && mode === 'readwrite' && stores.includes('attempts')) {
          gateNextAttemptWrite = false
          reportFlushStarted()
          await flushGate
        }
        return originalTransaction(stores, mode, operation)
      }

      harness.backNavigation.emit(source)
      await flushStarted
      await settleView()
      expect(router.currentRoute.value.name).toBe('reader')
      expect(host.querySelector('.reader-view')).not.toBeNull()

      releaseFlush()
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('library'))

      expect((await repositories.attempts.get(attempt.id))?.currentSentenceId)
        .toBe(article.sentences[2]?.id)
    },
  )

  it('does not navigate twice when the browser adapter observes popstate', async () => {
    const { harness, router } = await mountAt('/')
    await router.push('/settings')
    await router.push('/words')

    harness.backNavigation.emit('browser')
    await settleView()

    expect(router.currentRoute.value.path).toBe('/words')
  })
})

function createArticle(): ArticleRecord {
  return {
    id: 'article-repository',
    schemaVersion: 2,
    contentHash: 'repository-article-hash',
    title: 'A real repository article',
    description: 'This article is loaded from the local repository.',
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: '粘贴文本' },
    rights: {
      status: 'user-provided-unknown',
      note: 'User-provided content.',
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    capabilities: {
      sentenceTranslation: 'none',
      sentenceIpa: 'none',
      tokenMeaning: 'none',
    },
    sentences: [0, 1, 2].map(index => ({
      id: `article-repository:s${index + 1}`,
      order: index,
      paragraphIndex: 0,
      textHash: `sentence-hash-${index}`,
      original: `This is repository sentence ${index + 1}.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
  }
}

function createAttempt(article: ArticleRecord): ReadingAttempt {
  return {
    id: 'attempt-repository',
    articleId: article.id,
    currentSentenceId: article.sentences[1]?.id,
    furthestSentenceOrdinal: 1,
    activeDurationSec: 30,
    status: 'active',
    startedAt: '2026-08-04T08:00:00.000Z',
    lastOpenedAt: '2026-08-04T08:05:00.000Z',
  }
}
