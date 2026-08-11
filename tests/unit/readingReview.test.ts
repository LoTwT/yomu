/** @vitest-environment jsdom */

import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import type { ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { AttemptRepository, LocalRepositories } from '@/data/repositories'
import { useReadingReview } from '@/features/review/useReadingReview'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import {
  createActiveReviewAttempt,
  createCompletedReviewAttempt,
  createReviewArticle,
} from './readingReviewTestFixtures'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('useReadingReview', () => {
  it('loads a completed attempt and reacts to incomplete and missing ids', async () => {
    const article = createReviewArticle()
    const completed = createCompletedReviewAttempt(article)
    const active = createActiveReviewAttempt(article)
    const repositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed, active],
    })
    const mounted = mountReadingReview(repositories, completed.id)

    await waitForStatus(mounted.result, 'ready')
    expect(mounted.result.review.value).toEqual({
      article,
      attempt: completed,
      vocabulary: [],
    })

    mounted.attemptId.value = active.id
    await waitForStatus(mounted.result, 'incomplete')
    expect(mounted.result.attempt.value?.id).toBe(active.id)
    expect(mounted.result.review.value).toBeNull()

    mounted.attemptId.value = 'attempt-does-not-exist'
    await waitForStatus(mounted.result, 'missing')
    expect(mounted.result.missingResource.value).toBe('attempt')
    expect(mounted.result.attempt.value).toBeNull()
  })

  it('distinguishes a deleted article from a missing attempt', async () => {
    const article = createReviewArticle('article-deleted')
    const completed = createCompletedReviewAttempt(article, 'attempt-orphaned')
    const repositories = createMemoryLocalRepositories({ attempts: [completed] })
    const mounted = mountReadingReview(repositories, completed.id)

    await waitForStatus(mounted.result, 'missing')
    expect(mounted.result.missingResource.value).toBe('article')
    expect(mounted.result.attempt.value?.id).toBe(completed.id)
  })

  it('reports repository failures and can retry without mutating the record', async () => {
    const article = createReviewArticle()
    const completed = createCompletedReviewAttempt(article)
    const baseRepositories = createMemoryLocalRepositories({
      articles: [article],
      attempts: [completed],
    })
    let shouldFail = true
    const repositories = withAttemptGet(baseRepositories, async (id) => {
      if (shouldFail) {
        throw new Error('Repository unavailable')
      }
      return baseRepositories.attempts.get(id)
    })
    const mounted = mountReadingReview(repositories, completed.id)

    await waitForStatus(mounted.result, 'error')
    expect(mounted.result.errorMessage.value).toContain('没有修改本机记录')

    shouldFail = false
    await mounted.result.reload()
    await waitForStatus(mounted.result, 'ready')
    expect(mounted.result.review.value?.attempt).toEqual(completed)
  })

  it('does not let a stale attempt load replace a newer review', async () => {
    const slowArticle = createReviewArticle('article-slow', 'Slow Reading')
    const fastArticle = createReviewArticle('article-fast', 'Fast Reading')
    const slowAttempt = createCompletedReviewAttempt(slowArticle, 'attempt-slow')
    const fastAttempt = createCompletedReviewAttempt(fastArticle, 'attempt-fast')
    const baseRepositories = createMemoryLocalRepositories({
      articles: [slowArticle, fastArticle],
      attempts: [fastAttempt],
    })
    let resolveSlowAttempt!: (attempt: ReadingAttempt | null) => void
    const slowResult = new Promise<ReadingAttempt | null>((resolve) => {
      resolveSlowAttempt = resolve
    })
    const repositories = withAttemptGet(baseRepositories, id => id === slowAttempt.id
      ? slowResult
      : baseRepositories.attempts.get(id))
    const mounted = mountReadingReview(repositories, slowAttempt.id)

    mounted.attemptId.value = fastAttempt.id
    await waitForStatus(mounted.result, 'ready')
    expect(mounted.result.review.value?.article.id).toBe(fastArticle.id)

    resolveSlowAttempt(slowAttempt)
    await Promise.resolve()
    await nextTick()
    expect(mounted.result.status.value).toBe('ready')
    expect(mounted.result.review.value?.article.id).toBe(fastArticle.id)
  })

  it('does not reuse a pending reread after the review route changes', async () => {
    const firstArticle = createReviewArticle('article-reread-first', 'First reread')
    const secondArticle = createReviewArticle('article-reread-second', 'Second reread')
    const firstAttempt = createCompletedReviewAttempt(firstArticle, 'attempt-reread-first')
    const secondAttempt = createCompletedReviewAttempt(secondArticle, 'attempt-reread-second')
    const baseRepositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
      attempts: [firstAttempt, secondAttempt],
    })
    let releaseFirstReread!: () => void
    const firstRereadGate = new Promise<void>((resolve) => {
      releaseFirstReread = resolve
    })
    let readwriteCalls = 0
    const repositories = new Proxy(baseRepositories, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: Parameters<LocalRepositories['transaction']>) => {
            if (args[1] === 'readwrite') {
              readwriteCalls += 1
              if (readwriteCalls === 1) {
                await firstRereadGate
              }
            }
            return target.transaction(...args)
          }
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const mounted = mountReadingReview(repositories, firstAttempt.id)

    await waitForStatus(mounted.result, 'ready')
    const firstReread = mounted.result.startRereading()
    expect(mounted.result.rereadState.value).toBe('starting')

    mounted.attemptId.value = secondAttempt.id
    await waitForStatus(mounted.result, 'ready')
    const secondReread = mounted.result.startRereading()
    const secondActiveAttempt = await secondReread

    expect(secondActiveAttempt?.articleId).toBe(secondArticle.id)
    expect(mounted.result.review.value?.attempt.id).toBe(secondAttempt.id)
    expect(mounted.result.rereadState.value).toBe('idle')

    releaseFirstReread()
    const firstActiveAttempt = await firstReread
    expect(firstActiveAttempt?.articleId).toBe(firstArticle.id)
    expect(mounted.result.review.value?.attempt.id).toBe(secondAttempt.id)
    expect(mounted.result.rereadState.value).toBe('idle')
  })
})

function mountReadingReview(repositories: LocalRepositories, initialAttemptId: string) {
  const attemptId = shallowRef(initialAttemptId)
  let result!: ReturnType<typeof useReadingReview>
  const Root = defineComponent({
    setup() {
      result = useReadingReview(attemptId)
      return () => h('div')
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Root)
  mountedApps.push(app)
  app.provide(platformServicesKey, createFakePlatformServices({ repositories }).services)
  app.mount(host)
  return { attemptId, result }
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

async function waitForStatus(
  result: ReturnType<typeof useReadingReview>,
  expected: ReturnType<typeof useReadingReview>['status']['value'],
): Promise<void> {
  await nextTick()
  await vi.waitFor(() => expect(result.status.value).toBe(expected))
}
