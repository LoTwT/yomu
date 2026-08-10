/** @vitest-environment jsdom */

import { createApp, nextTick, type App as VueApp } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import {
  createActiveReviewAttempt,
  createReviewArticle,
} from './readingReviewTestFixtures'

const mountedApps: VueApp[] = []

beforeEach(() => {
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Reader completion route', () => {
  it('durably completes once, retries a failed review navigation, and only rereads explicitly', async () => {
    const article = createReviewArticle('article-finish', 'A Finished Reading', 'Local paste')
    const activeAttempt = createActiveReviewAttempt(article, 'attempt-finish')
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [activeAttempt],
    })
    const router = createYomuRouter(createMemoryHistory())
    await router.replace('/')
    await router.push({ name: 'reader', params: { articleId: article.id } })
    await router.isReady()

    const host = document.createElement('div')
    document.body.append(host)
    const harness = createFakePlatformServices({ repositories })
    const app = createApp(App)
    mountedApps.push(app)
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    app.mount(host)
    await vi.waitFor(() => expect(host.textContent).toContain('读完这篇文章了吗？'))

    const removeReviewGuard = router.beforeEach((to) =>
      to.name === 'review' ? false : true)
    const completeButton = findButton(host, '完成阅读')
    completeButton.click()
    completeButton.click()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('reader')
      expect(host.textContent).toContain('阅读已完成，但回顾页面暂时未能打开')
      expect(findButton(host, '打开读后回顾')).toBeTruthy()
    })
    const completedAttempt = await repositories.attempts.get(activeAttempt.id)
    expect(completedAttempt).toMatchObject({
      id: activeAttempt.id,
      status: 'completed',
    })
    expect(completedAttempt?.completedAt).toBeTruthy()
    expect(await repositories.attempts.count()).toBe(1)
    expect(await repositories.attempts.getActiveByArticle(article.id)).toBeNull()

    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
    const restoredApp = createApp(App)
    mountedApps.push(restoredApp)
    restoredApp.provide(platformServicesKey, harness.services)
    restoredApp.use(router)
    restoredApp.mount(host)
    await vi.waitFor(() => expect(findButton(host, '打开读后回顾')).toBeTruthy())
    expect(await repositories.attempts.count()).toBe(1)
    expect(await repositories.attempts.getActiveByArticle(article.id)).toBeNull()

    removeReviewGuard()
    findButton(host, '打开读后回顾').click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value).toMatchObject({
        name: 'review',
        params: { attemptId: activeAttempt.id },
      })
      expect(host.textContent).toContain('A Finished Reading')
      expect(host.textContent).toContain('阅读完成')
    })

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('library'))
    expect(await repositories.attempts.getActiveByArticle(article.id)).toBeNull()

    await router.push({ name: 'review', params: { attemptId: activeAttempt.id } })
    await settle()
    findButton(host, '再读一次').click()
    await vi.waitFor(async () => {
      expect(router.currentRoute.value.name).toBe('reader')
      const rereadAttempt = await repositories.attempts.getActiveByArticle(article.id)
      expect(rereadAttempt?.id).not.toBe(activeAttempt.id)
    })
    expect(await repositories.attempts.count()).toBe(2)
  })

  it('lets a new Reader complete while the previous article completion is frozen', async () => {
    const firstArticle = createReviewArticle('article-slow-finish', 'A Slow Finished Reading')
    const secondArticle = createReviewArticle('article-next-finish', 'The Next Finished Reading')
    const activeAttempt = createActiveReviewAttempt(firstArticle, 'attempt-slow-finish')
    const repositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
      attempts: [activeAttempt],
    })
    const originalTransaction = repositories.transaction.bind(repositories)
    let rejectFirstCompletion!: (reason?: unknown) => void
    const firstCompletionGate = new Promise<never>((_resolve, reject) => {
      rejectFirstCompletion = reject
    })
    let delayFirstCompletion = false
    let attemptWriteCount = 0
    repositories.transaction = async (stores, mode, operation) => {
      if (delayFirstCompletion && mode === 'readwrite' && stores.includes('attempts')) {
        attemptWriteCount += 1
        if (attemptWriteCount === 2) {
          return firstCompletionGate
        }
      }
      return originalTransaction(stores, mode, operation)
    }
    const router = createYomuRouter(createMemoryHistory())
    await router.replace('/')
    await router.push({ name: 'reader', params: { articleId: firstArticle.id } })
    await router.isReady()
    const host = document.createElement('div')
    document.body.append(host)
    const harness = createFakePlatformServices({ repositories })
    const app = createApp(App)
    mountedApps.push(app)
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    app.mount(host)
    await vi.waitFor(() => expect(findButton(host, '完成阅读')).toBeTruthy())

    delayFirstCompletion = true
    findButton(host, '完成阅读').click()
    await vi.waitFor(() => expect(host.textContent).toContain('正在完成阅读'))
    await vi.waitFor(() => expect(attemptWriteCount).toBe(2))

    await router.push({ name: 'reader', params: { articleId: secondArticle.id } })
    await vi.waitFor(() => {
      expect(router.currentRoute.value).toMatchObject({
        name: 'reader',
        params: { articleId: secondArticle.id },
      })
      expect(host.textContent).toContain(secondArticle.title)
      expect(findButton(host, '完成阅读')).toBeTruthy()
    })

    findButton(host, '完成阅读').click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('review')
      expect(host.textContent).toContain(secondArticle.title)
      expect(host.textContent).toContain('阅读完成')
    })

    rejectFirstCompletion(new Error('The previous article completion timed out.'))
    await settle()
    expect(router.currentRoute.value).toMatchObject({
      name: 'review',
      params: { attemptId: expect.any(String) },
    })
    expect(host.textContent).toContain(secondArticle.title)
  }, 5_000)
})

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.trim() === label)
  if (!button) {
    throw new Error(`Expected button: ${label}`)
  }
  return button
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
