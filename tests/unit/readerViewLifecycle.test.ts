/** @vitest-environment jsdom */

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  type App as VueApp,
} from 'vue'
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
  RouterView,
} from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformServicesKey } from '@/app/platformServices'
import type { ArticleRecord } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import { takeLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import ReaderView from '@/views/ReaderView.vue'

const mountedApps: VueApp[] = []

afterEach(() => {
  vi.useRealTimers()
  mountedApps.splice(0).forEach(app => app.unmount())
  takeLibraryArticleFocus()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('ReaderView lifecycle navigation', () => {
  it('keeps the latest same-target transition latched until it succeeds', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const harness = createFakePlatformServices({ repositories })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/read/:articleId',
          name: 'reader',
          component: ReaderView,
          props: true,
        },
        {
          path: '/',
          name: 'library',
          component: defineComponent({
            setup: () => () => h('p', 'Library'),
          }),
        },
      ],
    })
    await router.push(`/read/${article.id}`)
    await router.isReady()

    const app = createApp({
      setup: () => () => h(RouterView),
    })
    mountedApps.push(app)
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await vi.waitFor(() => expect(
      host.querySelector('[data-sentence-id="article-route:s1"]'),
    ).not.toBeNull())

    harness.preferences.update = <T>() => new Promise<T | null>(() => {})
    const immediateUpdate = vi.spyOn(harness.preferences, 'updateImmediately')
    vi.useFakeTimers()

    const firstNavigation = router.push({ name: 'library' })
    await settleMicrotasks()
    expect(immediateUpdate).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const secondNavigation = router.push({ name: 'library' })
    await settleMicrotasks()
    expect(immediateUpdate).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(749)
    const firstResult = await firstNavigation
    expect(isNavigationFailure(firstResult, NavigationFailureType.cancelled)).toBe(true)
    expect(router.currentRoute.value.name).toBe('reader')

    const finalSentence = host.querySelector<HTMLButtonElement>(
      '[data-sentence-id="article-route:s3"]',
    )
    expect(finalSentence).not.toBeNull()
    finalSentence?.click()
    await nextTick()
    expect(finalSentence?.getAttribute('aria-current')).toBeNull()
    expect(host.querySelector('[aria-current="true"]')?.getAttribute('data-sentence-id'))
      .toBe('article-route:s1')

    await vi.advanceTimersByTimeAsync(1)
    await expect(secondNavigation).resolves.toBeUndefined()
    expect(router.currentRoute.value.name).toBe('library')
    expect(takeLibraryArticleFocus()).toBe(article.id)
  })

  it('resumes the reader after a target route fails to load', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const harness = createFakePlatformServices({ repositories })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/read/:articleId',
          name: 'reader',
          component: ReaderView,
          props: true,
        },
        {
          path: '/broken',
          name: 'broken',
          component: () => Promise.reject(new Error('Target route chunk failed to load.')),
        },
        {
          path: '/',
          name: 'library',
          component: defineComponent({
            setup: () => () => h('p', 'Library'),
          }),
        },
      ],
    })
    await router.push(`/read/${article.id}`)
    await router.isReady()

    const app = createApp({
      setup: () => () => h(RouterView),
    })
    mountedApps.push(app)
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await vi.waitFor(() => expect(
      host.querySelector('[data-sentence-id="article-route:s1"]'),
    ).not.toBeNull())

    await expect(router.push({ name: 'broken' }))
      .rejects.toThrow('Target route chunk failed to load.')
    expect(router.currentRoute.value.name).toBe('reader')

    const finalSentence = host.querySelector<HTMLButtonElement>(
      '[data-sentence-id="article-route:s3"]',
    )
    expect(finalSentence).not.toBeNull()
    finalSentence?.click()
    await nextTick()
    expect(finalSentence?.getAttribute('aria-current')).toBe('true')

    const playButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="朗读当前句"]',
    )
    expect(playButton).not.toBeNull()
    playButton?.click()
    await vi.waitFor(() => expect(harness.speech.spoken).toHaveLength(1))
    expect(harness.speech.spoken[0]?.text).toBe(article.sentences[2]?.original)
    expect(finalSentence?.dataset.playing).toBe('true')
  })
})

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function createArticle(): ArticleRecord {
  return {
    id: 'article-route',
    schemaVersion: 2,
    contentHash: 'article-route-hash',
    title: 'Route lifecycle article',
    description: 'An article used to exercise concurrent reader navigation.',
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: 'Pasted text' },
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
      id: `article-route:s${index + 1}`,
      order: index,
      paragraphIndex: 0,
      textHash: `route-sentence-hash-${index}`,
      original: `This is route sentence ${index + 1}.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 15,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
  }
}
