/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory, type RouterHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { themeControllerKey } from '@/app/themePreference'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'
import {
  createFakePlatformServices,
  type FakePlatformOptions,
} from '@/platform/fake/createFakePlatformServices'
import { RemoteServiceError } from '@/platform/contracts'
import type { ThemeController, ThemePreference, ThemeSnapshot } from '@/platform/themeController'

const readableEnglish = [
  'A careful reader can bring a short English article into a quiet local library.',
  'The file stays on this device while Yomu separates the text into useful reading sentences.',
  'A clear preview makes it easy to check the source before beginning a focused session.',
].join(' ')

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

describe('file import flow', () => {
  it('creates a file preview through the platform picker and keeps the file for retry', async () => {
    const fileName = 'reading-notes.md'
    const { host } = await mountImport({
      files: [{
        name: fileName,
        size: readableEnglish.length,
        mediaType: 'text/markdown',
        text: async () => readableEnglish,
      }],
    })

    clickButton(host, 'TXT / Markdown')
    await nextTick()
    clickButton(host, '选择文件')
    await settleView()

    expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    expect(readLabeledControl(host, '来源').value).toBe(fileName)
    expect(readLabeledControl(host, '标题').value).toContain('A careful reader')

    clickButton(host, '选择其他文件')
    await nextTick()
    expect(host.querySelector('[data-testid="file-drop-zone"]')?.textContent).toContain(fileName)
    expect(findButton(host, '重新生成预览').disabled).toBe(false)
  })

  it('preserves a pasted draft while the user checks the file source', async () => {
    const { host } = await mountImport()
    const pastedDraft = 'A draft remains available while another import source is inspected.'
    const body = readLabeledControl(host, '英文正文')
    body.value = pastedDraft
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    clickButton(host, 'TXT / Markdown')
    await nextTick()
    expect(host.querySelector('[data-testid="file-drop-zone"]')).not.toBeNull()

    clickButton(host, '粘贴文本')
    await nextTick()
    expect(readLabeledControl(host, '英文正文').value).toBe(pastedDraft)
  })

  it('protects a pasted draft from navigation while the file source is active', async () => {
    const { host, router } = await mountImport()
    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    clickButton(host, 'TXT / Markdown')
    await nextTick()

    const navigation = router.push('/settings')
    await settleView()

    expect(host.querySelector('dialog[open]')).not.toBeNull()
    expect(router.currentRoute.value.path).toBe('/import')

    clickButton(host, '继续编辑')
    await navigation
    expect(router.currentRoute.value.path).toBe('/import')
  })

  it('closes the confirmation before handling Escape or native back and restores focus', async () => {
    const { host, harness, router } = await mountImport({ kind: 'mobile' })
    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const settingsLink = host.querySelector<HTMLAnchorElement>('a[href="/settings"]')
    expect(settingsLink).not.toBeNull()
    settingsLink?.focus()

    const escapeNavigation = router.push('/settings')
    await settleView()
    expect(document.activeElement?.textContent).toContain('继续编辑')

    const handledEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.activeElement?.addEventListener('keydown', event => event.preventDefault(), {
      once: true,
    })
    document.activeElement?.dispatchEvent(handledEscape)
    await settleView()
    expect(handledEscape.defaultPrevented).toBe(true)
    expect(host.querySelector('dialog[open]')).not.toBeNull()

    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.activeElement?.dispatchEvent(escapeEvent)
    await escapeNavigation
    await settleView()

    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(router.currentRoute.value.path).toBe('/import')
    expect(host.querySelector('dialog[open]')).toBeNull()
    expect(document.activeElement).toBe(settingsLink)

    const nativeBackNavigation = router.push('/settings')
    await settleView()
    expect(host.querySelector('dialog[open]')).not.toBeNull()

    harness.backNavigation.emit('android')
    await nativeBackNavigation
    await settleView()

    expect(router.currentRoute.value.path).toBe('/import')
    expect(host.querySelector('dialog[open]')).toBeNull()
    expect(document.activeElement).toBe(settingsLink)
  })

  it('leaves focus management to the destination after discarding a draft', async () => {
    const { host, router } = await mountImport()
    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const settingsLink = host.querySelector<HTMLAnchorElement>('a[href="/settings"]')
    settingsLink?.focus()
    const navigation = router.push('/settings')
    await settleView()

    clickButton(host, '放弃并离开')
    await navigation
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/settings')
    })
    await settleView()

    expect(document.activeElement).toBe(host.querySelector('h1'))
  })

  it('keeps a saved article recoverable when its automatic navigation closes a dialog', async () => {
    const gatedRepositories = createGatedPersistentRepositories()
    const { host, router } = await mountImport({
      repositories: gatedRepositories.repositories,
    })
    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    clickButton(host, '生成预览')
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    })

    clickButton(host, '保存并开始阅读')
    await gatedRepositories.started
    expect(findButton(host, '正在保存…').disabled).toBe(true)

    const settingsNavigation = router.push('/settings')
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    gatedRepositories.release()
    await settingsNavigation

    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/import')
      expect(host.querySelector('[data-testid="import-saved-state"]')).not.toBeNull()
      expect(host.querySelector('dialog[open]')).toBeNull()
    })
    expect(findButton(host, '开始阅读').disabled).toBe(false)
    expect(host.textContent).not.toContain('正在保存…')

    clickButton(host, '开始阅读')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('reader')
    })
  })

  it('closes one confirmation and settles both concurrent route intents', async () => {
    const { host, router } = await mountImport()
    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const firstNavigation = router.push('/settings')
    await settleView()
    expect(host.querySelectorAll('dialog[open]')).toHaveLength(1)

    const secondNavigation = router.push('/words')
    await Promise.all([firstNavigation, secondNavigation])
    await settleView()

    expect(router.currentRoute.value.path).toBe('/import')
    expect(host.querySelector('dialog[open]')).toBeNull()

    const finalNavigation = router.push('/settings')
    await settleView()
    expect(host.querySelectorAll('dialog[open]')).toHaveLength(1)
    clickButton(host, '放弃并离开')
    await finalNavigation

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/settings')
    })
  })

  it('continues the original replace navigation with its state and history position', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const navigation = router.replace({
      path: '/settings',
      state: { navigationMarker: 'original-replace' },
    })
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')

    expect(await navigation).toBeUndefined()
    expect(history.location).toBe('/settings')
    expect(history.state).toMatchObject({ navigationMarker: 'original-replace' })

    router.back()
    await vi.waitFor(() => {
      expect(history.location).toBe('/')
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it('keeps Vue Router latest-wins semantics for concurrent navigation intents', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const firstNavigation = router.push({
      path: '/settings',
      state: { navigationMarker: 'superseded-push' },
    })
    const latestNavigation = router.replace({
      path: '/words',
      state: { navigationMarker: 'latest-replace' },
    })
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')

    await Promise.all([firstNavigation, latestNavigation])
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/words')
    })
    expect(history.state).toMatchObject({ navigationMarker: 'latest-replace' })

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it.each([
    { kind: 'desktop', source: 'desktop' },
    { kind: 'mobile', source: 'android' },
  ] as const)(
    'keeps the import route coherent after rapid $kind back events',
    async ({ kind, source }) => {
      const { harness, history, host, router } = await mountImport({ kind })
      await router.replace('/settings')
      await router.push('/')
      await router.push('/import')
      await settleView()

      const body = readLabeledControl(host, '英文正文')
      body.value = readableEnglish
      body.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      harness.backNavigation.emit(source)
      harness.backNavigation.emit(source)

      await vi.waitFor(() => {
        expect(host.querySelector('dialog[open]')).not.toBeNull()
      })
      clickButton(host, '继续编辑')

      await vi.waitFor(() => {
        expect(history.location).toBe('/import')
        expect(router.currentRoute.value.fullPath).toBe('/import')
      })
      expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
      expect(host.querySelector('dialog[open]')).toBeNull()
    },
  )

  it('continues browser-style back without duplicating its destination', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')

    await vi.waitFor(() => {
      expect(history.location).toBe('/')
      expect(router.currentRoute.value.fullPath).toBe('/')
    })

    router.back()
    await vi.waitFor(() => {
      expect(history.location).toBe('/settings')
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
  })

  it('allows an accepted browser back to follow a route-guard redirect', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const removeRedirect = router.beforeResolve((to) => {
      if (to.path === '/settings') {
        return { path: '/words' }
      }
      return true
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')

    await vi.waitFor(() => {
      expect(history.location).toBe('/words')
      expect(router.currentRoute.value.fullPath).toBe('/words')
    })
    removeRedirect()
  })

  it.each([
    { finalDestination: '/words', rejectFinalRedirect: false },
    { finalDestination: '/import', rejectFinalRedirect: true },
  ])(
    'coordinates a route-record and guard redirect chain to $finalDestination',
    async ({ finalDestination, rejectFinalRedirect }) => {
      const deferredHistory = createDeferredPopHistory()
      const { host, router } = await mountImport({}, deferredHistory)
      await router.replace('/settings')
      deferredHistory.push('/today')
      await router.push('/import')
      await settleView()

      const body = readLabeledControl(host, '英文正文')
      body.value = readableEnglish
      body.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      const removeRedirect = router.beforeResolve((to) => {
        if (to.path === '/legacy') {
          return { path: '/words' }
        }
        if (to.path === '/words' && rejectFinalRedirect) {
          return false
        }
        return true
      })

      router.back()
      deferredHistory.flushNext()
      await vi.waitFor(() => {
        expect(host.querySelector('dialog[open]')).not.toBeNull()
      })
      clickButton(host, '放弃并离开')

      if (rejectFinalRedirect) {
        await vi.waitFor(() => {
          expect(deferredHistory.pendingCount()).toBe(1)
        })
        deferredHistory.flushNext()
      }
      await vi.waitFor(() => {
        expect(deferredHistory.location).toBe(finalDestination)
        expect(router.currentRoute.value.fullPath).toBe(finalDestination)
      })
      if (rejectFinalRedirect) {
        expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
      }
      removeRedirect()
    },
  )

  it('repairs the guarded origin when a redirected browser back is rejected', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const removeRedirect = router.beforeResolve((to) => {
      if (to.path === '/settings') {
        return { path: '/words' }
      }
      if (to.path === '/words') {
        return false
      }
      return true
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')

    await vi.waitFor(() => {
      expect(history.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
    removeRedirect()
    const nextNavigation = router.push('/words')
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await nextNavigation
    expect(router.currentRoute.value.fullPath).toBe('/words')
  })

  it('tracks the guarded origin across same-route query updates', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/')
    await router.push('/import')
    await router.push('/import?variant=1')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    router.go(-2)
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    router.back()
    await settleView()

    await vi.waitFor(() => {
      expect(history.location).toBe('/import?variant=1')
      expect(router.currentRoute.value.fullPath).toBe('/import?variant=1')
    })
    expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
  })

  it('repairs a clamped memory-history traversal to its actual origin', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/import')
    await router.push('/words')
    await router.back()
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    router.go(-100)
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '继续编辑')

    await vi.waitFor(() => {
      expect(history.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
  })

  it('rebases another back while the accepted pop target is still resolving', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let releaseTarget!: () => void
    let reportTargetStarted!: () => void
    const targetGate = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    const targetStarted = new Promise<void>((resolve) => {
      reportTargetStarted = resolve
    })
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path === '/') {
        reportTargetStarted()
        await targetGate
      }
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await targetStarted

    router.back()
    await vi.waitFor(() => {
      expect(history.location).toBe('/settings')
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })

    releaseTarget()
    await settleView()
    expect(history.location).toBe('/settings')
    expect(router.currentRoute.value.fullPath).toBe('/settings')

    router.forward()
    await vi.waitFor(() => {
      expect(history.location).toBe('/')
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
    removeTargetGuard()
  })

  it('restores the origin when a blocked push cancels the accepted pop', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let releaseTarget!: () => void
    let reportTargetStarted!: () => void
    const targetGate = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    const targetStarted = new Promise<void>((resolve) => {
      reportTargetStarted = resolve
    })
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path === '/') {
        reportTargetStarted()
        await targetGate
      }
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await targetStarted

    await router.push('/words')
    releaseTarget()
    await vi.waitFor(() => {
      expect(history.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    expect(readLabeledControl(host, '英文正文').value).toBe(readableEnglish)
    removeTargetGuard()
  })

  it('does not transfer an accepted pop to an independent same-target push', async () => {
    const { history, host, router } = await mountImport()
    await router.replace('/settings')
    await router.push('/words')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let reportFirstTargetStarted!: () => void
    let releaseFirstTarget!: () => void
    const firstTargetStarted = new Promise<void>((resolve) => {
      reportFirstTargetStarted = resolve
    })
    const firstTargetGate = new Promise<void>((resolve) => {
      releaseFirstTarget = resolve
    })
    let wordsNavigationCount = 0
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path !== '/words') {
        return
      }
      wordsNavigationCount += 1
      if (wordsNavigationCount === 1) {
        reportFirstTargetStarted()
        await firstTargetGate
      }
    })

    router.back()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await firstTargetStarted

    const competingFailure = await router.push('/words')
    expect(competingFailure).toBeDefined()
    releaseFirstTarget()
    await vi.waitFor(() => {
      expect(history.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })

    const freshNavigation = router.push('/words')
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await freshNavigation
    expect(history.location).toBe('/words')
    expect(router.currentRoute.value.fullPath).toBe('/words')

    router.back()
    await vi.waitFor(() => {
      expect(history.location).toBe('/import')
      expect(router.currentRoute.value.fullPath).toBe('/import')
    })
    removeTargetGuard()
  })

  it.each(['cancelled', 'aborted', 'error'] as const)(
    'does not let an older %s same-URL pop settle the current history generation',
    async (olderOutcome) => {
      const { history, host, router } = await mountImport()
      await router.replace('/settings')
      await router.push('/words')
      await router.push('/settings')
      await router.push('/import')
      await settleView()

      const body = readLabeledControl(host, '英文正文')
      body.value = readableEnglish
      body.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      let firstTargetStarted!: () => void
      let secondTargetStarted!: () => void
      let resolveFirstTarget!: (result?: false) => void
      let rejectFirstTarget!: (reason: Error) => void
      let releaseSecondTarget!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        firstTargetStarted = resolve
      })
      const secondStarted = new Promise<void>((resolve) => {
        secondTargetStarted = resolve
      })
      const firstGate = new Promise<void | false>((resolve, reject) => {
        resolveFirstTarget = resolve
        rejectFirstTarget = reject
      })
      const secondGate = new Promise<void>((resolve) => {
        releaseSecondTarget = resolve
      })
      let settingsNavigationCount = 0
      const removeTargetGuard = router.beforeResolve(async (to) => {
        if (to.path !== '/settings') {
          return
        }
        settingsNavigationCount += 1
        if (settingsNavigationCount === 1) {
          firstTargetStarted()
          return firstGate
        }
        secondTargetStarted()
        await secondGate
      })

      router.back()
      await vi.waitFor(() => {
        expect(host.querySelector('dialog[open]')).not.toBeNull()
      })
      clickButton(host, '放弃并离开')
      await firstStarted

      router.go(-2)
      await secondStarted
      if (olderOutcome === 'error') {
        rejectFirstTarget(new Error('The older same-URL target failed.'))
      }
      else {
        resolveFirstTarget(olderOutcome === 'aborted' ? false : undefined)
      }
      await settleView()
      releaseSecondTarget()

      await vi.waitFor(() => {
        expect(history.location).toBe('/settings')
        expect(router.currentRoute.value.fullPath).toBe('/settings')
      })
      removeTargetGuard()
    },
  )

  it('keeps a committed same-URL generation anchored until an older async rollback settles', async () => {
    const deferredHistory = createDeferredPopHistory()
    const { host, router } = await mountImport({}, deferredHistory)
    await router.replace('/settings')
    await router.push('/words')
    await router.push('/settings')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let firstTargetStarted!: () => void
    let secondTargetStarted!: () => void
    let rejectFirstTarget!: (reason: Error) => void
    let releaseSecondTarget!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      firstTargetStarted = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      secondTargetStarted = resolve
    })
    const firstGate = new Promise<void>((_resolve, reject) => {
      rejectFirstTarget = reject
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecondTarget = resolve
    })
    let settingsNavigationCount = 0
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path !== '/settings') {
        return
      }
      settingsNavigationCount += 1
      if (settingsNavigationCount === 1) {
        firstTargetStarted()
        return firstGate
      }
      secondTargetStarted()
      await secondGate
    })
    const removeErrorHandler = router.onError(() => {})

    router.back()
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await firstStarted

    router.go(-2)
    deferredHistory.flushNext()
    await secondStarted
    rejectFirstTarget(new Error('The older async target failed.'))
    await vi.waitFor(() => {
      expect(deferredHistory.pendingCount()).toBe(1)
    })

    releaseSecondTarget()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(deferredHistory.pendingCount()).toBe(1)
    })
    deferredHistory.flushNext()

    await vi.waitFor(() => {
      expect(deferredHistory.location).toBe('/settings')
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
    removeErrorHandler()
    removeTargetGuard()
  })

  it('keeps a generation position while a stale rollback is physically visible', async () => {
    const deferredHistory = createDeferredPopHistory()
    const { host, router } = await mountImport({}, deferredHistory)
    await router.replace('/settings')
    await router.push('/words')
    await router.push('/settings')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let firstTargetStarted!: () => void
    let secondTargetStarted!: () => void
    let rejectFirstTarget!: (reason: Error) => void
    let releaseSecondTarget!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      firstTargetStarted = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      secondTargetStarted = resolve
    })
    const firstGate = new Promise<void>((_resolve, reject) => {
      rejectFirstTarget = reject
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecondTarget = resolve
    })
    let settingsNavigationCount = 0
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path !== '/settings') {
        return
      }
      settingsNavigationCount += 1
      if (settingsNavigationCount === 1) {
        firstTargetStarted()
        return firstGate
      }
      secondTargetStarted()
      await secondGate
    })
    const removeErrorHandler = router.onError(() => {})

    router.back()
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await firstStarted

    router.go(-2)
    deferredHistory.flushNext()
    await secondStarted
    rejectFirstTarget(new Error('The older async target failed.'))
    await vi.waitFor(() => {
      expect(deferredHistory.pendingCount()).toBe(1)
    })
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(deferredHistory.location).toBe('/words')
      expect(deferredHistory.pendingCount()).toBe(1)
    })

    releaseSecondTarget()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
    deferredHistory.flushNext()

    await vi.waitFor(() => {
      expect(deferredHistory.location).toBe('/settings')
      expect(router.currentRoute.value.fullPath).toBe('/settings')
      expect(deferredHistory.pendingCount()).toBe(0)
    })
    removeErrorHandler()
    removeTargetGuard()
  })

  it.each(['/words', '/import?redirected=1'])(
    'settles a stale rollback before redirecting the pop to %s',
    async (redirectDestination) => {
      const deferredHistory = createDeferredPopHistory()
      const { host, router } = await mountImport({}, deferredHistory)
      await router.replace('/settings')
      await router.push('/words')
      await router.push('/settings')
      await router.push('/import')
      await settleView()

      const body = readLabeledControl(host, '英文正文')
      body.value = readableEnglish
      body.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      let firstTargetStarted!: () => void
      let secondTargetStarted!: () => void
      let rejectFirstTarget!: (reason: Error) => void
      let releaseSecondTarget!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        firstTargetStarted = resolve
      })
      const secondStarted = new Promise<void>((resolve) => {
        secondTargetStarted = resolve
      })
      const firstGate = new Promise<void>((_resolve, reject) => {
        rejectFirstTarget = reject
      })
      const secondGate = new Promise<void>((resolve) => {
        releaseSecondTarget = resolve
      })
      let settingsNavigationCount = 0
      const removeTargetGuard = router.beforeResolve(async (to) => {
        if (to.path !== '/settings') {
          return
        }
        settingsNavigationCount += 1
        if (settingsNavigationCount === 1) {
          firstTargetStarted()
          return firstGate
        }
        secondTargetStarted()
        await secondGate
        return redirectDestination
      })
      const removeErrorHandler = router.onError(() => {})

      router.back()
      deferredHistory.flushNext()
      await vi.waitFor(() => {
        expect(host.querySelector('dialog[open]')).not.toBeNull()
      })
      clickButton(host, '放弃并离开')
      await firstStarted

      router.go(-2)
      deferredHistory.flushNext()
      await secondStarted
      rejectFirstTarget(new Error('The older async target failed.'))
      await vi.waitFor(() => {
        expect(deferredHistory.pendingCount()).toBe(1)
      })
      releaseSecondTarget()
      await settleView()
      expect(router.currentRoute.value.fullPath).toBe('/import')

      deferredHistory.flushNext()
      await vi.waitFor(() => {
        expect(deferredHistory.pendingCount()).toBe(1)
      })
      deferredHistory.flushNext()

      await vi.waitFor(() => {
        expect(deferredHistory.location).toBe(redirectDestination)
        expect(router.currentRoute.value.fullPath).toBe(redirectDestination)
        expect(deferredHistory.pendingCount()).toBe(0)
      })
      removeErrorHandler()
      removeTargetGuard()
    },
  )

  it('serializes a new route push behind a committed history repair', async () => {
    const deferredHistory = createDeferredPopHistory()
    const { host, router } = await mountImport({}, deferredHistory)
    await router.replace('/settings')
    await router.push('/words')
    await router.push('/settings')
    await router.push('/import')
    await settleView()

    const body = readLabeledControl(host, '英文正文')
    body.value = readableEnglish
    body.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    let firstTargetStarted!: () => void
    let secondTargetStarted!: () => void
    let rejectFirstTarget!: (reason: Error) => void
    let releaseSecondTarget!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      firstTargetStarted = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      secondTargetStarted = resolve
    })
    const firstGate = new Promise<void>((_resolve, reject) => {
      rejectFirstTarget = reject
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecondTarget = resolve
    })
    let settingsNavigationCount = 0
    const removeTargetGuard = router.beforeResolve(async (to) => {
      if (to.path !== '/settings') {
        return
      }
      settingsNavigationCount += 1
      if (settingsNavigationCount === 1) {
        firstTargetStarted()
        return firstGate
      }
      secondTargetStarted()
      await secondGate
    })
    const removeErrorHandler = router.onError(() => {})

    router.back()
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(host.querySelector('dialog[open]')).not.toBeNull()
    })
    clickButton(host, '放弃并离开')
    await firstStarted

    router.go(-2)
    deferredHistory.flushNext()
    await secondStarted
    rejectFirstTarget(new Error('The older async target failed.'))
    await vi.waitFor(() => {
      expect(deferredHistory.pendingCount()).toBe(1)
    })

    releaseSecondTarget()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
    const nextNavigation = router.push('/words')
    await settleView()
    expect(router.currentRoute.value.fullPath).toBe('/settings')

    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(deferredHistory.pendingCount()).toBe(1)
    })
    deferredHistory.flushNext()
    await nextNavigation

    expect(deferredHistory.location).toBe('/words')
    expect(router.currentRoute.value.fullPath).toBe('/words')
    router.back()
    deferredHistory.flushNext()
    await vi.waitFor(() => {
      expect(deferredHistory.location).toBe('/settings')
      expect(router.currentRoute.value.fullPath).toBe('/settings')
    })
    removeErrorHandler()
    removeTargetGuard()
  })

  it('lets a user grant file permission from the file picker action', async () => {
    const fileName = 'permission-gated.txt'
    const { host } = await mountImport({
      capabilities: {
        fileImport: {
          availability: 'permission-required',
          reason: 'Choose a file to grant access.',
        },
      },
      files: [{
        name: fileName,
        size: readableEnglish.length,
        mediaType: 'text/plain',
        text: async () => readableEnglish,
      }],
    })

    const fileSource = findButton(host, 'TXT / Markdown')
    expect(fileSource.disabled).toBe(false)
    fileSource.click()
    await nextTick()
    clickButton(host, '选择文件')
    await settleView()

    expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    expect(readLabeledControl(host, '来源').value).toBe(fileName)
  })

  it('preserves the receiver of a platform file text method', async () => {
    class ReceiverBoundTextFile {
      readonly name = 'receiver-bound.txt'
      readonly mediaType = 'text/plain'
      readonly size = readableEnglish.length
      private readonly content = readableEnglish

      async text(): Promise<string> {
        return this.content
      }
    }

    const { host } = await mountImport({ files: [new ReceiverBoundTextFile()] })

    clickButton(host, 'TXT / Markdown')
    await nextTick()
    clickButton(host, '选择文件')
    await settleView()

    expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    expect(readLabeledControl(host, '来源').value).toBe('receiver-bound.txt')
  })

  it('focuses a recoverable error when a selected file is unsupported', async () => {
    const { host } = await mountImport({
      files: [{
        name: 'paper.pdf',
        size: 42,
        mediaType: 'application/pdf',
        text: async () => readableEnglish,
      }],
    })

    clickButton(host, 'TXT / Markdown')
    await nextTick()
    clickButton(host, '选择文件')
    await settleView()

    const heading = host.querySelector<HTMLElement>('#import-error-heading')
    expect(heading?.textContent).toContain('无法生成预览')
    expect(document.activeElement).toBe(heading)
    expect(host.textContent).toContain('目前只支持 .txt 和 .md 文件')
    expect(host.textContent).toContain('paper.pdf')
  })

  it('imports a dropped file without exposing the native file object to the view', async () => {
    const { host } = await mountImport({
      files: [{
        name: 'dropped-reading.txt',
        size: readableEnglish.length,
        mediaType: 'text/plain',
        text: async () => readableEnglish,
      }],
    })

    clickButton(host, 'TXT / Markdown')
    await nextTick()
    const dropZone = host.querySelector<HTMLElement>('[data-testid="file-drop-zone"]')
    dropZone?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await settleView()

    expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    expect(readLabeledControl(host, '来源').value).toBe('dropped-reading.txt')
  })

  it('disables the file source honestly when the platform adapter is unavailable', async () => {
    const { host } = await mountImport({ fileImportAvailable: false })

    const fileSource = findButton(host, 'TXT / Markdown 当前平台不可用')
    expect(fileSource.disabled).toBe(true)
    expect(fileSource.title).toContain('Fake file import is disabled')
    expect(findButton(host, '粘贴文本').disabled).toBe(false)
  })
})

describe('URL import flow', () => {
  it('creates a URL preview while keeping raw remote HTML behind platform adapters', async () => {
    const rawHtml = '<nav>REMOTE NAV MUST STAY HIDDEN</nav><article><h1>Remote reading</h1></article>'
    const { host, harness } = await mountImport({
      remoteHandler: async <TResponse>() => ({
        content: rawHtml,
        contentType: 'text/html; charset=utf-8',
        sourceUrl: 'https://example.com/final-story',
      } as TResponse),
      articleExtractionHandler: () => ({
        title: 'Remote reading',
        text: readableEnglish,
      }),
    })

    clickButton(host, 'URL Beta')
    await nextTick()
    const url = readLabeledControl(host, '文章网址')
    url.value = 'https://example.com/story'
    url.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    clickButton(host, '提取正文')
    await settleView()

    expect(host.querySelector('[data-testid="import-preview"]')).not.toBeNull()
    expect(readLabeledControl(host, '标题').value).toBe('Remote reading')
    expect(readLabeledControl(host, '来源').value).toBe('example.com')
    expect(host.textContent).not.toContain('REMOTE NAV MUST STAY HIDDEN')
    expect(harness.remote.requests[0]).toMatchObject({
      operation: 'url-import',
      body: { url: 'https://example.com/story' },
    })
    expect(harness.articleExtractor.inputs[0]?.content).toBe(rawHtml)
  })

  it('preserves the original URL through extraction failure and paste fallback', async () => {
    const originalUrl = 'https://example.com/unreadable'
    const { host } = await mountImport({
      remoteHandler: async () => {
        throw new RemoteServiceError(
          'url-import',
          502,
          'No readable article body could be extracted.',
          'url-unavailable',
          'url.unavailable',
        )
      },
    })

    clickButton(host, 'URL Beta')
    await nextTick()
    const url = readLabeledControl(host, '文章网址')
    url.value = originalUrl
    url.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    clickButton(host, '提取正文')
    await settleView()

    expect(readLabeledControl(host, '文章网址').value).toBe(originalUrl)
    expect(host.textContent).toContain('暂时无法访问这个网址')
    clickButton(host, '改为粘贴正文')
    await nextTick()
    expect(readLabeledControl(host, '英文正文').value).toBe('')

    clickButton(host, 'URL Beta')
    await nextTick()
    expect(readLabeledControl(host, '文章网址').value).toBe(originalUrl)
  })

  it('disables URL import honestly while the platform is offline', async () => {
    const { host } = await mountImport({ online: false })

    const urlSource = findButton(host, 'URL Beta 当前不可用')
    expect(urlSource.disabled).toBe(true)
    expect(urlSource.title).toContain('离线')
  })

  it('aborts an active URL import and exposes recovery when the platform goes offline', async () => {
    let finishRemote: ((value: unknown) => void) | null = null
    const { host, harness } = await mountImport({
      remoteHandler: <TResponse>() => new Promise<TResponse>((resolve) => {
        finishRemote = value => resolve(value as TResponse)
      }),
    })

    clickButton(host, 'URL Beta')
    await nextTick()
    const url = readLabeledControl(host, '文章网址')
    url.value = 'https://example.com/slow-story'
    url.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    clickButton(host, '提取正文')
    await nextTick()

    harness.network.setOnline(false)
    await settleView()

    expect(host.textContent).toContain('当前处于离线状态')
    expect(findButton(host, '改为粘贴正文').disabled).toBe(false)

    finishRemote?.({
      content: readableEnglish,
      contentType: 'text/plain',
      sourceUrl: 'https://example.com/slow-story',
    })
    await settleView()
    expect(host.querySelector('[data-testid="import-preview"]')).toBeNull()
  })

  it('disables URL import when the fake platform has no remote handler', async () => {
    const { host } = await mountImport()

    const urlSource = findButton(host, 'URL Beta 当前不可用')
    expect(urlSource.disabled).toBe(true)
    expect(urlSource.title).toContain('Fake URL import is disabled')
  })
})

async function mountImport(
  options: FakePlatformOptions = {},
  history: RouterHistory = createMemoryHistory(),
) {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createYomuRouter(history)
  await router.push('/import')
  await router.isReady()

  const repositories = options.repositories ?? createMemoryLocalRepositories()
  const harness = createFakePlatformServices({
    ...options,
    repositories,
  })
  const app = createApp(App)
  mountedApps.push(app)
  app.provide(platformServicesKey, harness.services)
  app.provide(themeControllerKey, createTestThemeController())
  app.use(router)
  app.mount(host)
  await settleView()

  return { history, host, harness, router }
}

interface DeferredPopHistory extends RouterHistory {
  flushNext: () => void
  pendingCount: () => number
}

function createDeferredPopHistory(): DeferredPopHistory {
  type Listener = Parameters<RouterHistory['listen']>[0]
  type NavigationInformation = Parameters<Listener>[2]
  const listeners = new Set<Listener>()
  const entries: Array<{ location: string, state: Record<string, unknown> }> = [
    { location: '', state: { position: 0 } },
  ]
  const pending: Array<{ delta: number, triggerListeners: boolean }> = []
  let position = 0

  const history: DeferredPopHistory = {
    base: '',
    get location() {
      return entries[position]?.location ?? ''
    },
    get state() {
      return entries[position]?.state ?? { position }
    },
    createHref: location => location,
    destroy() {
      listeners.clear()
      pending.length = 0
    },
    flushNext() {
      const command = pending.shift()
      if (!command) {
        throw new Error('No deferred history traversal is pending.')
      }
      const from = history.location
      const previousPosition = position
      position = Math.max(0, Math.min(position + command.delta, entries.length - 1))
      if (!command.triggerListeners) {
        return
      }
      const delta = position - previousPosition
      const direction: NavigationInformation['direction'] = delta < 0
        ? 'back' as NavigationInformation['direction']
        : delta > 0
          ? 'forward' as NavigationInformation['direction']
          : 'unknown' as NavigationInformation['direction']
      const information: NavigationInformation = {
        delta,
        direction,
        type: 'pop' as NavigationInformation['type'],
      }
      listeners.forEach(listener => listener(history.location, from, information))
    },
    go(delta, triggerListeners = true) {
      pending.push({ delta, triggerListeners })
    },
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    pendingCount: () => pending.length,
    push(location, state = {}) {
      position += 1
      entries.splice(position)
      entries.push({ location, state: { ...state, position } })
    },
    replace(location, state = {}) {
      entries[position] = { location, state: { ...state, position } }
    },
  }
  return history
}

function createGatedPersistentRepositories(): {
  repositories: LocalRepositories
  release: () => void
  started: Promise<void>
} {
  const base = createMemoryLocalRepositories()
  let release!: () => void
  let reportStarted!: () => void
  let gated = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve
  })
  const transaction: LocalRepositories['transaction'] = async (stores, mode, operation) => {
    if (!gated && mode === 'readwrite' && stores.includes('articles')) {
      gated = true
      reportStarted()
      await gate
    }
    return base.transaction(stores, mode, operation)
  }
  const repositories = new Proxy(base, {
    get(target, property) {
      if (property === 'persistence') {
        return 'persistent'
      }
      if (property === 'transaction') {
        return transaction
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as LocalRepositories

  return { repositories, release, started }
}

function findButton(host: HTMLElement, name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => normalizeText(candidate.textContent) === name)
  if (!button) {
    throw new Error(`Button not found: ${name}`)
  }
  return button
}

function clickButton(host: HTMLElement, name: string): void {
  findButton(host, name).click()
}

function readLabeledControl(host: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const field = [...host.querySelectorAll<HTMLLabelElement>('label')]
    .find(candidate => normalizeText(candidate.querySelector('span')?.textContent) === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (!field) {
    throw new Error(`Labeled control not found: ${label}`)
  }
  return field
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

async function settleView(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
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
