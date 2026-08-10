/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { AttemptRepository, LocalRepositories } from '@/data/repositories'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import {
  createActiveReviewAttempt,
  createCompletedReviewAttempt,
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

describe('review route', () => {
  it('is immersive and refreshes the review when only attemptId changes', async () => {
    const firstArticle = createReviewArticle('article-first', 'First Reading', 'First Source')
    const secondArticle = createReviewArticle('article-second', 'Second Reading', 'Second Source')
    const firstAttempt = createCompletedReviewAttempt(firstArticle, 'attempt-first', 65)
    const secondAttempt = createCompletedReviewAttempt(secondArticle, 'attempt-second', 185)
    const activeAttempt = createActiveReviewAttempt(secondArticle, 'attempt-active')
    const repositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
      attempts: [firstAttempt, secondAttempt, activeAttempt],
    })
    const { host, router } = await mountAt(`/review/${firstAttempt.id}`, repositories)

    expect(router.currentRoute.value.name).toBe('review')
    expect(router.currentRoute.value.meta.immersive).toBe(true)
    expect(host.querySelector('.shell-header')).toBeNull()
    expect(host.querySelector('h1')?.textContent).toContain('读后回顾')
    expect(host.textContent).toContain('First Reading')
    expect(host.textContent).toContain('1 分 5 秒')

    await router.push(`/review/${secondAttempt.id}`)
    await settle()
    expect(host.textContent).not.toContain('First Reading')
    expect(host.textContent).toContain('Second Reading')
    expect(host.textContent).toContain('3 分 5 秒')
    expect(host.querySelector('.review-summary__action--primary')?.textContent)
      .toContain('再读一次')

    await router.push(`/review/${activeAttempt.id}`)
    await settle()
    expect(host.textContent).not.toContain('Second Reading')
    expect(host.textContent).toContain('这次阅读尚未完成')
    expect(host.querySelector('.review-view__state-link--primary')?.getAttribute('href'))
      .toBe(`/read/${secondArticle.id}`)

    await router.push('/review/attempt-missing')
    await settle()
    expect(host.textContent).toContain('找不到这次回顾')
    expect(host.textContent).toContain('此链接不属于当前设备')
  })

  it('shows a recoverable state when the repository cannot be read', async () => {
    const baseRepositories = createMemoryLocalRepositories()
    const repositories = withAttemptGet(baseRepositories, async () => {
      throw new Error('Repository unavailable')
    })
    const { host } = await mountAt('/review/attempt-error', repositories)

    expect(host.textContent).toContain('暂时无法读取回顾')
    expect(host.textContent).toContain('没有修改本机记录')
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('重试')))
      .toBe(true)
    expect([...host.querySelectorAll('a')].some(link => link.textContent?.includes('返回阅读库')))
      .toBe(true)
  })

  it('returns focus to the reviewed article when leaving for the library', async () => {
    const article = createReviewArticle()
    const completedAttempt = createCompletedReviewAttempt(article)
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completedAttempt],
    })
    const { host, router } = await mountAt(`/review/${completedAttempt.id}`, repositories)

    await router.push({ name: 'library' })
    await settle()

    const articleLink = host.querySelector<HTMLAnchorElement>(
      `[data-article-id="${article.id}"] .article-object__link`,
    )
    expect(router.currentRoute.value.name).toBe('library')
    expect(document.activeElement).toBe(articleLink)
  })

  it('starts a reread for the current review while an older reread is pending', async () => {
    const firstArticle = createReviewArticle('article-route-reread-first', 'First route reread')
    const secondArticle = createReviewArticle('article-route-reread-second', 'Second route reread')
    const firstAttempt = createCompletedReviewAttempt(firstArticle, 'attempt-route-reread-first')
    const secondAttempt = createCompletedReviewAttempt(secondArticle, 'attempt-route-reread-second')
    const baseRepositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
      attempts: [firstAttempt, secondAttempt],
    })
    let releaseFirstReread!: () => void
    const firstRereadGate = new Promise<void>((resolve) => {
      releaseFirstReread = resolve
    })
    let delayNextReadwrite = false
    const repositories = new Proxy(baseRepositories, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: Parameters<LocalRepositories['transaction']>) => {
            if (args[1] === 'readwrite' && delayNextReadwrite) {
              delayNextReadwrite = false
              await firstRereadGate
            }
            return target.transaction(...args)
          }
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const { host, router } = await mountAt(`/review/${firstAttempt.id}`, repositories)

    await vi.waitFor(() => expect(
      host.querySelector<HTMLButtonElement>('.review-summary__action--primary'),
    ).not.toBeNull())
    delayNextReadwrite = true
    host.querySelector<HTMLButtonElement>('.review-summary__action--primary')!.click()
    await settle()
    expect(host.textContent).toContain('正在开始新阅读')

    await router.push(`/review/${secondAttempt.id}`)
    await vi.waitFor(() => expect(host.textContent).toContain(secondArticle.title))
    host.querySelector<HTMLButtonElement>('.review-summary__action--primary')?.click()
    await vi.waitFor(() => expect(router.currentRoute.value).toMatchObject({
      name: 'reader',
      params: { articleId: secondArticle.id },
    }))

    releaseFirstReread()
    await vi.waitFor(async () => {
      expect((await repositories.attempts.getActiveByArticle(firstArticle.id))?.articleId)
        .toBe(firstArticle.id)
    })
    expect(router.currentRoute.value).toMatchObject({
      name: 'reader',
      params: { articleId: secondArticle.id },
    })
  })
})

async function mountAt(path: string, repositories: LocalRepositories) {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createYomuRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const app = createApp(App)
  mountedApps.push(app)
  app.provide(
    platformServicesKey,
    createFakePlatformServices({ repositories }).services,
  )
  app.use(router)
  app.mount(host)
  await settle()
  return { host, router }
}

function withAttemptGet(
  repositories: LocalRepositories,
  get: AttemptRepository['get'],
): LocalRepositories {
  const attempts: AttemptRepository = { ...repositories.attempts, get }
  return new Proxy(repositories, {
    get(target, property, receiver) {
      if (property === 'attempts') {
        return attempts
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
