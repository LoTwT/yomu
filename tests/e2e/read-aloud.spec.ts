import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const articleId = 'daily-en-2026-05-25-why-the-brain-loves-sleep'
const articleTitle = 'Why the Brain Loves Sleep'
const firstSentence = 'Every night, your brain does quiet but important work while you sleep.'
const firstTranslationSnippet = '每天夜里'
const firstMeaningToken = {
  accessibleName: 'brain: 大脑',
  text: 'brain',
  ipa: '/breɪn/',
  storageId: 's1-t5',
}
const primarySourceTitle = 'CDC — About Sleep (how much sleep you need)'
const sentenceCount = 12

async function openFreshApp(page: Page) {
  await page.goto('/legacy')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

async function openFreshAppWithStorage(page: Page, entries: Record<string, string>) {
  await page.goto('/legacy')
  await page.evaluate((storageEntries) => {
    localStorage.clear()
    for (const [key, value] of Object.entries(storageEntries)) {
      localStorage.setItem(key, value)
    }
  }, entries)
  await page.reload()
}

async function installSpeechSynthesisProbe(page: Page) {
  await page.addInitScript(() => {
    const spokenTexts: string[] = []

    class TestSpeechSynthesisUtterance extends EventTarget {
      lang = ''
      rate = 1
      text: string
      onend: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(text = '') {
        super()
        this.text = text
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: TestSpeechSynthesisUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance: TestSpeechSynthesisUtterance) {
          spokenTexts.push(`${utterance.lang}|${utterance.rate}|${utterance.text}`)
        },
      },
    })
    Object.defineProperty(window, '__spokenTexts', {
      configurable: true,
      value: spokenTexts,
    })
  })
}

test('renders today card and starts the in-page read aloud experience', async ({ page }) => {
  const ttsRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/tts/mimo')) {
      ttsRequests.push(request.url())
    }
  })
  await installSpeechSynthesisProbe(page)
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: articleTitle })).toBeVisible()
  await page.getByRole('button', { name: 'Start reading' }).click()

  const controls = page.getByRole('region', { name: '逐句领读控制' })
  await expect(controls).toBeVisible()
  await expect(controls.getByText('浏览器朗读')).toBeVisible()
  await expect.poll(() => controls.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(132)
  await controls.getByRole('button', { name: '更多朗读选项' }).click()
  await expect(controls.getByRole('button', { name: '重复本句' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '播放朗读' }).click()

  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.read-aloud-controls__status')).toContainText('第 1/12 句,浏览器朗读进行中')
  await expect(page.getByText(`1/${sentenceCount}`, { exact: true })).toBeVisible()
  const spokenTexts = await page.evaluate(() => (window as unknown as { __spokenTexts: string[] }).__spokenTexts)
  expect(spokenTexts).toEqual([
    `en-US|1|${firstSentence}`,
  ])
  expect(ttsRequests).toEqual([])
})

test('toggles IPA and translation as display scaffolds and keeps them off by default', async ({ page }) => {
  await installSpeechSynthesisProbe(page)
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()

  await expect(page.getByTestId('ipa-token')).toHaveCount(0)
  await expect(page.getByTestId('sentence-translation')).toHaveCount(0)

  await page.getByLabel('IPA').check()
  await page.getByLabel('Translation').check()

  const visibleTranslations = page.locator('[data-testid="sentence-translation"]:visible')
  await expect(page.getByTestId('ipa-token')).toHaveCount(0)
  await expect(visibleTranslations).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1', exact: true })).not.toHaveAttribute('aria-controls')
  await expect(page.getByRole('button', { name: 'Hide translation for sentence 1', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '播放朗读' }).click()
  await expect(page.locator('#s1').getByTestId('ipa-token').first()).toBeVisible()
  await expect(page.locator('#s1').getByTestId('ipa-token').first()).toContainText('/ˈɛvri/')
  await expect(page.locator('#s2').getByTestId('ipa-token')).toHaveCount(0)

  expect(await page.locator('[role="button"] .sentence-text__token').count()).toBe(0)

  await page.getByRole('button', { name: 'Show translation for sentence 1', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Hide translation for sentence 1', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Hide translation for sentence 1', exact: true })).toHaveAttribute('aria-controls', 's1-translation')
  await expect(visibleTranslations.first()).toContainText(firstTranslationSnippet)
  await expect(visibleTranslations).toHaveCount(1)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1', exact: true })).not.toHaveAttribute('aria-controls')
  await expect(visibleTranslations).toHaveCount(0)
})

test('stores completion records locally after an explicit finish action', async ({ page }) => {
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: "I finished today's reading" }).click()

  const completionHeading = page.getByRole('heading', { name: "You've finished today's reading ✓" })
  await expect(completionHeading).toBeVisible()
  await expect(completionHeading).toBeFocused()
  await expect(page.getByRole('region', { name: '逐句领读控制' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Background / source' })).toBeVisible()
  const sourceLink = page.getByRole('link', { name: primarySourceTitle })
  await expect(sourceLink).toBeVisible()
  await expect(sourceLink).toHaveAttribute('target', '_blank')
  await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')

  const storageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(storageKeys).toContain(`yomu:practice-session:${articleId}`)
})

test('opens word meaning popover and saves vocabulary locally', async ({ page }) => {
  const extensionRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/extensions/ai')) {
      extensionRequests.push(request.url())
    }
  })
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.locator('#s1').getByRole('button', { name: firstMeaningToken.accessibleName, exact: true }).click()

  await expect(page.getByTestId('word-popover')).toContainText(firstMeaningToken.text)
  await expect(page.getByTestId('word-popover')).toContainText(firstMeaningToken.ipa)
  await expect(page.getByTestId('word-popover')).toContainText('大脑')
  await expect(page.getByTestId('word-popover')).toContainText('本地释义 · 零外发')
  await page.getByRole('button', { name: 'Save word' }).click()

  const savedVocabulary = await page.evaluate(() => localStorage.getItem('yomu:saved-vocabulary'))
  expect(savedVocabulary).toContain(firstMeaningToken.storageId)
  expect(extensionRequests).toEqual([])
})

test('keeps read expansion local until AI enhancement is explicitly enabled with BYOK and consent', async ({ page }) => {
  const extensionBodies: Array<{ term: string, apiKey?: string, context?: string }> = []
  await page.route('**/api/extensions/ai', async (route) => {
    const body = route.request().postDataJSON() as { term: string, apiKey?: string, context?: string }
    extensionBodies.push(body)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
      },
      body: JSON.stringify({
        meaning: 'brain: 大脑,也可指思考能力。',
        examples: ['The brain needs rest.'],
        background: '常见于关于睡眠、学习和健康的文章。',
        provider: 'OpenAI',
        model: 'gpt-4.1-mini',
      }),
    })
  })

  await openFreshAppWithStorage(page, {
    'yomu:v2:preference:provider:ai:openai:remember-on-device': JSON.stringify(true),
    'yomu:v2:preference:provider:read-expansion': JSON.stringify({
      schemaVersion: 2,
      ai: {
        enabled: true,
        provider: 'openai',
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
        },
      },
    }),
    'yomu:v2:secret:ai:openai': 'user-ai-key',
  })
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.locator('#s1').getByRole('button', { name: firstMeaningToken.accessibleName, exact: true }).click()

  await expect(page.getByRole('button', { name: 'AI 增强' })).toBeVisible()
  expect(extensionBodies).toEqual([])

  await page.getByRole('button', { name: 'AI 增强' }).click()
  await expect(page.getByRole('heading', { name: '开启 AI 增强?' })).toBeVisible()
  expect(extensionBodies).toEqual([])

  await page.getByRole('button', { name: '开启 AI 增强' }).click()
  await expect(page.getByText('✨ AI · OpenAI')).toBeVisible()
  await expect(page.getByText('brain: 大脑,也可指思考能力。')).toBeVisible()
  expect(extensionBodies).toHaveLength(1)
  expect(extensionBodies[0]).toMatchObject({
    term: 'brain',
    apiKey: 'user-ai-key',
  })
  expect(extensionBodies[0]?.context).toContain(firstSentence)
  expect(JSON.stringify(extensionBodies[0])).not.toContain(articleTitle)
})

test('shows the local read expansion panel after completion without network requests', async ({ page }) => {
  const extensionRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/extensions/ai')) {
      extensionRequests.push(request.url())
    }
  })
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: "I finished today's reading" }).click()

  await expect(page.getByRole('heading', { name: '读后拓展' })).toBeVisible()
  await expect(page.getByText('默认本地抽词,不发送文章内容。')).toBeVisible()
  await expect(page.getByText('本地释义 · 零外发').first()).toBeVisible()
  expect(extensionRequests).toEqual([])

  await page.getByLabel('AI 增强（使用你自己的 Key）').check()
  await page.getByRole('button', { name: '配置 AI key' }).first().click()
  await expect(page.locator('.read-expansion-panel__settings-anchor')).toBeFocused()
})

test('shows article-not-ready fallback when the daily package is not available yet', async ({ page }) => {
  await page.route('**/articles/today.json', route => route.fulfill({ status: 204 }))
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: "Today's piece is still being prepared." })).toBeVisible()
  await expect(page.getByText("It'll be ready shortly.")).toBeVisible()
  await expect(page.getByRole('heading', { name: '先读一篇' })).toBeVisible()
  await expect(page.getByText('运行时不会直连 Project Gutenberg')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('button', { name: '约 初级' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '约 进阶' }).click()
  await expect(page.getByText('The Time Traveller Speaks')).toBeVisible()
  await expect(page.getByText('Project Gutenberg · 美国公共领域')).toBeVisible()
  await expect(page.getByRole('link', { name: /Project Gutenberg.*在新窗口打开/ })).toHaveAttribute('href', 'https://www.gutenberg.org/ebooks/35')
  await page.getByRole('button', { name: '读这一篇' }).click()
  await expect(page.getByText('Today · 约 进阶')).toBeVisible()
  await expect(page.getByText('Public-domain fallback')).toBeVisible()
  await page.getByRole('button', { name: 'Start reading' }).click()
  await expect(page.locator('#public-domain-time-machine-table-s1')).toContainText('TheTimeTraveller')
  await expect(page.locator('#public-domain-time-machine-table-s1')).toContainText('wasexpoundingareconditemattertous')
})

test('shows offline fallback when the article package cannot load and no saved package exists', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false })
  })
  await page.route('**/articles/today.json', route => route.abort('internetdisconnected'))
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: "You're offline, and today's piece isn't saved yet." })).toBeVisible()
  await expect(page.getByText('Reconnect to load it')).toBeVisible()
  await expect(page.getByRole('heading', { name: '先读一篇' })).toBeVisible()
})

test('keeps visual reading available when cloud TTS fails', async ({ page }) => {
  await page.route('**/api/tts/mimo', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'The speech provider is temporarily unavailable.' }),
  }))
  await openFreshAppWithStorage(page, {
    'yomu:v2:preference:provider:tts:mimo:remember-on-device': JSON.stringify(true),
    'yomu:v2:preference:provider:tts': JSON.stringify({
      schemaVersion: 2,
      provider: 'mimo',
      mimo: {
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: 'mimo-v2.5-tts',
        voice: 'Mia',
        format: 'mp3',
      },
    }),
    'yomu:v2:secret:tts:mimo': 'user-key',
  })

  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: '播放朗读' }).click()
  await page.getByRole('button', { name: '开始云朗读' }).click()

  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: '第 1/12 句,这一句朗读没有加载成功' })).toHaveCount(1)
  await expect(page.locator('.read-aloud-controls__fallback')).toContainText('这一句朗读没有加载成功。')
  await expect(page.getByRole('button', { name: '跳过' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await page.getByRole('button', { name: '改用浏览器朗读' }).click()
  await expect(page.getByRole('region', { name: '逐句领读控制' }).getByText('浏览器朗读')).toBeVisible()
  await expect(page.locator('#s1')).toContainText('Everynight')
})

test('prefetches the next two MiMo sentences only after cloud consent', async ({ page }) => {
  const ttsBodies: Array<{ sentenceId: string, apiKey?: string }> = []
  let currentSentenceResponseReady!: () => void
  const currentSentenceResponse = new Promise<void>((resolve) => {
    currentSentenceResponseReady = resolve
  })
  await page.route('**/api/tts/mimo', async (route) => {
    const body = route.request().postDataJSON() as { sentenceId: string, apiKey?: string }
    ttsBodies.push(body)
    if (body.sentenceId === 's1') {
      await currentSentenceResponse
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
      },
      body: JSON.stringify({
        audioBase64: 'bXAzLWJ5dGVz',
        mimeType: 'audio/mpeg',
        durationMs: 900,
      }),
    })
  })
  await installSpeechSynthesisProbe(page)
  await openFreshAppWithStorage(page, {
    'yomu:v2:preference:provider:tts:mimo:remember-on-device': JSON.stringify(true),
    'yomu:v2:preference:provider:tts': JSON.stringify({
      schemaVersion: 2,
      provider: 'mimo',
      mimo: {
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: 'mimo-v2.5-tts',
        voice: 'Mia',
        format: 'mp3',
      },
    }),
    'yomu:v2:secret:tts:mimo': 'user-key',
  })

  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: '播放朗读' }).click()

  await expect(page.getByText('MiMo 云朗读会在你按下播放时发送当前句和接下来的少量句子')).toBeVisible()
  expect(ttsBodies).toEqual([])

  await page.getByRole('button', { name: '开始云朗读' }).click()
  await expect.poll(() => ttsBodies.map(body => body.sentenceId), { timeout: 500 }).toEqual(['s1', 's2', 's3'])
  expect(ttsBodies.every(body => body.apiKey === 'user-key')).toBe(true)

  currentSentenceResponseReady()
  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
})

test.describe('mobile word popover layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps the selected word, meaning popover, and controls physically separate', async ({ page }) => {
    await openFreshApp(page)
    await page.getByRole('button', { name: 'Start reading' }).click()
    await page.getByLabel('IPA').check()
    await page.getByLabel('Translation').check()
    await page.getByRole('button', { name: '播放朗读' }).click()

    await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
    await page.locator('#s1').getByRole('button', { name: firstMeaningToken.accessibleName, exact: true }).click()
    await page.getByRole('button', { name: '暂停朗读' }).click()
    await page.getByRole('button', { name: 'Save word' }).click()
    await page.waitForTimeout(100)

    const metrics = await page.evaluate(() => {
      const selectedToken = document.querySelector('.sentence-text__token--selected')
      const selectedSentence = selectedToken?.closest('.article-reader__sentence')
      const selectedSurface = selectedSentence?.querySelector('.article-reader__sentence-surface')
      const popover = document.querySelector('[data-testid="word-popover"]')
      const controls = document.querySelector('.read-aloud-controls')
      const toolbar = document.querySelector('.app-shell__toolbar')
      const rect = (element: Element | null | undefined) => {
        if (!element) {
          return null
        }

        const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
        return { top, right, bottom, left, width, height }
      }

      return {
        selectedToken: rect(selectedToken),
        selectedSurface: rect(selectedSurface),
        popover: rect(popover),
        controls: rect(controls),
        toolbar: rect(toolbar),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        savedVocabulary: localStorage.getItem('yomu:saved-vocabulary'),
      }
    })

    expect(metrics.selectedToken).not.toBeNull()
    expect(metrics.selectedSurface).not.toBeNull()
    expect(metrics.popover).not.toBeNull()
    expect(metrics.controls).not.toBeNull()
    expect(metrics.toolbar).not.toBeNull()
    expect(metrics.selectedToken!.top).toBeGreaterThanOrEqual(metrics.toolbar!.bottom + 8)
    expect(metrics.popover!.top).toBeGreaterThanOrEqual(metrics.selectedSurface!.bottom - 1)
    expect(metrics.popover!.bottom).toBeLessThanOrEqual(metrics.controls!.top - 12)
    expect(metrics.overflowX).toBeLessThanOrEqual(0)
    expect(metrics.savedVocabulary).toContain(firstMeaningToken.storageId)
  })
})
