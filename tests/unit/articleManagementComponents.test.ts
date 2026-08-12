import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
} from '@/app/interactionLayer'
import type { ArticleRecord } from '@/data/entities'
import type { ArticleManagementDetails } from '@/features/library/articleCommands'
import type { LibraryArticleViewModel } from '@/features/library/libraryViewModel'
import ArticleCollection from '@/views/library/ArticleCollection.vue'
import ArticleManagementDialog, {
  type ArticleManagementCloseReason,
} from '@/views/library/ArticleManagementDialog.vue'
import type { LibraryArticleManageRequest } from '@/views/library/LibraryArticleItem.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('article management components', () => {
  it('keeps exactly two article tab stops and re-emits the independent management trigger', async () => {
    const requests: LibraryArticleManageRequest[] = []
    const restoreFocusArticleId = shallowRef<string | null>(null)
    const articles = [
      createLibraryArticle('article-one', 'First story'),
      createLibraryArticle('article-two', 'Second story'),
    ]
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'library', component: defineComponent(() => () => null) },
        { path: '/reader/:articleId', name: 'reader', component: defineComponent(() => () => null) },
      ],
    })
    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(ArticleCollection, {
        articles,
        restoreFocusArticleId: restoreFocusArticleId.value,
        onManage: (request: LibraryArticleManageRequest) => requests.push(request),
      }),
    })
    mountedApps.push(app)
    app.use(router)
    app.mount(host)
    await nextTick()

    const items = [...host.querySelectorAll<HTMLElement>('[data-article-id]')]
    expect(items).toHaveLength(2)
    items.forEach((item) => {
      expect(item.querySelectorAll('a[href], button:not([disabled])')).toHaveLength(2)
      expect(item.querySelector('[data-article-open]')).not.toBeNull()
    })

    restoreFocusArticleId.value = 'article-two'
    await settle()
    expect(document.activeElement).toBe(items[1]!.querySelector('[data-article-open]'))

    const managementButton = host.querySelector<HTMLButtonElement>(
      '[data-article-manage="article-two"]',
    )
    expect(managementButton).not.toBeNull()
    managementButton!.click()
    await nextTick()

    expect(requests).toEqual([{
      articleId: 'article-two',
      focusReturn: managementButton,
    }])
  })

  it('supports rename, source, destructive options, system close, and explicit focus return', async () => {
    const interactionLayer = createInteractionLayerController()
    const focusReturn = document.createElement('button')
    focusReturn.textContent = '管理文章'
    document.body.append(focusReturn)
    focusReturn.focus()

    const open = shallowRef(true)
    const closeReasons: ArticleManagementCloseReason[] = []
    const renamedTitles: string[] = []
    const deleteOptions: Array<{ deleteContextlessTerms: boolean }> = []
    const openedSources: string[] = []
    const details = createManagementDetails()
    const Root = defineComponent({
      setup: () => () => open.value
        ? h(ArticleManagementDialog, {
            details,
            focusReturn,
            onClose: (reason: ArticleManagementCloseReason) => {
              closeReasons.push(reason)
              open.value = false
            },
            onDelete: (options: { deleteContextlessTerms: boolean }) => {
              deleteOptions.push(options)
            },
            onOpenSource: (url: string) => openedSources.push(url),
            onRename: (title: string) => renamedTitles.push(title),
          })
        : null,
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(Root)
    mountedApps.push(app)
    app.provide(interactionLayerKey, interactionLayer)
    app.mount(host)
    await settle()

    const dialog = host.querySelector<HTMLDialogElement>('dialog[open]')
    const heading = host.querySelector<HTMLHeadingElement>('h2')
    expect(dialog).not.toBeNull()
    expect(dialog?.hasAttribute('data-modal-fallback')).toBe(true)
    expect(document.activeElement).toBe(heading)
    expect(interactionLayer.activeLayerId.value).toBe('article-management:article-one')

    findButton(host, '重命名').click()
    await settle()
    const titleInput = host.querySelector<HTMLInputElement>('input[type="text"]')
    expect(titleInput).not.toBeNull()
    expect(document.activeElement).toBe(titleInput)
    titleInput!.value = '  Renamed story  '
    titleInput!.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector('form')!.dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(renamedTitles).toEqual(['Renamed story'])

    findButton(host, '取消').click()
    await settle()
    findButton(host, '来源详情').click()
    await settle()
    expect(host.textContent).toContain('网页链接')
    expect(host.textContent).toContain('Example publisher')
    expect(host.textContent).toContain('Ada Author')
    expect(host.textContent).toContain('1924')
    expect(host.textContent).toContain('User-provided content.')
    findButton(host, '打开来源').click()
    expect(openedSources).toEqual(['https://example.com/story'])

    findButton(host, '返回').click()
    await settle()
    findButton(host, '删除文章').click()
    await settle()
    expect(host.textContent).toContain('2 条阅读记录')
    expect(host.textContent).toContain('3 条收藏词原句上下文')
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }))
    host.querySelector('form')!.dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(deleteOptions).toEqual([{ deleteContextlessTerms: true }])

    expect(interactionLayer.requestCloseTop('system-back')).toBe(true)
    await settle()
    expect(closeReasons).toEqual(['system-back'])
    expect(host.querySelector('dialog')).toBeNull()
    expect(interactionLayer.activeLayerId.value).toBeNull()
    expect(document.activeElement).toBe(focusReturn)
  })

  it('shows command errors and disables mutation controls while busy', async () => {
    const interactionLayer = createInteractionLayerController()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(ArticleManagementDialog, {
        busy: true,
        details: createManagementDetails(),
        errorMessage: '无法保存更改，请重试。',
      }),
    })
    mountedApps.push(app)
    app.provide(interactionLayerKey, interactionLayer)
    app.mount(host)
    await settle()

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法保存更改')
    const actionButtons = [...host.querySelectorAll<HTMLButtonElement>('.article-action-menu button')]
    expect(actionButtons).toHaveLength(3)
    expect(actionButtons.every(button => button.disabled)).toBe(true)
  })
})

function createLibraryArticle(id: string, title: string): LibraryArticleViewModel {
  return {
    id,
    title,
    sourceLabel: 'Example publisher',
    levelLabel: 'B1',
    estimatedMinutes: 4,
    progress: 25,
    lastOpenedLabel: '刚刚',
    status: '阅读中',
  }
}

function createManagementDetails(): ArticleManagementDetails {
  return {
    article: createArticle(),
    attemptCount: 2,
    vocabularyContextCount: 3,
    contextlessTermCount: 1,
  }
}

function createArticle(): ArticleRecord {
  return {
    id: 'article-one',
    schemaVersion: 2,
    contentHash: 'article-hash',
    title: 'Original story',
    language: 'en',
    level: 'B1',
    source: {
      kind: 'url',
      label: 'Example publisher',
      url: 'https://example.com/story',
      author: 'Ada Author',
      publicationYear: '1924',
    },
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
    sentences: [{
      id: 'sentence-one',
      order: 0,
      paragraphIndex: 0,
      textHash: 'sentence-hash',
      original: 'A short sentence.',
      tokens: [{ id: 'token-one', text: 'short', kind: 'word' }],
    }],
    factSources: [],
    wordCount: 3,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.includes(label))
  if (!button) {
    throw new Error(`Expected a button containing "${label}".`)
  }
  return button
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
