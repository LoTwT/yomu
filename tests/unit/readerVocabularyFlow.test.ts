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
  type RouteRecordRaw,
  type Router,
} from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
  type InteractionLayerController,
} from '@/app/interactionLayer'
import { platformServicesKey } from '@/app/platformServices'
import {
  createCoordinatedRouterHistory,
  registerRouteLeaveCoordinator,
} from '@/app/routeLeaveCoordinator'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type {
  DataStoreName,
  LocalRepositories,
  RepositoryMode,
  RepositoryScope,
} from '@/data/repositories'
import { saveVocabularyContext } from '@/features/vocabulary/vocabularyCommands'
import {
  createFakePlatformServices,
  type FakeLifecycleAdapter,
} from '@/platform/fake/createFakePlatformServices'
import ReaderView from '@/views/ReaderView.vue'

const mountedApps: VueApp[] = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
  for (const element of [document.documentElement, document.body]) {
    element.style.removeProperty('overflow')
    element.style.removeProperty('overscroll-behavior')
    element.style.removeProperty('scrollbar-gutter')
    element.style.removeProperty('--modal-scrollbar-gutter')
  }
  vi.restoreAllMocks()
})

describe('Reader vocabulary flow', () => {
  it('loads durable state and saves then removes the selected word context', async () => {
    const article = createVocabularyArticle('reader-vocabulary-a', 'Patience')
    const harness = await mountReader([article])
    const lookup = createDeferred()
    delayVocabularyLookups(harness.repositories, [lookup])

    clickWord(harness.host, `${article.id}:token-word`)
    await nextTick()

    const loadingAction = wordCardAction(harness.host)
    expect(harness.host.querySelector('[role="status"]')?.textContent)
      .toContain('正在读取收藏状态')
    expect(loadingAction.disabled).toBe(true)

    lookup.resolve()
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('收藏单词')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    wordCardAction(harness.host).click()
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('取消收藏')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    const [savedTerms, savedContexts] = await Promise.all([
      harness.repositories.vocabularyTerms.list(),
      harness.repositories.vocabularyContexts.list(),
    ])
    expect(savedTerms).toHaveLength(1)
    expect(savedTerms[0]).toMatchObject({
      normalizedTerm: 'patience',
      displayTerm: 'Patience',
      meaning: '耐心',
    })
    expect(savedContexts).toHaveLength(1)
    expect(savedContexts[0]).toMatchObject({
      termId: savedTerms[0]?.id,
      articleId: article.id,
      sentenceId: `${article.id}:sentence-1`,
      sentenceText: 'Patience rewards careful readers.',
      displayTerm: 'Patience',
    })

    wordCardAction(harness.host).click()
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('收藏单词')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    await expect(harness.repositories.vocabularyTerms.list()).resolves.toEqual([])
    await expect(harness.repositories.vocabularyContexts.list()).resolves.toEqual([])
  })

  it('closes the card before navigation and ignores lookups settled after route reuse or unmount', async () => {
    const firstArticle = createVocabularyArticle('reader-vocabulary-a', 'Patience')
    const secondArticle = createVocabularyArticle('reader-vocabulary-b', 'Focus')
    const harness = await mountReader([firstArticle, secondArticle])
    const firstLookup = createDeferred()
    const secondLookup = createDeferred()
    delayVocabularyLookups(harness.repositories, [firstLookup, secondLookup])

    clickWord(harness.host, `${firstArticle.id}:token-word`)
    await nextTick()
    expect(harness.host.querySelector('dialog[open]')).not.toBeNull()
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')

    const blockedNavigation = await harness.router.push(`/read/${secondArticle.id}`)
    expect(isNavigationFailure(blockedNavigation, NavigationFailureType.aborted)).toBe(true)
    expect(harness.router.currentRoute.value.params.articleId).toBe(firstArticle.id)
    expect(harness.host.querySelector('dialog')).toBeNull()
    expect(harness.interactionLayer.activeLayerId.value).toBeNull()

    await harness.router.push(`/read/${secondArticle.id}`)
    await vi.waitFor(() => expect(
      harness.host.querySelector(`[data-word-token-id="${secondArticle.id}:token-word"]`),
    ).not.toBeNull())

    clickWord(harness.host, `${secondArticle.id}:token-word`)
    await nextTick()
    expect(harness.host.querySelector('[role="status"]')?.textContent)
      .toContain('正在读取收藏状态')
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')

    firstLookup.resolve()
    await settleMicrotasks()
    expect(harness.router.currentRoute.value.params.articleId).toBe(secondArticle.id)
    expect(harness.host.querySelector('dialog[open]')).not.toBeNull()
    expect(harness.host.querySelector('[role="status"]')?.textContent)
      .toContain('正在读取收藏状态')
    expect(wordCardAction(harness.host).disabled).toBe(true)

    harness.app.unmount()
    mountedApps.splice(mountedApps.indexOf(harness.app), 1)
    expect(harness.interactionLayer.activeLayerId.value).toBeNull()
    expect(harness.host.querySelector('dialog')).toBeNull()

    secondLookup.resolve()
    await settleMicrotasks()
    expect(harness.host.querySelector('dialog')).toBeNull()
    expect(harness.interactionLayer.activeLayerId.value).toBeNull()
  })

  it('refreshes an open card from durable state when its tab becomes active again', async () => {
    const article = createVocabularyArticle('reader-vocabulary-lifecycle', 'Patience')
    const harness = await mountReader([article])

    clickWord(harness.host, `${article.id}:token-word`)
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('收藏单词')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    harness.lifecycle.emit('background')
    await saveVocabularyContext(
      harness.repositories,
      {
        articleId: article.id,
        sentenceId: article.sentences[0]!.id,
        tokenId: article.sentences[0]!.tokens[0]!.id,
      },
      {
        now: () => new Date('2026-08-11T01:00:00.000Z'),
        randomUUID: sequenceIds('lifecycle-term', 'lifecycle-context'),
      },
    )
    expect(wordCardAction(harness.host).textContent).toContain('收藏单词')

    harness.lifecycle.emit('active')
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('取消收藏')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })
  })

  it('rechecks durable state after an active event overlaps a pending save result', async () => {
    const article = createVocabularyArticle('reader-vocabulary-save-race', 'Patience')
    const harness = await mountReader([article])

    clickWord(harness.host, `${article.id}:token-word`)
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('收藏单词')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    const writeGate = gateNextVocabularyWriteResult(harness.repositories)
    wordCardAction(harness.host).click()
    await writeGate.committed
    const savedContext = (await harness.repositories.vocabularyContexts.list())[0]!
    const savedTerm = (await harness.repositories.vocabularyTerms.list())[0]!
    await harness.repositories.transaction(
      ['vocabularyTerms', 'vocabularyContexts'],
      'readwrite',
      async (scope) => {
        await scope.vocabularyContexts.delete(savedContext.id)
        await scope.vocabularyTerms.delete(savedTerm.id)
      },
    )

    harness.lifecycle.emit('active')
    writeGate.release()

    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('收藏单词')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })
    await expect(harness.repositories.vocabularyContexts.list()).resolves.toEqual([])
  })

  it('rechecks durable state after an active event overlaps a pending remove result', async () => {
    const article = createVocabularyArticle('reader-vocabulary-remove-race', 'Patience')
    const harness = await mountReader([article])
    await saveVocabularyContext(
      harness.repositories,
      {
        articleId: article.id,
        sentenceId: article.sentences[0]!.id,
        tokenId: article.sentences[0]!.tokens[0]!.id,
      },
      {
        now: () => new Date('2026-08-11T02:00:00.000Z'),
        randomUUID: sequenceIds('remove-race-term', 'remove-race-context'),
      },
    )

    clickWord(harness.host, `${article.id}:token-word`)
    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('取消收藏')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })

    const writeGate = gateNextVocabularyWriteResult(harness.repositories)
    wordCardAction(harness.host).click()
    await writeGate.committed
    await saveVocabularyContext(
      harness.repositories,
      {
        articleId: article.id,
        sentenceId: article.sentences[0]!.id,
        tokenId: article.sentences[0]!.tokens[0]!.id,
      },
      {
        now: () => new Date('2026-08-11T02:01:00.000Z'),
        randomUUID: sequenceIds('remove-race-term-new', 'remove-race-context-new'),
      },
    )

    harness.lifecycle.emit('active')
    writeGate.release()

    await vi.waitFor(() => {
      expect(wordCardAction(harness.host).textContent).toContain('取消收藏')
      expect(wordCardAction(harness.host).disabled).toBe(false)
    })
    await expect(harness.repositories.vocabularyContexts.list()).resolves.toHaveLength(1)
  })
})

interface ReaderHarness {
  app: VueApp
  host: HTMLElement
  interactionLayer: InteractionLayerController
  lifecycle: FakeLifecycleAdapter
  repositories: LocalRepositories
  router: Router
}

async function mountReader(articles: ArticleRecord[]): Promise<ReaderHarness> {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const repositories = createMemoryLocalRepositories({
    articles,
    attempts: articles.map(createActiveAttempt),
  })
  const platform = createFakePlatformServices({ repositories })
  const interactionLayer = createInteractionLayerController()
  const router = createReaderTestRouter([
    {
      path: '/',
      name: 'library',
      component: defineComponent({ setup: () => () => h('p', 'Library') }),
    },
    {
      path: '/read/:articleId',
      name: 'reader',
      component: ReaderView,
      props: true,
    },
  ])
  await router.push(`/read/${articles[0]!.id}`)
  await router.isReady()

  const app = createApp({ setup: () => () => h(RouterView) })
  mountedApps.push(app)
  app.provide(interactionLayerKey, interactionLayer)
  app.provide(platformServicesKey, platform.services)
  app.use(router)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await vi.waitFor(() => expect(
    host.querySelector(`[data-word-token-id="${articles[0]!.id}:token-word"]`),
  ).not.toBeNull())

  return {
    app,
    host,
    interactionLayer,
    lifecycle: platform.lifecycle,
    repositories,
    router,
  }
}

function createReaderTestRouter(routes: RouteRecordRaw[]): Router {
  const coordinated = createCoordinatedRouterHistory(createMemoryHistory())
  const router = createRouter({
    history: coordinated.history,
    routes,
  })
  coordinated.coordinator.attachRouter(router)
  registerRouteLeaveCoordinator(router, coordinated.coordinator)
  return router
}

function delayVocabularyLookups(
  repositories: LocalRepositories,
  gates: Array<Deferred<void>>,
): void {
  const originalTransaction = repositories.transaction.bind(repositories)
  let lookupIndex = 0
  repositories.transaction = (<T>(
    stores: readonly DataStoreName[],
    mode: RepositoryMode,
    operation: (scope: RepositoryScope) => Promise<T>,
  ): Promise<T> => {
    const isVocabularyLookup = mode === 'readonly'
      && stores.length === 3
      && stores.includes('articles')
      && stores.includes('vocabularyTerms')
      && stores.includes('vocabularyContexts')
    const gate = isVocabularyLookup ? gates[lookupIndex++] : undefined
    return gate
      ? gate.promise.then(() => originalTransaction(stores, mode, operation))
      : originalTransaction(stores, mode, operation)
  }) as LocalRepositories['transaction']
}

function gateNextVocabularyWriteResult(repositories: LocalRepositories): {
  committed: Promise<void>
  release: () => void
} {
  const originalTransaction = repositories.transaction.bind(repositories)
  const committed = createDeferred()
  const released = createDeferred()
  let gateNextWrite = true
  repositories.transaction = (async <T>(
    stores: readonly DataStoreName[],
    mode: RepositoryMode,
    operation: (scope: RepositoryScope) => Promise<T>,
  ): Promise<T> => {
    const result = await originalTransaction(stores, mode, operation)
    if (gateNextWrite && mode === 'readwrite' && stores.includes('vocabularyContexts')) {
      gateNextWrite = false
      committed.resolve()
      await released.promise
    }
    return result
  }) as LocalRepositories['transaction']
  return {
    committed: committed.promise,
    release: () => released.resolve(),
  }
}

function clickWord(host: HTMLElement, tokenId: string): void {
  const word = host.querySelector<HTMLElement>(`[data-word-token-id="${tokenId}"]`)
  expect(word).not.toBeNull()
  word?.click()
}

function wordCardAction(host: HTMLElement): HTMLButtonElement {
  const action = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => /收藏单词|取消收藏|正在.+收藏/.test(button.textContent ?? ''))
  expect(action).not.toBeUndefined()
  return action!
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred(): Deferred<void> {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0
  return () => {
    const id = ids[index++]
    if (!id) {
      throw new Error('Unexpected vocabulary UUID request.')
    }
    return id
  }
}

function createVocabularyArticle(id: string, word: string): ArticleRecord {
  const sentenceId = `${id}:sentence-1`
  return {
    id,
    schemaVersion: 2,
    contentHash: `${id}:content-hash`,
    title: `${word} reading`,
    description: 'An article used to verify Reader vocabulary orchestration.',
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
      tokenMeaning: 'partial',
    },
    sentences: [{
      id: sentenceId,
      order: 0,
      paragraphIndex: 0,
      textHash: `${id}:sentence-hash`,
      original: `${word} rewards careful readers.`,
      tokens: [
        {
          id: `${id}:token-word`,
          text: word,
          kind: 'word',
          meaning: word === 'Patience' ? '耐心' : '专注',
        },
        { id: `${id}:token-rewards`, text: 'rewards', kind: 'word' },
        { id: `${id}:token-careful`, text: 'careful', kind: 'word' },
        { id: `${id}:token-readers`, text: 'readers', kind: 'word' },
        { id: `${id}:token-period`, text: '.', kind: 'punctuation' },
      ],
    }],
    factSources: [],
    wordCount: 4,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

function createActiveAttempt(article: ArticleRecord): ReadingAttempt {
  return {
    id: `${article.id}:attempt`,
    articleId: article.id,
    currentSentenceId: article.sentences[0]!.id,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 0,
    progressRevision: 0,
    status: 'active',
    startedAt: '2026-08-11T00:00:00.000Z',
    lastOpenedAt: '2026-08-11T00:00:00.000Z',
  }
}
