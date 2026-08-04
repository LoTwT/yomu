/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { themeControllerKey } from '@/app/themePreference'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import type { ThemeController, ThemePreference, ThemeSnapshot } from '@/platform/themeController'
import {
  LEGACY_TODAY_ARTICLE_ID,
} from '@/views/library/libraryFixtures'

const mountedApps: Array<ReturnType<typeof createApp>> = []

beforeEach(() => {
  window.scrollTo = vi.fn()
})

async function mountAt(path: string) {
  const host = document.createElement('div')
  document.body.append(host)

  const router = createYomuRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const app = createApp(App)
  mountedApps.push(app)
  app.provide(platformServicesKey, createFakePlatformServices().services)
  app.provide(themeControllerKey, createTestThemeController())
  app.use(router)
  app.mount(host)
  await nextTick()

  return { host, router }
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

  it('renders each library article once with a stable article id', async () => {
    const { host } = await mountAt('/')
    const articleObjects = [...host.querySelectorAll<HTMLElement>('[data-article-id]')]
    const articleIds = articleObjects.map(element => element.dataset.articleId)

    expect(articleObjects).toHaveLength(4)
    expect(new Set(articleIds).size).toBe(articleIds.length)
    expect(host.querySelectorAll('.article-collection')).toHaveLength(1)
    expect(host.querySelectorAll('.article-object__link')).toHaveLength(4)
    expect(host.querySelectorAll('.article-object__progress')).toHaveLength(4)
    expect(host.querySelectorAll('.article-object__link span[lang="en"]')).toHaveLength(4)
    expect(host.querySelectorAll('.article-object__summary[lang="en"]')).toHaveLength(4)
    expect(host.querySelector('.continue-card__title[lang="en"]')).not.toBeNull()
    expect(host.querySelector('.continue-card__summary[lang="en"]')).not.toBeNull()
    expect(host.querySelector('.recommendation-card__title[lang="en"]')).not.toBeNull()
    expect(host.querySelector('.recommendation-card__summary[lang="en"]')).not.toBeNull()
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.article-object__link')) {
      expect(link.getAttribute('href')).toBe(`/unavailable/${link.closest('[data-article-id]')?.getAttribute('data-article-id')}`)
      expect(link.getAttribute('aria-label')).toContain('尚未接入')
      expect(link.getAttribute('title')).toBe('尚未接入')
    }
    expect(host.querySelector('.recommendation-card__link')?.getAttribute('href'))
      .toBe('/unavailable/pride-and-prejudice-excerpt')
    expect(host.querySelector('.recommendation-card__link')?.getAttribute('aria-label'))
      .toContain('尚未接入')
    expect(host.querySelector('.recommendation-card__link svg')).not.toBeNull()
    expect(host.querySelector('.continue-card__button')?.getAttribute('href'))
      .toBe(`/read/${LEGACY_TODAY_ARTICLE_ID}`)
  })

  it('only opens the real Today article in the compatibility reader', async () => {
    const router = createYomuRouter(createMemoryHistory())

    await router.push(`/read/${LEGACY_TODAY_ARTICLE_ID}`)
    expect(router.currentRoute.value.name).toBe('legacy-reader')

    const { host, router: unavailableRouter } = await mountAt('/read/not-integrated')
    expect(unavailableRouter.currentRoute.value.name).toBe('article-unavailable')
    expect(unavailableRouter.currentRoute.value.fullPath).toBe('/unavailable/not-integrated')
    expect(host.querySelector('.shell-header')).not.toBeNull()
    expect(host.querySelector('h1')?.textContent).toContain('这篇文章还不能打开')
    expect(host.textContent).toContain('Yomu 不会用其他正文代替它')
    expect(host.textContent).toContain('not-integrated')
  })
})
