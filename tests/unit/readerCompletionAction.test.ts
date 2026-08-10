/** @vitest-environment jsdom */

import { createApp, h, nextTick, shallowRef, type App as VueApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReaderCompletionAction, {
  type ReaderCompletionState,
} from '@/components/reader/ReaderCompletionAction.vue'

const mountedApps: VueApp[] = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('ReaderCompletionAction', () => {
  it('offers an explicit completion action without implying that progress completes automatically', () => {
    const mounted = mountCompletionAction('idle')

    expect(mounted.host.textContent).toContain('读完这篇文章了吗？')
    const button = getButton(mounted.host)
    expect(button.textContent).toBe('完成阅读')
    expect(button.disabled).toBe(false)

    button.click()
    expect(mounted.complete).toHaveBeenCalledOnce()
    expect(mounted.openReview).not.toHaveBeenCalled()
  })

  it('disables duplicate completion while saving and exposes an accessible failure retry', async () => {
    const mounted = mountCompletionAction('saving')

    expect(getButton(mounted.host).disabled).toBe(true)
    expect(mounted.host.querySelector('[role="status"]')?.textContent)
      .toContain('保存最终进度')

    mounted.errorMessage.value = '本次阅读暂时无法完成。'
    mounted.state.value = 'error'
    await nextTick()

    expect(mounted.host.querySelector('[role="alert"]')?.textContent?.trim())
      .toBe('本次阅读暂时无法完成。')
    expect(getButton(mounted.host).textContent).toBe('重试完成阅读')
  })

  it('opens the durable review without completing the attempt a second time', () => {
    const mounted = mountCompletionAction('completed')

    expect(mounted.host.textContent).toContain('本次阅读已保存')
    getButton(mounted.host).click()

    expect(mounted.openReview).toHaveBeenCalledOnce()
    expect(mounted.complete).not.toHaveBeenCalled()
  })
})

function mountCompletionAction(initialState: ReaderCompletionState) {
  const state = shallowRef<ReaderCompletionState>(initialState)
  const errorMessage = shallowRef('')
  const complete = vi.fn()
  const openReview = vi.fn()
  const app = createApp({
    setup: () => () => h(ReaderCompletionAction, {
      state: state.value,
      errorMessage: errorMessage.value,
      onComplete: complete,
      onOpenReview: openReview,
    }),
  })
  mountedApps.push(app)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  return { app, complete, errorMessage, host, openReview, state }
}

function getButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button')
  if (!button) {
    throw new Error('Expected the completion action button.')
  }
  return button
}
