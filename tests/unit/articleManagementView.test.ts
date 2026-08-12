/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
} from '@/app/interactionLayer'
import { platformServicesKey } from '@/app/platformServices'
import type { ReadingAttempt, VocabularyContext, VocabularyTerm } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { PlatformServices, PreferencePersistence, PreferencesStore } from '@/platform/contracts'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import LibraryView from '@/views/LibraryView.vue'
import { createReviewArticle } from './readingReviewTestFixtures'

const mountedApps: Array<ReturnType<typeof createApp>> = []

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('article management view', () => {
  it('renames, opens source, and atomically deletes before focusing the next article', async () => {
    const managed = createReviewArticle('article-managed', 'Managed article')
    const remaining = {
      ...createReviewArticle('article-remaining', 'Remaining article'),
      createdAt: '2026-08-09T08:00:00.000Z',
      updatedAt: '2026-08-09T08:00:00.000Z',
    }
    const attempt = createAttempt(managed.id)
    const term = createTerm()
    const context = createContext(term.id, managed)
    const repositories = createMemoryLocalRepositories({
      articles: [managed, remaining],
      attempts: [attempt],
      vocabularyTerms: [term],
      vocabularyContexts: [context],
    })
    const mounted = await mountLibrary(repositories)

    manageButton(mounted.host, managed.id).click()
    await waitForDialog(mounted.host)
    expect(mounted.host.querySelector('.library-view__content')?.hasAttribute('inert')).toBe(true)
    expect(mounted.host.querySelector('.library-view__content')?.getAttribute('aria-hidden'))
      .toBe('true')
    findButton(mounted.host, '来源详情').click()
    await settle()
    findButton(mounted.host, '打开来源').click()
    await vi.waitFor(() => expect(mounted.platform.externalNavigation.openedUrls)
      .toEqual([managed.source.url]))
    await settle()

    findButton(mounted.host, '返回').click()
    await settle()
    findButton(mounted.host, '重命名').click()
    await settle()
    const input = mounted.host.querySelector<HTMLInputElement>('input[type="text"]')!
    input.value = '  Renamed managed article  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    mounted.host.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await vi.waitFor(() => expect(mounted.host.querySelector('dialog')).toBeNull())
    expect(mounted.host.textContent).toContain('Renamed managed article')
    expect((await repositories.articles.get(managed.id))?.title).toBe('Renamed managed article')
    expect(document.activeElement).toBe(manageButton(mounted.host, managed.id))

    manageButton(mounted.host, managed.id).click()
    await waitForDialog(mounted.host)
    findButton(mounted.host, '删除文章').click()
    await settle()
    expect(mounted.host.textContent).toContain('1 条阅读记录')
    expect(mounted.host.textContent).toContain('1 条收藏词原句上下文')
    findButton(mounted.host, '永久删除').click()

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${managed.id}"]`),
    ).toBeNull())
    expect(await repositories.articles.get(managed.id)).toBeNull()
    expect(await repositories.attempts.get(attempt.id)).toBeNull()
    expect(await repositories.vocabularyContexts.get(context.id)).toBeNull()
    expect(await repositories.vocabularyTerms.get(term.id)).toMatchObject({
      orphanedContextCount: 1,
    })
    expect(mounted.platform.legacyImportedContent.deletedArticleIds).toEqual([managed.id])
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${remaining.id}"] [data-article-open]`),
    )
  })

  it.each<{
    persistence: PreferencePersistence
    expectedMessage: string
  }>([
    {
      persistence: 'device',
      expectedMessage: '删除尚未完成。Yomu 会在下次打开或激活阅读库时自动重试。阅读进度尚未停止保存，请勿继续阅读这篇文章。',
    },
    {
      persistence: 'session',
      expectedMessage: '删除尚未完成。删除确认只保存在当前页面，关闭或刷新后不会自动恢复；请在离开前重试。阅读进度尚未停止保存，请勿继续阅读这篇文章。',
    },
  ])('does not promise retired progress when the $persistence marker write fails', async ({
    persistence,
    expectedMessage,
  }) => {
    const article = createReviewArticle(
      `article-marker-failure-${persistence}`,
      'Marker failure article',
    )
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const preferences = failRetirementMarkerWrite(platform.preferences, persistence)
    const mounted = await mountLibrary(
      repositories,
      platform,
      { ...platform.services, preferences },
    )

    manageButton(mounted.host, article.id).click()
    await waitForDialog(mounted.host)
    findButton(mounted.host, '删除文章').click()
    await settle()
    findButton(mounted.host, '永久删除').click()

    await vi.waitFor(() => expect(
      mounted.host.querySelector('dialog [role="alert"]')?.textContent?.trim(),
    ).toBe(expectedMessage))
    expect(mounted.host.textContent).not.toContain('阅读进度已停止保存')
    expect(await repositories.articles.get(article.id)).not.toBeNull()
  })

  it.each<{
    persistence: PreferencePersistence
    expectedMessage: string
  }>([
    {
      persistence: 'device',
      expectedMessage: '删除尚未完成。Yomu 会在下次打开或激活阅读库时自动重试。这篇文章的阅读进度已停止保存。',
    },
    {
      persistence: 'session',
      expectedMessage: '删除尚未完成。删除确认只保存在当前页面，关闭或刷新后不会自动恢复；请在离开前重试。停止保存状态只在当前页面有效；其他已打开的阅读页面可能仍会保存进度，请先关闭它们。',
    },
  ])('scopes retired-progress and retry promises to $persistence storage', async ({
    persistence,
    expectedMessage,
  }) => {
    const article = createReviewArticle(
      `article-delete-failure-${persistence}`,
      'Delete failure article',
    )
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    failNextArticleDeletion(repositories)
    const platform = createFakePlatformServices({ repositories })
    const preferences = withPreferencePersistence(platform.preferences, persistence)
    const mounted = await mountLibrary(
      repositories,
      platform,
      { ...platform.services, preferences },
    )

    manageButton(mounted.host, article.id).click()
    await waitForDialog(mounted.host)
    findButton(mounted.host, '删除文章').click()
    await settle()
    findButton(mounted.host, '永久删除').click()

    await vi.waitFor(() => expect(
      mounted.host.querySelector('dialog [role="alert"]')?.textContent?.trim(),
    ).toBe(expectedMessage))
    expect(await repositories.articles.get(article.id)).not.toBeNull()
  })

  it.each<{
    persistence: PreferencePersistence
    expectedMessage: string
  }>([
    {
      persistence: 'device',
      expectedMessage: '文章已删除；部分旧进度缓存将在下次打开或激活阅读库时自动继续清理。',
    },
    {
      persistence: 'session',
      expectedMessage: '文章已删除；部分旧进度缓存只会在当前页面继续清理，关闭或刷新后不会保留清理状态。',
    },
  ])('scopes pending cleanup promises to $persistence storage', async ({
    persistence,
    expectedMessage,
  }) => {
    const article = createReviewArticle(
      `article-cleanup-failure-${persistence}`,
      'Cleanup failure article',
    )
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const preferences = failIntentCleanup(platform.preferences, persistence)
    const mounted = await mountLibrary(
      repositories,
      platform,
      { ...platform.services, preferences },
    )

    manageButton(mounted.host, article.id).click()
    await waitForDialog(mounted.host)
    findButton(mounted.host, '删除文章').click()
    await settle()
    findButton(mounted.host, '永久删除').click()

    await vi.waitFor(() => expect(mounted.host.textContent).toContain(expectedMessage))
    expect(mounted.host.querySelector('dialog')).toBeNull()
    expect(await repositories.articles.get(article.id)).toBeNull()
  })
})

async function mountLibrary(
  repositories: ReturnType<typeof createMemoryLocalRepositories>,
  platform = createFakePlatformServices({ repositories }),
  services: PlatformServices = platform.services,
) {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'library', component: LibraryView },
      { path: '/read/:articleId', name: 'reader', component: { template: '<p>Reader</p>' } },
      { path: '/legacy', name: 'legacy', component: { template: '<p>Legacy</p>' } },
      { path: '/import', name: 'import', component: { template: '<p>Import</p>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const app = createApp(LibraryView)
  mountedApps.push(app)
  app.provide(platformServicesKey, services)
  app.provide(interactionLayerKey, createInteractionLayerController())
  app.use(router)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('[data-testid="article-collection"]')).not.toBeNull())
  return { host, platform }
}

function failRetirementMarkerWrite(
  preferences: PreferencesStore,
  persistence: PreferencePersistence,
): PreferencesStore {
  return new Proxy(preferences, {
    get(target, property, receiver) {
      if (property === 'persistence') {
        return persistence
      }
      if (property === 'update') {
        return async (key: string, updater: (current: unknown | null) => unknown) => {
          if (key.startsWith('reader-progress-journal-retired-article:v1:')) {
            throw new Error('retirement marker write failed')
          }
          return target.update(key, updater)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function withPreferencePersistence(
  preferences: PreferencesStore,
  persistence: PreferencePersistence,
): PreferencesStore {
  return new Proxy(preferences, {
    get(target, property, receiver) {
      if (property === 'persistence') {
        return persistence
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function failIntentCleanup(
  preferences: PreferencesStore,
  persistence: PreferencePersistence,
): PreferencesStore {
  return new Proxy(preferences, {
    get(target, property, receiver) {
      if (property === 'persistence') {
        return persistence
      }
      if (property === 'compareAndRemove') {
        return async () => {
          throw new Error('intent cleanup failed')
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function failNextArticleDeletion(
  repositories: ReturnType<typeof createMemoryLocalRepositories>,
): void {
  const transaction = repositories.transaction.bind(repositories)
  let pendingFailure = true
  repositories.transaction = async (...args) => {
    if (pendingFailure && args[1] === 'readwrite' && args[0].includes('articles')) {
      pendingFailure = false
      throw new Error('article deletion failed')
    }
    return transaction(...args)
  }
}

function manageButton(host: HTMLElement, articleId: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`[data-article-manage="${articleId}"]`)
  if (!button) {
    throw new Error(`Missing management button for ${articleId}.`)
  }
  return button
}

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.includes(text))
  if (!button) {
    throw new Error(`Missing button containing ${text}.`)
  }
  return button
}

async function waitForDialog(host: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(host.querySelector('dialog[open]')).not.toBeNull())
  await settle()
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function createAttempt(articleId: string): ReadingAttempt {
  return {
    id: `attempt:${articleId}`,
    articleId,
    currentSentenceId: `${articleId}:s1`,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 8,
    status: 'active',
    startedAt: '2026-08-11T08:00:00.000Z',
    lastOpenedAt: '2026-08-11T08:03:00.000Z',
  }
}

function createTerm(): VocabularyTerm {
  return {
    id: 'term-managed',
    normalizedTerm: 'managed',
    displayTerm: 'managed',
    orphanedContextCount: 0,
    savedAt: '2026-08-11T08:00:00.000Z',
    updatedAt: '2026-08-11T08:00:00.000Z',
  }
}

function createContext(termId: string, article: ReturnType<typeof createReviewArticle>): VocabularyContext {
  return {
    id: 'context-managed',
    termId,
    articleId: article.id,
    sentenceId: article.sentences[0]!.id,
    sentenceText: article.sentences[0]!.original,
    displayTerm: 'managed',
    savedAt: '2026-08-11T08:00:00.000Z',
  }
}
