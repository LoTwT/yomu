/** @vitest-environment jsdom */

import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import ReadingReviewSummary from '@/components/review/ReadingReviewSummary.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('ReadingReviewSummary', () => {
  it('renders the completed reading facts and both next actions', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'library', component: defineComponent(() => () => h('div')) },
        {
          path: '/read/:articleId',
          name: 'reader',
          component: defineComponent(() => () => h('div')),
        },
      ],
    })
    await router.push('/')
    await router.isReady()
    const host = document.createElement('div')
    document.body.append(host)
    let rereadCount = 0
    const app = createApp(ReadingReviewSummary, {
      articleTitle: 'A Quiet Reading',
      activeDurationSec: 125,
      completedAt: '2026-08-10T08:05:00.000Z',
      rereadState: 'idle',
      sourceLabel: 'Example Journal',
      onReread: () => {
        rereadCount += 1
      },
    })
    mountedApps.push(app)
    app.use(router)
    app.mount(host)

    expect(host.textContent).toContain('阅读完成')
    expect(host.textContent).toContain('A Quiet Reading')
    expect(host.textContent).toContain('实际耗时')
    expect(host.textContent).toContain('2 分 5 秒')
    expect(host.textContent).toContain('完成时间')
    expect(host.textContent).toContain('来源')
    expect(host.textContent).toContain('Example Journal')
    expect(host.querySelector('time')?.getAttribute('datetime'))
      .toBe('2026-08-10T08:05:00.000Z')
    expect(host.querySelector('time')?.textContent?.trim()).not.toBe('')

    const rereadButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('再读一次'))
    rereadButton?.click()
    expect(rereadCount).toBe(1)
    const links = [...host.querySelectorAll<HTMLAnchorElement>('a')]
    expect(links.find(link => link.textContent?.includes('返回阅读库'))?.getAttribute('href'))
      .toBe('/')
  })
})
