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
} from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
} from '@/app/interactionLayer'
import { platformServicesKey } from '@/app/platformServices'
import {
  createCoordinatedRouterHistory,
  registerRouteLeaveCoordinator,
} from '@/app/routeLeaveCoordinator'
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
  it('clears article interaction layers when another context deletes the article', async () => {
    const article = createArticle()
    article.capabilities.tokenMeaning = 'partial'
    article.sentences[0]!.tokens = [{
      id: `${article.id}:s1:t1`,
      text: 'route',
      kind: 'word',
      meaning: '路线',
    }]
    const { harness, host, interactionLayer, router } = await mountReaderHistory(article)

    host.querySelector<HTMLElement>('[data-word-token-id]')?.click()
    await vi.waitFor(() => expect(
      host.querySelector('dialog.reader-word-card-overlay[open]'),
    ).not.toBeNull())

    harness.articleEvents.publishDeleted({ articleId: article.id })

    await vi.waitFor(() => expect(host.textContent).toContain('找不到这篇文章'))
    expect(host.querySelector('dialog.reader-word-card-overlay')).toBeNull()
    expect(interactionLayer.activeLayerId.value).toBeNull()

    await expect(router.push({ name: 'library' })).resolves.toBeUndefined()
    expect(router.currentRoute.value.name).toBe('library')
  })

  it('retires the Reader settings history layer when the article is deleted', async () => {
    const { article, harness, host, repositories, router } = await mountReaderHistory()
    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await vi.waitFor(() => expect(
      host.querySelector('#reader-settings[open]'),
    ).not.toBeNull())

    harness.articleEvents.publishDeleted({ articleId: article.id })

    await vi.waitFor(() => expect(host.textContent).toContain('找不到这篇文章'))
    await settleMicrotasks()
    expect(host.querySelector('#reader-settings')).toBeNull()

    router.forward()
    await settleMicrotasks()
    expect(router.currentRoute.value.fullPath).toBe(`/read/${article.id}`)
    expect(host.querySelector('#reader-settings')).toBeNull()

    const nextArticle = createArticle('article-route-after-deletion')
    await repositories.articles.put(nextArticle)
    await expect(router.push(`/read/${nextArticle.id}`)).resolves.toBeUndefined()
    await vi.waitFor(() => expect(host.querySelector(
      `[data-sentence-id="${nextArticle.id}:s1"]`,
    )).not.toBeNull())
    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await vi.waitFor(() => expect(host.querySelector('#reader-settings[open]')).not.toBeNull())
  })

  it('closes cached word UI when active article revalidation fails', async () => {
    const article = createArticle()
    article.capabilities.tokenMeaning = 'partial'
    article.sentences[0]!.tokens = [{
      id: `${article.id}:s1:t1`,
      text: 'route',
      kind: 'word',
      meaning: '路线',
    }]
    const { harness, host, repositories } = await mountReaderHistory(article)
    host.querySelector<HTMLElement>('[data-word-token-id]')?.click()
    await vi.waitFor(() => expect(
      host.querySelector('dialog.reader-word-card-overlay[open]'),
    ).not.toBeNull())

    const originalTransaction = repositories.transaction.bind(repositories)
    repositories.transaction = async (...args) => {
      if (args[1] === 'readonly' && args[0].length === 1 && args[0][0] === 'articles') {
        throw new Error('article presence could not be checked')
      }
      return originalTransaction(...args)
    }
    harness.lifecycle.emit('background')
    harness.lifecycle.emit('active')

    await vi.waitFor(() => expect(host.textContent).toContain('暂时无法打开'))
    expect(host.querySelector('dialog.reader-word-card-overlay')).toBeNull()
  })

  it('keeps the latest same-target transition latched until it succeeds', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const harness = createFakePlatformServices({ repositories })
    const router = createReaderTestRouter([
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
    ])
    await router.push(`/read/${article.id}`)
    await router.isReady()

    const app = createApp({
      setup: () => () => h(RouterView),
    })
    mountedApps.push(app)
    app.provide(interactionLayerKey, createInteractionLayerController())
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

  it('closes the active interaction before suspending the Reader route', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const harness = createFakePlatformServices({ repositories })
    const interactionLayer = createInteractionLayerController()
    const router = createReaderTestRouter([
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
    ])
    await router.push(`/read/${article.id}`)
    await router.isReady()

    const app = createApp({
      setup: () => () => h(RouterView),
    })
    mountedApps.push(app)
    app.provide(interactionLayerKey, interactionLayer)
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await vi.waitFor(() => expect(
      host.querySelector('[data-sentence-id="article-route:s1"]'),
    ).not.toBeNull())

    const settingsButton = host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')
    expect(settingsButton).not.toBeNull()
    settingsButton?.focus()
    settingsButton?.click()
    await nextTick()
    expect(host.querySelector('dialog[open]')).not.toBeNull()
    expect(interactionLayer.activeLayerId.value).toBe('reader-settings')
    const immediateUpdate = vi.spyOn(harness.preferences, 'updateImmediately')

    const navigation = await router.push({ name: 'library' })
    await nextTick()

    expect(isNavigationFailure(navigation, NavigationFailureType.aborted)).toBe(true)
    expect(host.querySelector('dialog[open]')).toBeNull()
    expect(interactionLayer.activeLayerId.value).toBeNull()
    expect(immediateUpdate).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('reader')
    expect(document.activeElement).toBe(settingsButton)

    const finalSentence = host.querySelector<HTMLButtonElement>(
      '[data-sentence-id="article-route:s3"]',
    )
    finalSentence?.click()
    await nextTick()
    expect(finalSentence?.getAttribute('aria-current')).toBe('true')
  })

  it('closes Reader settings before reusing the route for another article', async () => {
    const firstArticle = createArticle()
    const secondArticle = createArticle('article-route-b')
    const repositories = createMemoryLocalRepositories({
      articles: [firstArticle, secondArticle],
    })
    const harness = createFakePlatformServices({ repositories })
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
    await router.replace('/')
    await router.push(`/read/${firstArticle.id}`)
    await router.isReady()

    const app = createApp({ setup: () => () => h(RouterView) })
    mountedApps.push(app)
    app.provide(interactionLayerKey, createInteractionLayerController())
    app.provide(platformServicesKey, harness.services)
    app.use(router)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await vi.waitFor(() => expect(
      host.querySelector('[data-sentence-id="article-route:s1"]'),
    ).not.toBeNull())

    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await nextTick()
    expect(host.querySelector('#reader-settings[open]')).not.toBeNull()

    const firstUpdate = await router.push(`/read/${secondArticle.id}`)
    expect(isNavigationFailure(firstUpdate, NavigationFailureType.aborted)).toBe(true)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe(`/read/${firstArticle.id}`)
      expect(host.querySelector('#reader-settings')).toBeNull()
    })

    await router.push(`/read/${secondArticle.id}`)
    await vi.waitFor(() => expect(
      host.querySelector('[data-sentence-id="article-route-b:s1"]'),
    ).not.toBeNull())

    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await nextTick()
    const updatedLocation = `/read/${secondArticle.id}?mode=focus#sentence`
    const firstQueryUpdate = await router.push(updatedLocation)
    expect(isNavigationFailure(firstQueryUpdate, NavigationFailureType.aborted)).toBe(true)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe(`/read/${secondArticle.id}`)
      expect(host.querySelector('#reader-settings')).toBeNull()
    })
    await router.push(updatedLocation)
    expect(router.currentRoute.value.fullPath).toBe(updatedLocation)

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe(`/read/${secondArticle.id}`)
    })
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe(`/read/${firstArticle.id}`)
    })
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it('consumes programmatic back for Reader settings before leaving to the direct predecessor', async () => {
    const { article, host, router } = await mountReaderHistory()
    const settingsButton = host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')
    expect(settingsButton).not.toBeNull()
    settingsButton?.focus()
    settingsButton?.click()
    await nextTick()
    expect(host.querySelector('#reader-settings[open]')).not.toBeNull()

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('#reader-settings')).toBeNull()
      expect(router.currentRoute.value.fullPath).toBe(`/read/${article.id}`)
    })
    expect(host.querySelector('.reader-view')).not.toBeNull()
    expect(document.activeElement).toBe(settingsButton)

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
      expect(host.textContent).toContain('Library')
    })
  })

  it('removes the settings history entry when the close button is used', async () => {
    const { article, host, router } = await mountReaderHistory()
    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await nextTick()
    expect(host.querySelector('#reader-settings[open]')).not.toBeNull()

    host.querySelector<HTMLButtonElement>('[aria-label="关闭阅读设置"]')?.click()
    await vi.waitFor(() => {
      expect(host.querySelector('#reader-settings')).toBeNull()
      expect(router.currentRoute.value.fullPath).toBe(`/read/${article.id}`)
    })

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
      expect(host.textContent).toContain('Library')
    })
  })

  it('reopens Reader settings from the forward history entry without adding back debt', async () => {
    const { article, host, router } = await mountReaderHistory()
    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await nextTick()

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('#reader-settings')).toBeNull()
      expect(router.currentRoute.value.fullPath).toBe(`/read/${article.id}`)
    })

    router.forward()
    await vi.waitFor(() => {
      expect(host.querySelector('#reader-settings[open]')).not.toBeNull()
      expect(router.currentRoute.value.fullPath).toBe(`/read/${article.id}`)
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('#reader-settings')).toBeNull()
    })
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it('adopts a Reader settings marker after a document reload', async () => {
    const firstSourceHistory = createMemoryHistory()
    firstSourceHistory.replace('/read/reload')
    const first = createCoordinatedRouterHistory(firstSourceHistory)
    const firstLayer = first.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => '/read/reload',
    })
    expect(firstLayer.activate()).toBe(true)
    const markerState = structuredClone(firstSourceHistory.state)
    first.history.destroy()

    const reloadedSourceHistory = createMemoryHistory()
    reloadedSourceHistory.replace('/read/reload')
    reloadedSourceHistory.push('/read/reload', markerState)
    const reloaded = createCoordinatedRouterHistory(reloadedSourceHistory)
    const onActivate = vi.fn()
    const onDeactivate = vi.fn()
    const reloadedLayer = reloaded.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate,
      origin: () => '/read/reload',
    })

    expect(onActivate).toHaveBeenCalledTimes(1)
    await reloadedLayer.deactivate()
    expect(onDeactivate).toHaveBeenCalledTimes(1)
    expect(reloadedSourceHistory.location).toBe('/read/reload')
    reloaded.history.destroy()
  })

  it('does not revive a history layer marker after its route origin changes', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [{
        path: '/read/:articleId',
        component: defineComponent({
          setup: () => () => h('p', 'Reader'),
        }),
      }],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/read/a')
    await router.isReady()
    const onActivate = vi.fn()
    const onDeactivate = vi.fn()
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate,
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)

    await router.push('/read/b')
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/read/a')
      expect(router.currentRoute.value.fullPath).toBe('/read/a')
    })

    expect(sourceHistory.state).not.toHaveProperty('__yomuRouteHistoryLayer')
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onDeactivate).toHaveBeenCalledTimes(1)
    layer.dispose()
    const onReloadActivate = vi.fn()
    coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: onReloadActivate,
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(onReloadActivate).not.toHaveBeenCalled()

    router.forward()
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/read/b')
      expect(router.currentRoute.value.fullPath).toBe('/read/b')
    })
    expect(onReloadActivate).not.toHaveBeenCalled()
    coordinated.history.destroy()
  })

  it('adopts a multi-step Forward marker when the Reader route instance is reused', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [{
        path: '/read/:articleId',
        component: defineComponent({
          setup: () => () => h('p', 'Reader'),
        }),
      }],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/read/b')
    await router.isReady()
    const onActivate = vi.fn()
    const onDeactivate = vi.fn()
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate,
      origin: () => router.currentRoute.value.fullPath,
    })

    await router.push('/read/a')
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/b')
    })

    router.go(2)
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/read/a')
      expect(router.currentRoute.value.fullPath).toBe('/read/a')
      expect(onActivate).toHaveBeenCalledTimes(2)
    })

    await layer.deactivate()
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/b')
    })
    expect(onDeactivate).toHaveBeenCalledTimes(2)
    coordinated.history.destroy()
  })

  it('tombstones a multi-step Forward marker when its target has no layer owner', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        {
          path: '/import',
          component: defineComponent({ setup: () => () => h('p', 'Import') }),
        },
        {
          path: '/read/plain',
          component: defineComponent({ setup: () => () => h('p', 'Plain target') }),
        },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/plain')
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))
    layer.dispose()

    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/plain')
      expect(sourceHistory.state).not.toHaveProperty('__yomuRouteHistoryLayer')
    })
    coordinated.history.destroy()
  })

  it('keeps a multi-step Forward marker available after a target guard aborts', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        {
          path: '/import',
          component: defineComponent({ setup: () => () => h('p', 'Import') }),
        },
        {
          path: '/read/retry',
          component: defineComponent({ setup: () => () => h('p', 'Reader') }),
        },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/retry')
    const onActivate = vi.fn()
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    let abortNextArrival = true
    const removeGuard = router.beforeEach((to) => {
      if (abortNextArrival && to.fullPath === '/read/retry') {
        abortNextArrival = false
        return false
      }
      return true
    })
    router.go(2)
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    expect(onActivate).toHaveBeenCalledTimes(1)

    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/retry')
      expect(onActivate).toHaveBeenCalledTimes(2)
    })
    removeGuard()
    coordinated.history.destroy()
  })

  it('replaces a multi-step Forward marker when its target guard redirects', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        {
          path: '/import',
          component: defineComponent({ setup: () => () => h('p', 'Import') }),
        },
        {
          path: '/read/redirect',
          component: defineComponent({ setup: () => () => h('p', 'Reader') }),
        },
        {
          path: '/login',
          component: defineComponent({ setup: () => () => h('p', 'Login') }),
        },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/redirect')
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    let redirectArrival = true
    const removeGuard = router.beforeEach((to) => {
      if (redirectArrival && to.fullPath === '/read/redirect') {
        redirectArrival = false
        return {
          hash: '#complete',
          path: '/login',
          query: { via: 'reader' },
          state: { redirectedBy: 'reader-settings' },
        }
      }
      return true
    })
    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/login?via=reader#complete')
      expect(sourceHistory.location).toBe('/login?via=reader#complete')
    })
    expect(sourceHistory.state.redirectedBy).toBe('reader-settings')

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/redirect')
    })
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    removeGuard()
    coordinated.history.destroy()
  })

  it('replaces a same-URL state redirect without adding marker debt', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        { path: '/import', component: { template: '<p>Import</p>' } },
        { path: '/read/state', component: { template: '<p>Reader</p>' } },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/state')
    const onActivate = vi.fn()
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    let redirectArrival = true
    const removeGuard = router.beforeEach((to) => {
      if (redirectArrival && to.fullPath === '/read/state') {
        redirectArrival = false
        return {
          path: '/read/state',
          state: { stateOnly: 'preserved' },
        }
      }
      return true
    })
    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/state')
      expect(onActivate).toHaveBeenCalledTimes(2)
    })
    expect(sourceHistory.state.stateOnly).toBe('preserved')

    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))
    removeGuard()
    coordinated.history.destroy()
  })

  it('restores the origin when a replacement redirect continuation aborts', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        {
          path: '/import',
          component: defineComponent({ setup: () => () => h('p', 'Import') }),
        },
        {
          path: '/read/redirect-abort',
          component: defineComponent({ setup: () => () => h('p', 'Reader') }),
        },
        {
          path: '/login',
          component: defineComponent({ setup: () => () => h('p', 'Login') }),
        },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/redirect-abort')
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    let redirectArrival = true
    let abortReplacement = true
    const removeGuard = router.beforeEach((to) => {
      if (redirectArrival && to.fullPath === '/read/redirect-abort') {
        redirectArrival = false
        return '/login'
      }
      if (abortReplacement && to.fullPath === '/login') {
        abortReplacement = false
        return false
      }
      return true
    })
    router.go(2)
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })

    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/redirect-abort')
    })
    removeGuard()
    coordinated.history.destroy()
  })

  it('keeps a newer navigation when it supersedes a pending marker redirect', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        {
          path: '/import',
          component: defineComponent({ setup: () => () => h('p', 'Import') }),
        },
        {
          path: '/read/redirect-cancelled',
          component: defineComponent({ setup: () => () => h('p', 'Reader') }),
        },
        {
          path: '/login',
          component: defineComponent({ setup: () => () => h('p', 'Login') }),
        },
        {
          path: '/settings',
          component: defineComponent({ setup: () => () => h('p', 'Settings') }),
        },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/redirect-cancelled')
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    let redirectArrival = true
    let releaseLogin!: () => void
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve
    })
    let loginReached = false
    const removeGuard = router.beforeEach(async (to) => {
      if (redirectArrival && to.fullPath === '/read/redirect-cancelled') {
        redirectArrival = false
        return '/login'
      }
      if (to.fullPath === '/login') {
        loginReached = true
        await loginGate
      }
      return true
    })
    router.go(2)
    await vi.waitFor(() => expect(loginReached).toBe(true))

    await router.push('/settings')
    expect(sourceHistory.location).toBe('/settings')
    expect(router.currentRoute.value.fullPath).toBe('/settings')
    releaseLogin()
    await settleMicrotasks()
    expect(sourceHistory.location).toBe('/settings')
    expect(router.currentRoute.value.fullPath).toBe('/settings')

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/redirect-cancelled')
    })
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    removeGuard()
    coordinated.history.destroy()
  })

  it('clears an unclaimed marker arrival after a component leave guard aborts', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        { path: '/start', component: { template: '<p>Start</p>' } },
        { path: '/import', component: { template: '<p>Import</p>' } },
        { path: '/read/unclaimed', component: { template: '<p>Reader</p>' } },
        { path: '/login', component: { template: '<p>Login</p>' } },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/start')
    await router.push('/import')
    await router.push('/read/unclaimed')
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    const importRecord = router.currentRoute.value.matched.at(-1)
    const abortLeave = () => false as const
    importRecord?.leaveGuards.add(abortLeave)
    router.go(2)
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    importRecord?.leaveGuards.delete(abortLeave)

    let redirectPush = true
    const removeGuard = router.beforeEach((to) => {
      if (redirectPush && to.fullPath === '/read/unclaimed') {
        redirectPush = false
        return '/login'
      }
      return true
    })
    await router.push('/read/unclaimed')
    expect(router.currentRoute.value.fullPath).toBe('/login')
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/start'))
    removeGuard()
    coordinated.history.destroy()
  })

  it('restores an unclaimed marker arrival after a component redirect aborts', async () => {
    const sourceHistory = createMemoryHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [
        { path: '/import', component: { template: '<p>Import</p>' } },
        { path: '/read/unclaimed-redirect', component: { template: '<p>Reader</p>' } },
        { path: '/login', component: { template: '<p>Login</p>' } },
      ],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/import')
    await router.push('/read/unclaimed-redirect')
    const onActivate = vi.fn()
    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate,
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await layer.deactivate()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/import'))

    const importRecord = router.currentRoute.value.matched.at(-1)
    const redirectThenAbort = (to: { fullPath: string }) =>
      to.fullPath === '/read/unclaimed-redirect' ? '/login' : false
    importRecord?.leaveGuards.add(redirectThenAbort)
    router.go(2)
    await vi.waitFor(() => {
      expect(sourceHistory.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    importRecord?.leaveGuards.delete(redirectThenAbort)

    router.go(2)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/read/unclaimed-redirect')
      expect(onActivate).toHaveBeenCalledTimes(2)
    })
    coordinated.history.destroy()
  })

  it('releases the Reader settings pop fence when the route component unmounts', async () => {
    const { app, host, router } = await mountReaderHistory()
    host.querySelector<HTMLButtonElement>('[aria-label="阅读设置"]')?.click()
    await nextTick()
    expect(host.querySelector('#reader-settings[open]')).not.toBeNull()

    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
    router.back()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it('resumes the reader after a target route fails to load', async () => {
    const article = createArticle()
    const repositories = createMemoryLocalRepositories({ articles: [article] })
    const harness = createFakePlatformServices({ repositories })
    const router = createReaderTestRouter([
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
    ])
    await router.push(`/read/${article.id}`)
    await router.isReady()

    const app = createApp({
      setup: () => () => h(RouterView),
    })
    mountedApps.push(app)
    app.provide(interactionLayerKey, createInteractionLayerController())
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

function createReaderTestRouter(routes: RouteRecordRaw[]) {
  const coordinated = createCoordinatedRouterHistory(createMemoryHistory())
  const router = createRouter({
    history: coordinated.history,
    routes,
  })
  coordinated.coordinator.attachRouter(router)
  registerRouteLeaveCoordinator(router, coordinated.coordinator)
  return router
}

async function mountReaderHistory(article = createArticle()) {
  const repositories = createMemoryLocalRepositories({ articles: [article] })
  const harness = createFakePlatformServices({ repositories })
  const interactionLayer = createInteractionLayerController()
  const router = createReaderTestRouter([
    {
      path: '/settings',
      name: 'settings',
      component: defineComponent({
        setup: () => () => h('p', 'Settings'),
      }),
    },
    {
      path: '/',
      name: 'library',
      component: defineComponent({
        setup: () => () => h('p', 'Library'),
      }),
    },
    {
      path: '/read/:articleId',
      name: 'reader',
      component: ReaderView,
      props: true,
    },
  ])
  await router.replace('/settings')
  await router.push('/')
  await router.push(`/read/${article.id}`)
  await router.isReady()

  const app = createApp({
    setup: () => () => h(RouterView),
  })
  mountedApps.push(app)
  app.provide(interactionLayerKey, interactionLayer)
  app.provide(platformServicesKey, harness.services)
  app.use(router)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await vi.waitFor(() => expect(
    host.querySelector('[data-sentence-id="article-route:s1"]'),
  ).not.toBeNull())

  return { app, article, harness, host, interactionLayer, repositories, router }
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function createArticle(id = 'article-route'): ArticleRecord {
  return {
    id,
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
      id: `${id}:s${index + 1}`,
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
