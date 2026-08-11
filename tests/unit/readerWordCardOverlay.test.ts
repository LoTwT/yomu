import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
} from '@/app/interactionLayer'
import ReaderWordCardOverlay, {
  type ReaderWordCardActionState,
  type ReaderWordCardCloseReason,
} from '@/components/reader/ReaderWordCardOverlay.vue'
import type { ArticleTokenRecord } from '@/data/entities'

const mountedApps: Array<ReturnType<typeof createApp>> = []
const nativeDialogShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'show',
)
const nativeDialogShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
)
const nativeDialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close',
)

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
  vi.unstubAllGlobals()
  restoreDialogMethod('show', nativeDialogShow)
  restoreDialogMethod('showModal', nativeDialogShowModal)
  restoreDialogMethod('close', nativeDialogClose)
})

describe('ReaderWordCardOverlay', () => {
  it('waits for durable saved state before exposing save or remove', async () => {
    const harness = mountOverlay({
      token: {
        id: 'token-patience',
        text: 'patience',
        kind: 'word',
        ipa: '/ˈpeɪʃəns/',
      },
    })
    await nextTick()
    await nextTick()

    const dialog = harness.host.querySelector<HTMLDialogElement>('dialog')!
    const heading = harness.host.querySelector<HTMLHeadingElement>('h2')!
    const action = harness.host.querySelector<HTMLButtonElement>(
      '.reader-word-card-overlay__saved-action',
    )!
    expect(dialog.open).toBe(true)
    expect(dialog.hasAttribute('data-modal-fallback')).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')
    expect(document.activeElement).toBe(heading)
    expect(harness.host.textContent).toContain('/ˈpeɪʃəns/')
    expect(harness.host.textContent).not.toContain('//ˈpeɪʃəns//')
    expect(harness.host.textContent).toContain('暂无本地释义')
    expect(harness.host.querySelector('[role="status"]')?.textContent)
      .toContain('正在读取收藏状态…')
    expect(action.disabled).toBe(true)
    expect(action.textContent).toContain('正在读取收藏状态…')
    expect(action.hasAttribute('aria-pressed')).toBe(false)

    action.click()
    expect(harness.saveCount.value).toBe(0)
    expect(harness.removeCount.value).toBe(0)

    harness.actionState.value = 'idle'
    await nextTick()
    expect(action.disabled).toBe(false)
    expect(action.getAttribute('aria-pressed')).toBe('false')
    expect(action.textContent).toContain('收藏单词')

    action.click()
    await nextTick()
    expect(harness.saveCount.value).toBe(1)
    expect(action.textContent).toContain('收藏单词')

    harness.saved.value = true
    await nextTick()
    expect(action.getAttribute('aria-pressed')).toBe('true')
    expect(action.textContent).toContain('取消收藏')
    action.click()
    expect(harness.removeCount.value).toBe(1)

    harness.actionState.value = 'saving'
    await nextTick()
    expect(action.disabled).toBe(true)
    expect(harness.host.querySelector('[role="status"]')?.textContent)
      .toContain('正在取消收藏')
  })

  it('emits explicit actions, reports errors, and restores focus after a system close', async () => {
    const harness = mountOverlay({
      actionState: 'idle',
      errorMessage: '暂时无法保存这个词。',
      saved: true,
      token: {
        id: 'token-shape',
        text: 'shape',
        kind: 'word',
        meaning: '状态、形态',
      },
    })
    await nextTick()
    await nextTick()

    expect(harness.host.textContent).toContain('状态、形态')
    expect(harness.host.querySelector('[role="alert"]')?.textContent)
      .toContain('暂时无法保存这个词。')
    expect(harness.focusReturn.hasAttribute('inert')).toBe(true)
    expect(harness.interactionLayer.requestCloseTop('system-back')).toBe(true)
    await nextTick()
    await nextTick()

    expect(harness.closeReasons).toEqual(['system-back'])
    expect(harness.host.querySelector('dialog')).toBeNull()
    expect(harness.interactionLayer.activeLayerId.value).toBeNull()
    expect(harness.focusReturn.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(harness.focusReturn)
  })

  it('positions the fine-pointer card from its anchor and closes through its named control', async () => {
    const harness = mountOverlay({
      actionState: 'idle',
      finePointerPopover: true,
      token: {
        id: 'token-reader',
        text: 'reader',
        kind: 'word',
        meaning: '读者',
      },
    })
    await nextTick()
    await nextTick()

    const dialog = harness.host.querySelector<HTMLDialogElement>('dialog')!
    expect(harness.show).toHaveBeenCalledOnce()
    expect(harness.showModal).not.toHaveBeenCalled()
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(dialog.hasAttribute('data-modal-fallback')).toBe(false)
    expect(document.querySelector('.reader-word-card-overlay__fallback-backdrop')).toBeNull()
    expect(harness.focusReturn.hasAttribute('inert')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('')
    harness.focusReturn.focus()
    expect(document.activeElement).toBe(harness.focusReturn)
    expect(dialog.style.getPropertyValue('--reader-word-card-inline-start')).not.toBe('')
    expect(dialog.style.getPropertyValue('--reader-word-card-block-start')).not.toBe('')

    const close = harness.host.querySelector<HTMLButtonElement>('[aria-label="关闭词卡"]')!
    close.click()
    await nextTick()
    await nextTick()

    expect(harness.closeReasons).toEqual(['close-button'])
    expect(document.activeElement).toBe(harness.focusReturn)
  })

  it('reopens the same layer when pointer presentation changes without losing state or focus', async () => {
    const harness = mountOverlay({
      actionState: 'saving',
      finePointerPopover: true,
      saved: true,
      token: {
        id: 'token-responsive',
        text: 'responsive',
        kind: 'word',
        meaning: '响应式的',
      },
    })
    await nextTick()
    await nextTick()

    const dialog = harness.host.querySelector<HTMLDialogElement>('dialog')!
    const closeButton = harness.host.querySelector<HTMLButtonElement>('[aria-label="关闭词卡"]')!
    const action = harness.host.querySelector<HTMLButtonElement>(
      '.reader-word-card-overlay__saved-action',
    )!
    const inlineStart = dialog.style.getPropertyValue('--reader-word-card-inline-start')
    const blockStart = dialog.style.getPropertyValue('--reader-word-card-block-start')
    closeButton.focus()

    expect(harness.presentation.listenerCount()).toBe(1)
    expect(action.textContent).toContain('正在取消收藏')
    expect(harness.show).toHaveBeenCalledOnce()
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')

    harness.presentation.setMatches(false)
    await settlePresentationChange()

    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(harness.showModal).toHaveBeenCalledOnce()
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('hidden')
    expect(document.activeElement).toBe(closeButton)
    expect(dialog.style.getPropertyValue('--reader-word-card-inline-start')).toBe(inlineStart)
    expect(dialog.style.getPropertyValue('--reader-word-card-block-start')).toBe(blockStart)
    expect(action.textContent).toContain('正在取消收藏')
    expect(action.disabled).toBe(true)
    expect(harness.closeReasons).toEqual([])
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')

    harness.presentation.setMatches(true)
    await settlePresentationChange()

    expect(harness.close).toHaveBeenCalledTimes(2)
    expect(harness.show).toHaveBeenCalledTimes(2)
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('')
    expect(document.activeElement).toBe(closeButton)
    expect(action.textContent).toContain('正在取消收藏')
    expect(harness.closeReasons).toEqual([])
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')

    closeButton.click()
    await nextTick()
    await nextTick()
    expect(harness.closeReasons).toEqual(['close-button'])
    expect(harness.presentation.listenerCount()).toBe(0)
    expect(harness.host.querySelector('dialog')).toBeNull()
  })

  it('uses the newest focus return after a keyed remount', async () => {
    const harness = mountOverlay({
      actionState: 'idle',
      token: {
        id: 'token-remount-a',
        text: 'first',
        kind: 'word',
      },
    })
    await nextTick()
    await nextTick()

    const nextFocusReturn = document.createElement('button')
    nextFocusReturn.textContent = '下一句'
    document.body.append(nextFocusReturn)
    harness.remount(nextFocusReturn)
    await nextTick()
    await nextTick()

    expect(harness.closeReasons).toEqual([])
    expect(harness.presentation.listenerCount()).toBe(1)
    expect(harness.interactionLayer.activeLayerId.value).toBe('reader-word-card')
    expect(harness.interactionLayer.requestCloseTop('system-back')).toBe(true)
    await nextTick()
    await nextTick()

    expect(harness.closeReasons).toEqual(['system-back'])
    expect(harness.presentation.listenerCount()).toBe(0)
    expect(document.activeElement).toBe(nextFocusReturn)
    expect(document.activeElement).not.toBe(harness.focusReturn)
  })
})

interface MountOverlayOptions {
  actionState?: ReaderWordCardActionState
  errorMessage?: string
  finePointerPopover?: boolean
  saved?: boolean
  token: ArticleTokenRecord
}

function mountOverlay(options: MountOverlayOptions) {
  const presentation = createControlledMediaQuery(
    '(min-width: 768px) and (pointer: fine)',
    options.finePointerPopover === true,
  )
  vi.stubGlobal('matchMedia', vi.fn(() => presentation.mediaQueryList))
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    queueMicrotask(() => this.dispatchEvent(new Event('close')))
  })
  if (options.finePointerPopover) {
    Object.defineProperties(HTMLDialogElement.prototype, {
      close: {
        configurable: true,
        value: close,
      },
      show: {
        configurable: true,
        value: show,
      },
      showModal: {
        configurable: true,
        value: showModal,
      },
    })
  }
  const interactionLayer = createInteractionLayerController()
  const focusReturn = document.createElement('button')
  focusReturn.textContent = '原句'
  const anchor = document.createElement('span')
  anchor.textContent = options.token.text
  anchor.getBoundingClientRect = vi.fn(() => ({
    bottom: 240,
    height: 24,
    left: 480,
    right: 520,
    top: 216,
    width: 40,
    x: 480,
    y: 216,
    toJSON: () => ({}),
  }))
  document.body.append(focusReturn, anchor)
  focusReturn.focus()

  const open = shallowRef(true)
  const overlayKey = shallowRef(0)
  const focusReturnProp = shallowRef<HTMLElement>(focusReturn)
  const actionState = shallowRef<ReaderWordCardActionState | undefined>(options.actionState)
  const errorMessage = shallowRef(options.errorMessage ?? '')
  const saved = shallowRef(options.saved ?? false)
  const saveCount = shallowRef(0)
  const removeCount = shallowRef(0)
  const closeReasons: ReaderWordCardCloseReason[] = []
  const Root = defineComponent({
    setup: () => () => open.value
      ? h(ReaderWordCardOverlay, {
          key: overlayKey.value,
          actionState: actionState.value,
          anchor,
          errorMessage: errorMessage.value,
          focusReturn: focusReturnProp.value,
          saved: saved.value,
          token: options.token,
          onClose: (reason: ReaderWordCardCloseReason) => {
            closeReasons.push(reason)
            open.value = false
          },
          onRemove: () => {
            removeCount.value += 1
          },
          onSave: () => {
            saveCount.value += 1
          },
        })
      : null,
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Root)
  mountedApps.push(app)
  app.provide(interactionLayerKey, interactionLayer)
  app.mount(host)

  return {
    actionState,
    close,
    closeReasons,
    focusReturn,
    host,
    interactionLayer,
    presentation,
    removeCount,
    remount: (nextFocusReturn: HTMLElement) => {
      focusReturnProp.value = nextFocusReturn
      overlayKey.value += 1
    },
    saved,
    saveCount,
    show,
    showModal,
  }
}

function restoreDialogMethod(
  name: 'close' | 'show' | 'showModal',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
  }
  else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, name)
  }
}

interface ControlledMediaQuery {
  listenerCount: () => number
  mediaQueryList: MediaQueryList
  setMatches: (matches: boolean) => void
}

function createControlledMediaQuery(query: string, initialMatches: boolean): ControlledMediaQuery {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const legacyListeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQueryList = {
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      legacyListeners.add(listener)
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      legacyListeners.delete(listener)
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList

  return {
    listenerCount: () => listeners.size + legacyListeners.size,
    mediaQueryList,
    setMatches: (nextMatches: boolean) => {
      matches = nextMatches
      const event = { matches, media: query } as MediaQueryListEvent
      listeners.forEach(listener => listener(event))
      legacyListeners.forEach(listener => listener(event))
    },
  }
}

async function settlePresentationChange(): Promise<void> {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
