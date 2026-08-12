/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import {
  ArticleDeletionPendingRetryError,
  deleteArticleFromDevice,
} from '@/features/library/articleDeletion'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import LibraryView from '@/views/LibraryView.vue'
import {
  createActiveReviewAttempt,
  createReviewArticle,
} from './readingReviewTestFixtures'

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

describe('library lifecycle refresh', () => {
  it('silently adopts durable articles while preserving the focused article link', async () => {
    const first = createReviewArticle('library-lifecycle-first', 'First article')
    const second = {
      ...createReviewArticle('library-lifecycle-second', 'Second article'),
      createdAt: '2026-08-11T01:00:00.000Z',
      updatedAt: '2026-08-11T01:00:00.000Z',
    }
    const repositories = createMemoryLocalRepositories({ articles: [first] })
    const mounted = await mountLibrary(repositories)

    const firstLink = mounted.host.querySelector<HTMLAnchorElement>(
      `[data-article-id="${first.id}"] .article-object__link`,
    )
    expect(firstLink).not.toBeNull()
    firstLink?.focus()
    mounted.platform.lifecycle.emit('background')
    await repositories.articles.put(second)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${second.id}"]`),
    ).not.toBeNull())
    expect(mounted.host.querySelector(
      `[data-article-id="${first.id}"] .article-object__link`,
    )).toBe(firstLink)
    expect(document.activeElement).toBe(firstLink)
    expect(mounted.host.textContent).not.toContain('正在读取此设备上的阅读库')
  })

  it('rechecks a stale cold-start snapshot after recovering a confirmed deletion', async () => {
    const article = createReviewArticle('library-recovery-stale', 'Stale recovery article')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const platform = createFakePlatformServices({ repositories })
    const originalTransaction = repositories.transaction.bind(repositories)
    let failNextDelete = true
    repositories.transaction = async (...args) => {
      if (failNextDelete && args[1] === 'readwrite' && args[0].includes('articles')) {
        failNextDelete = false
        throw new Error('interrupt deletion before commit')
      }
      return originalTransaction(...args)
    }
    await expect(deleteArticleFromDevice(platform.services, {
      articleId: article.id,
      deleteContextlessTerms: false,
    })).rejects.toBeInstanceOf(
      ArticleDeletionPendingRetryError,
    )

    const gated = gateFirstArticleList(repositories)
    const mountPromise = mountLibrary(gated.repositories, platform)
    await gated.listStarted
    await vi.waitFor(async () => expect(await repositories.articles.get(article.id)).toBeNull())
    gated.releaseList()
    const mounted = await mountPromise

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${article.id}"]`),
    ).toBeNull())
    expect(mounted.host.querySelector('[data-testid="library-empty-state"]')).not.toBeNull()
  })

  it('moves focus to the nearest article when an active refresh removes the focused one', async () => {
    const removed = createReviewArticle('library-focused-removed', 'Focused article')
    const remaining = {
      ...createReviewArticle('library-focused-remaining', 'Remaining article'),
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }
    const repositories = createMemoryLocalRepositories({ articles: [removed, remaining] })
    const mounted = await mountLibrary(repositories)
    const removedLink = mounted.host.querySelector<HTMLAnchorElement>(
      `[data-article-id="${removed.id}"] [data-article-open]`,
    )!
    removedLink.focus()

    mounted.platform.lifecycle.emit('background')
    await repositories.articles.delete(removed.id)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${removed.id}"]`),
    ).toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${remaining.id}"] [data-article-open]`),
    )
  })

  it('moves focus from a completed continue-reading card to the article link', async () => {
    const article = createReviewArticle('library-continue-completed', 'Completed article')
    const attempt = createActiveReviewAttempt(article, 'attempt-continue-completed')
    const repositories = createMemoryLocalRepositories({ articles: [article], attempts: [attempt] })
    const mounted = await mountLibrary(repositories)
    const continueLink = mounted.host.querySelector<HTMLAnchorElement>(
      `[data-continue-article-id="${article.id}"] [data-continue-open]`,
    )!
    continueLink.focus()

    mounted.platform.lifecycle.emit('background')
    await repositories.attempts.put({
      ...attempt,
      status: 'completed',
      completedAt: '2026-08-11T09:00:00.000Z',
      lastOpenedAt: '2026-08-11T09:00:00.000Z',
    })
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector('[data-continue-article-id]'),
    ).toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${article.id}"] [data-article-open]`),
    )
  })

  it('moves focus from a deleted continue-reading card to the nearest article', async () => {
    const removed = createReviewArticle('library-continue-removed', 'Removed continue article')
    const remaining = {
      ...createReviewArticle('library-continue-sibling', 'Continue sibling'),
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }
    const attempt = createActiveReviewAttempt(removed, 'attempt-continue-removed')
    const repositories = createMemoryLocalRepositories({
      articles: [removed, remaining],
      attempts: [attempt],
    })
    const mounted = await mountLibrary(repositories)
    mounted.host.querySelector<HTMLAnchorElement>(
      `[data-continue-article-id="${removed.id}"] [data-continue-open]`,
    )!.focus()

    mounted.platform.lifecycle.emit('background')
    await repositories.attempts.delete(attempt.id)
    await repositories.articles.delete(removed.id)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${removed.id}"]`),
    ).toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${remaining.id}"] [data-article-open]`),
    )
  })

  it('moves focus from the empty state to the first imported article', async () => {
    const repositories = createMemoryLocalRepositories()
    const mounted = await mountLibrary(repositories)
    mounted.host.querySelector<HTMLAnchorElement>('.library-empty__primary')!.focus()
    const imported = createReviewArticle('library-first-imported', 'First imported article')

    mounted.platform.lifecycle.emit('background')
    await repositories.articles.put(imported)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${imported.id}"]`),
    ).not.toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${imported.id}"] [data-article-open]`),
    )
  })

  it('moves focus from the recommendation to the empty-state primary action', async () => {
    const article = createReviewArticle('library-last-recommended', 'Last article')
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const mounted = await mountLibrary(repositories)
    mounted.host.querySelector<HTMLAnchorElement>('.recommendation-card__link')!.focus()

    mounted.platform.lifecycle.emit('background')
    await repositories.articles.delete(article.id)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector('[data-testid="library-empty-state"]'),
    ).not.toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector('.library-empty__primary'),
    )
  })

  it('focuses a sibling when a pending management request loses its article', async () => {
    const removed = createReviewArticle('library-pending-management', 'Pending management')
    const remaining = {
      ...createReviewArticle('library-pending-sibling', 'Pending sibling'),
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }
    const repositories = createMemoryLocalRepositories({ articles: [removed, remaining] })
    const gate = gateFirstManagementRead(repositories)
    const mounted = await mountLibrary(repositories)
    mounted.host.querySelector<HTMLButtonElement>(
      `[data-article-manage="${removed.id}"]`,
    )!.click()
    await gate.readStarted

    mounted.platform.lifecycle.emit('background')
    await repositories.articles.delete(removed.id)
    mounted.platform.lifecycle.emit('active')

    await vi.waitFor(() => expect(
      mounted.host.querySelector(`[data-article-id="${removed.id}"]`),
    ).toBeNull())
    expect(document.activeElement).toBe(
      mounted.host.querySelector(`[data-article-id="${remaining.id}"] [data-article-open]`),
    )
    gate.releaseRead()
    await nextTick()
    expect(mounted.host.querySelector('dialog')).toBeNull()
  })
})

async function mountLibrary(
  repositories: LocalRepositories,
  platform = createFakePlatformServices({ repositories }),
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
  app.provide(platformServicesKey, { ...platform.services, repositories })
  app.use(router)
  app.mount(host)
  await vi.waitFor(() => expect(host.textContent).not.toContain('正在读取此设备上的阅读库'))
  await nextTick()
  return { host, platform }
}

function gateFirstArticleList(repositories: LocalRepositories): {
  repositories: LocalRepositories
  listStarted: Promise<void>
  releaseList: () => void
} {
  let reportListStarted!: () => void
  let releaseList!: () => void
  const listStarted = new Promise<void>((resolve) => {
    reportListStarted = resolve
  })
  const gate = new Promise<void>((resolve) => {
    releaseList = resolve
  })
  let gateNextList = true
  const articles = {
    ...repositories.articles,
    async list() {
      if (!gateNextList) {
        return repositories.articles.list()
      }
      gateNextList = false
      const snapshot = await repositories.articles.list()
      reportListStarted()
      await gate
      return snapshot
    },
  }
  return {
    repositories: new Proxy(repositories, {
      get(target, property, receiver) {
        if (property === 'articles') {
          return articles
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    listStarted,
    releaseList,
  }
}

function gateFirstManagementRead(repositories: LocalRepositories): {
  readStarted: Promise<void>
  releaseRead: () => void
} {
  const originalTransaction = repositories.transaction.bind(repositories)
  let reportReadStarted!: () => void
  let releaseRead!: () => void
  const readStarted = new Promise<void>((resolve) => {
    reportReadStarted = resolve
  })
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let gateNextRead = true
  repositories.transaction = async (...args) => {
    if (
      gateNextRead
      && args[1] === 'readonly'
      && args[0].includes('articles')
      && args[0].includes('vocabularyContexts')
    ) {
      gateNextRead = false
      reportReadStarted()
      await gate
    }
    return originalTransaction(...args)
  }
  return { readStarted, releaseRead }
}
