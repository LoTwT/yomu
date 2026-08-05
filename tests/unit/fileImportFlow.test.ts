/** @vitest-environment jsdom */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import { platformServicesKey } from '@/app/platformServices'
import { createYomuRouter } from '@/app/router'
import { themeControllerKey } from '@/app/themePreference'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
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

async function mountImport(options: FakePlatformOptions = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createYomuRouter(createMemoryHistory())
  await router.push('/import')
  await router.isReady()

  const repositories = createMemoryLocalRepositories()
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

  return { host, harness, router }
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
