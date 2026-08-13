import { Buffer } from 'node:buffer'

import { expect, test, type Page, type Route } from '@playwright/test'

import { isArticleRecord, type ArticleRecord } from '../../src/data/entities'

interface MimoRequestBody {
  apiKey?: string
  baseUrl?: string
  sentenceId: string
  text?: string
}

interface CanonicalSpeechProbeSnapshot {
  abortedSentenceIds: string[]
  audioConstructCount: number
  audioPlayCount: number
  playedAudioPayloads: string[]
  spokenTexts: string[]
}

const cloudSentences = [
  'The first cloud sentence should be spoken only after explicit consent.',
  'The second sentence is prefetched and waits for the current audio to end.',
  'The third sentence completes the intentionally small prefetch window.',
  'The fourth sentence must remain local until continuous reading reaches it.',
] as const

const cloudArticle = createArticle(
  'canonical-cloud-speech',
  'Canonical Cloud Speech',
  cloudSentences,
)

const destinationArticle = createArticle(
  'canonical-cloud-destination',
  'A Different Canonical Article',
  [
    'A separate article proves that a late response cannot revive old playback.',
    'Its own reading session starts idle and independent from the previous one.',
    'No cloud audio should be constructed merely by opening this article.',
  ],
)

const currentSentenceId = cloudArticle.sentences[0]!.id
const prefetchedSentenceIds = cloudArticle.sentences.slice(1, 3).map(sentence => sentence.id)

test.beforeEach(async ({ page }) => {
  await installCanonicalSpeechProbe(page)
  await installRememberedMimoByok(page)
})

test('requires consent before MiMo sends text, then requests current plus two and plays only current', async ({ page }) => {
  const requests: MimoRequestBody[] = []
  await page.route('**/api/tts/mimo', async (route) => {
    const body = readMimoRequest(route)
    requests.push(body)
    await fulfillMimoAudio(route, body.sentenceId)
  })
  await openCanonicalReader(page)

  await page.getByRole('button', { name: '朗读当前句' }).click()

  const consent = page.locator('.reader-speech-settings__consent')
  await expect(consent).toBeVisible()
  await expect(consent).toContainText('是否发送当前句到 MiMo？')
  await expect(consent).toContainText('当前句与后两句')
  expect(requests).toEqual([])

  await consent.getByRole('button', { name: '同意并朗读' }).click()

  await expect.poll(() => requests.map(request => request.sentenceId).sort()).toEqual([
    currentSentenceId,
    ...prefetchedSentenceIds,
  ].sort())
  expect(requests).toHaveLength(3)
  expect(requests.every(request => request.apiKey === 'e2e-mimo-key')).toBe(true)
  expect(requests.every(request => request.baseUrl === 'https://api.xiaomimimo.com/v1')).toBe(true)
  expect(requests.find(request => request.sentenceId === currentSentenceId)?.text)
    .toBe(cloudSentences[0])

  await expect.poll(() => readCanonicalSpeechProbe(page)).toMatchObject({
    audioConstructCount: 1,
    audioPlayCount: 1,
    playedAudioPayloads: [`audio:${currentSentenceId}`],
    spokenTexts: [],
  })
  await expect(page.locator(`[data-sentence-id="${currentSentenceId}"]`))
    .toHaveAttribute('data-playing', 'true')

  await finishCloudAudio(page)

  const secondSentenceId = cloudArticle.sentences[1]!.id
  await expect(page.locator(`[data-sentence-id="${secondSentenceId}"]`))
    .toHaveAttribute('aria-current', 'true')
  await expect(page.locator(`[data-sentence-id="${secondSentenceId}"]`))
    .toHaveAttribute('data-playing', 'true')
  await expect(page.locator('[data-sentence-id][aria-current="true"]')).toHaveCount(1)
  await expect.poll(() => readCanonicalSpeechProbe(page)).toMatchObject({
    audioConstructCount: 2,
    audioPlayCount: 2,
    playedAudioPayloads: [
      `audio:${currentSentenceId}`,
      `audio:${secondSentenceId}`,
    ],
    spokenTexts: [],
  })

  const expectedContinuousWindow = cloudArticle.sentences.map(sentence => sentence.id).sort()
  await expect.poll(() => requests.map(request => request.sentenceId).sort())
    .toEqual(expectedContinuousWindow)
  expect(requests).toHaveLength(expectedContinuousWindow.length)
  expect(new Set(requests.map(request => request.sentenceId)).size)
    .toBe(expectedContinuousWindow.length)

  await page.waitForTimeout(100)
  await expect(page.locator('[data-sentence-id][aria-current="true"]'))
    .toHaveAttribute('data-sentence-id', secondSentenceId)
})

test('declining cloud consent keeps sentence text local and makes no MiMo request', async ({ page }) => {
  const requests: MimoRequestBody[] = []
  await page.route('**/api/tts/mimo', async (route) => {
    const body = readMimoRequest(route)
    requests.push(body)
    await fulfillMimoAudio(route, body.sentenceId)
  })
  await openCanonicalReader(page)

  await page.getByRole('button', { name: '朗读当前句' }).click()
  const consent = page.locator('.reader-speech-settings__consent')
  await expect(consent).toBeVisible()
  await expect(consent).toContainText('是否发送当前句到 MiMo？')
  await consent.getByRole('button', { name: '暂不发送' }).click()

  await expect(consent).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toHaveCount(0)
  await page.getByRole('button', { name: '朗读当前句' }).click()
  await expect(page.locator('.reader-speech-settings__consent'))
    .toBeVisible()
  await expectNoMimoRequest(page)
  expect(requests).toEqual([])
  await expect.poll(() => readCanonicalSpeechProbe(page)).toMatchObject({
    audioConstructCount: 0,
    audioPlayCount: 0,
    spokenTexts: [],
  })
})

test('keeps compact consent focus visible and deep-links the speech settings target', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await openCanonicalReader(page)

  await page.getByRole('button', { name: '朗读当前句' }).click()

  const dialog = page.getByRole('dialog', { name: '调整当前阅读' })
  const consentAction = dialog.getByRole('button', { name: '同意并朗读' })
  await expect(consentAction).toBeFocused()
  await expect.poll(() => consentAction.evaluate((element) => {
    const scrollport = element.closest('dialog')
      ?.querySelector<HTMLElement>('.reader-settings-overlay__body')
    if (!scrollport) {
      return false
    }
    const targetBounds = element.getBoundingClientRect()
    const scrollportBounds = scrollport.getBoundingClientRect()
    const visibleTop = Math.max(0, scrollportBounds.top)
    const visibleBottom = Math.min(innerHeight, scrollportBounds.bottom)
    return targetBounds.top >= visibleTop - 1
      && targetBounds.bottom <= visibleBottom + 1
  })).toBe(true)

  await dialog.getByRole('button', { name: '管理语音服务' }).click()

  await expect(page).toHaveURL(/\/settings#settings-speech-title$/)
  const speechHeading = page.getByRole('heading', { level: 2, name: '语音' })
  await expect(speechHeading).toBeFocused()
  await expect.poll(() => speechHeading.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return scrollY > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight
  })).toBe(true)
})

test('restores the native speech rate selection in forced colors', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium forced-colors coverage')
  await page.emulateMedia({ forcedColors: 'active' })
  await openCanonicalReader(page)

  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  const rateGroup = page.getByRole('group', { name: '语速' })
  const selectedRate = rateGroup.getByRole('radio', { name: '1×', exact: true })
  const slowerRate = rateGroup.getByRole('radio', { name: '0.85×', exact: true })

  await expect(rateGroup.getByRole('radio')).toHaveCount(3)
  await expect(selectedRate).toBeVisible()
  await expect(selectedRate).toBeChecked()
  await expect(slowerRate).toBeVisible()
  await expect(slowerRate).not.toBeChecked()

  const nativePresentation = await selectedRate.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const styles = getComputedStyle(element)
    return {
      height: bounds.height,
      opacity: styles.opacity,
      position: styles.position,
      width: bounds.width,
    }
  })
  expect(nativePresentation.height).toBeGreaterThanOrEqual(16)
  expect(nativePresentation.width).toBeGreaterThanOrEqual(16)
  expect(nativePresentation.opacity).toBe('1')
  expect(nativePresentation.position).toBe('static')
  expect(await selectedRate.evaluate((element) => {
    const styles = getComputedStyle(element.closest('label')!)
    return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth }
  })).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' })
  expect(await slowerRate.evaluate((element) =>
    getComputedStyle(element.closest('label')!).outlineStyle)).toBe('none')
})

test('falls back from a MiMo 502 to Web Speech for the current sentence and advances exactly once', async ({ page }) => {
  const requests: MimoRequestBody[] = []
  await page.route('**/api/tts/mimo', async (route) => {
    requests.push(readMimoRequest(route))
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The speech provider is temporarily unavailable.' }),
    })
  })
  await openCanonicalReader(page)

  await page.getByRole('button', { name: '朗读当前句' }).click()
  await page.getByRole('button', { name: '同意并朗读' }).click()

  await expect.poll(async () => (await readCanonicalSpeechProbe(page)).spokenTexts).toEqual([
    cloudSentences[0],
  ])
  await expect(page.getByRole('status')).toContainText('已改用浏览器朗读当前句')
  await expect(page.locator(`[data-sentence-id="${currentSentenceId}"]`))
    .toHaveAttribute('data-playing', 'true')
  await expect.poll(() => requests.map(request => request.sentenceId).sort()).toEqual([
    currentSentenceId,
    ...prefetchedSentenceIds,
  ].sort())

  await finishWebSpeech(page)

  const secondSentenceId = cloudArticle.sentences[1]!.id
  await expect(page.locator(`[data-sentence-id="${secondSentenceId}"]`))
    .toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => (await readCanonicalSpeechProbe(page)).spokenTexts).toEqual([
    cloudSentences[0],
    cloudSentences[1],
  ])
  await page.waitForTimeout(100)
  const stableProbe = await readCanonicalSpeechProbe(page)
  expect(stableProbe.spokenTexts).toEqual([cloudSentences[0], cloudSentences[1]])
  await expect(page.locator('[data-sentence-id][aria-current="true"]'))
    .toHaveAttribute('data-sentence-id', secondSentenceId)
})

test('cancels a delayed current request on article change and ignores its late response', async ({ page }) => {
  const currentEntered = createDeferred<void>()
  const releaseCurrent = createDeferred<void>()
  const currentRouteSettled = createDeferred<void>()
  const requests: MimoRequestBody[] = []

  await page.route('**/api/tts/mimo', async (route) => {
    const body = readMimoRequest(route)
    requests.push(body)
    if (body.sentenceId !== currentSentenceId) {
      await fulfillMimoAudio(route, body.sentenceId)
      return
    }

    currentEntered.resolve()
    await releaseCurrent.promise
    try {
      await fulfillMimoAudio(route, body.sentenceId)
    }
    catch {
      // A real browser may retire an aborted route before Playwright releases it.
    }
    finally {
      currentRouteSettled.resolve()
    }
  })
  await openCanonicalReader(page, [cloudArticle, destinationArticle])

  await page.getByRole('button', { name: '朗读当前句' }).click()
  await page.getByRole('button', { name: '同意并朗读' }).click()
  await currentEntered.promise
  await expect.poll(() => requests.map(request => request.sentenceId).sort()).toEqual([
    currentSentenceId,
    ...prefetchedSentenceIds,
  ].sort())
  await expect.poll(() => readCanonicalSpeechProbe(page)).toMatchObject({
    audioConstructCount: 0,
    audioPlayCount: 0,
  })

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page).toHaveURL('/')
  await expect.poll(async () => (await readCanonicalSpeechProbe(page)).abortedSentenceIds)
    .toContain(currentSentenceId)
  await page.locator(`[data-article-id="${destinationArticle.id}"] [data-article-open]`).click()
  await expect(page).toHaveURL(new RegExp(`/read/${destinationArticle.id}$`))
  await expect(page.getByRole('heading', { name: destinationArticle.title }).last()).toBeVisible()

  releaseCurrent.resolve()
  await currentRouteSettled.promise
  await page.waitForTimeout(100)

  const probe = await readCanonicalSpeechProbe(page)
  expect(probe.audioConstructCount).toBe(0)
  expect(probe.audioPlayCount).toBe(0)
  expect(probe.playedAudioPayloads).toEqual([])
  await expect(page.locator('[data-playing="true"]')).toHaveCount(0)
})

async function openCanonicalReader(
  page: Page,
  articles: readonly ArticleRecord[] = [cloudArticle],
): Promise<void> {
  await seedArticlesInIndexedDb(page, articles)
  await page.goto(`/read/${cloudArticle.id}`)
  await expect(page).toHaveURL(new RegExp(`/read/${cloudArticle.id}$`))
  await expect(page.getByRole('heading', { name: cloudArticle.title }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: '朗读当前句' })).toBeEnabled()
}

async function installRememberedMimoByok(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'yomu:v2:preference:provider:tts:mimo:remember-on-device',
      JSON.stringify(true),
    )
    localStorage.setItem(
      'yomu:v2:preference:provider:tts',
      JSON.stringify({
        schemaVersion: 2,
        provider: 'mimo',
        mimo: {
          baseUrl: 'https://api.xiaomimimo.com/v1',
          model: 'mimo-v2.5-tts',
          voice: 'Mia',
          format: 'mp3',
        },
      }),
    )
    localStorage.setItem('yomu:v2:secret:tts:mimo', 'e2e-mimo-key')
  })
}

async function seedArticlesInIndexedDb(
  page: Page,
  articles: readonly ArticleRecord[],
): Promise<void> {
  expect(articles.every(isArticleRecord)).toBe(true)
  await page.goto('/')
  await expect(page.getByTestId('library-empty-state')).toBeVisible()
  await page.evaluate(async (records) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yomu-v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('articles', 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(
          transaction.error ?? new Error('Canonical speech article seed was aborted.'),
        )
        transaction.onerror = () => reject(
          transaction.error ?? new Error('Canonical speech article seed failed.'),
        )
        records.forEach(record => transaction.objectStore('articles').put(record))
      })
    }
    finally {
      database.close()
    }
  }, articles)
}

async function installCanonicalSpeechProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spokenTexts: string[] = []
    const playedAudioPayloads: string[] = []
    const abortedSentenceIds: string[] = []
    let audioConstructCount = 0
    let audioPlayCount = 0
    let activeAudio: ProbeAudio | null = null
    let activeUtterance: ProbeSpeechSynthesisUtterance | null = null
    const nativeFetch = window.fetch.bind(window)
    const nativeCreateObjectUrl = URL.createObjectURL.bind(URL)
    const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL)
    const objectUrlPayloads = new Map<string, Promise<string>>()

    class ProbeSpeechSynthesisUtterance extends EventTarget {
      lang = ''
      rate = 1
      text: string
      voice: SpeechSynthesisVoice | null = null
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(text = '') {
        super()
        this.text = text
      }
    }

    class ProbeAudio extends EventTarget {
      preload = ''
      playbackRate = 1
      src: string

      constructor(src = '') {
        super()
        this.src = src
        audioConstructCount += 1
      }

      async play(): Promise<void> {
        audioPlayCount += 1
        const payload = objectUrlPayloads.get(this.src)
        if (!payload) {
          throw new Error('The Audio probe received an unknown object URL.')
        }
        playedAudioPayloads.push(await payload)
        activeAudio = this
      }

      pause(): void {
        if (activeAudio === this) {
          activeAudio = null
        }
      }

      load(): void {}

      removeAttribute(name: string): void {
        if (name === 'src') {
          this.src = ''
        }
      }
    }

    const wrappedFetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      if (url.includes('/api/tts/mimo') && init?.signal) {
        let sentenceId = ''
        if (typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body) as { sentenceId?: unknown }
            sentenceId = typeof body.sentenceId === 'string' ? body.sentenceId : ''
          }
          catch {}
        }
        const recordAbort = (): void => {
          if (sentenceId && !abortedSentenceIds.includes(sentenceId)) {
            abortedSentenceIds.push(sentenceId)
          }
        }
        if (init.signal.aborted) {
          recordAbort()
        }
        else {
          init.signal.addEventListener('abort', recordAbort, { once: true })
        }
      }
      return nativeFetch(input, init)
    }

    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: wrappedFetch,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value(blob: Blob) {
        const sourceUrl = nativeCreateObjectUrl(blob)
        objectUrlPayloads.set(sourceUrl, blob.text())
        return sourceUrl
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value(sourceUrl: string) {
        objectUrlPayloads.delete(sourceUrl)
        nativeRevokeObjectUrl(sourceUrl)
      },
    })
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: ProbeAudio,
    })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: ProbeSpeechSynthesisUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {
          activeUtterance = null
        },
        getVoices: () => [],
        pause() {},
        resume() {},
        speak(utterance: ProbeSpeechSynthesisUtterance) {
          activeUtterance = utterance
          spokenTexts.push(utterance.text)
          utterance.onstart?.()
        },
      },
    })
    Object.defineProperty(window, '__canonicalSpeechProbe', {
      configurable: true,
      value: {
        abortedSentenceIds,
        get audioConstructCount() {
          return audioConstructCount
        },
        get audioPlayCount() {
          return audioPlayCount
        },
        finishAudio() {
          const audio = activeAudio
          if (!audio) {
            return false
          }
          audio.dispatchEvent(new Event('ended'))
          return true
        },
        finishWebSpeech() {
          const utterance = activeUtterance
          activeUtterance = null
          utterance?.onend?.()
        },
        playedAudioPayloads,
        spokenTexts,
      },
    })
  })
}

async function readCanonicalSpeechProbe(page: Page): Promise<CanonicalSpeechProbeSnapshot> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __canonicalSpeechProbe: CanonicalSpeechProbeSnapshot
    }).__canonicalSpeechProbe
    return {
      abortedSentenceIds: [...probe.abortedSentenceIds],
      audioConstructCount: probe.audioConstructCount,
      audioPlayCount: probe.audioPlayCount,
      playedAudioPayloads: [...probe.playedAudioPayloads],
      spokenTexts: [...probe.spokenTexts],
    }
  })
}

async function finishWebSpeech(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as {
      __canonicalSpeechProbe: { finishWebSpeech: () => void }
    }).__canonicalSpeechProbe
    probe.finishWebSpeech()
  })
}

async function finishCloudAudio(page: Page): Promise<void> {
  const finished = await page.evaluate(() => {
    const probe = (window as unknown as {
      __canonicalSpeechProbe: { finishAudio: () => boolean }
    }).__canonicalSpeechProbe
    return probe.finishAudio()
  })
  expect(finished).toBe(true)
}

async function expectNoMimoRequest(page: Page): Promise<void> {
  const observedRequest = await Promise.race([
    page.waitForRequest(request => request.url().includes('/api/tts/mimo'), { timeout: 200 })
      .then(() => true, () => false),
    page.waitForTimeout(250).then(() => false),
  ])
  expect(observedRequest).toBe(false)
}

function readMimoRequest(route: Route): MimoRequestBody {
  return route.request().postDataJSON() as MimoRequestBody
}

async function fulfillMimoAudio(route: Route, sentenceId: string): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'cache-control': 'no-store',
      pragma: 'no-cache',
    },
    body: JSON.stringify({
      audioBase64: Buffer.from(`audio:${sentenceId}`).toString('base64'),
      mimeType: 'audio/mpeg',
      durationMs: 900,
    }),
  })
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function createArticle(
  id: string,
  title: string,
  sentences: readonly string[],
): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `${id}-content`,
    title,
    description: 'A browser-only canonical Reader speech fixture.',
    language: 'en',
    level: 'B1',
    source: {
      kind: 'paste',
      label: 'Canonical speech E2E fixture',
    },
    rights: {
      status: 'user-provided-unknown',
      note: 'User-provided test content.',
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    capabilities: {
      sentenceTranslation: 'none',
      sentenceIpa: 'none',
      tokenMeaning: 'none',
    },
    sentences: sentences.map((original, order) => ({
      id: `${id}:s${order + 1}`,
      order,
      paragraphIndex: 0,
      textHash: `${id}-sentence-${order + 1}`,
      original,
      tokens: [],
    })),
    factSources: [],
    wordCount: sentences.reduce((total, sentence) => total + sentence.split(/\s+/).length, 0),
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-13T08:00:00.000Z',
    updatedAt: '2026-08-13T08:00:00.000Z',
  }
}
