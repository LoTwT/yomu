import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function openFreshApp(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
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
  await installSpeechSynthesisProbe(page)
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })).toBeVisible()
  await page.getByRole('button', { name: 'Start reading' }).click()

  const controls = page.getByRole('region', { name: 'Read aloud controls' })
  await expect(controls).toBeVisible()
  await expect.poll(() => controls.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(82)
  await controls.getByRole('button', { name: 'More read-aloud options' }).click()
  await expect(controls.getByRole('button', { name: 'Repeat sentence' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Play lead voice' }).click()

  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.read-aloud-controls__status')).toContainText('Lead voice playing')
  await expect(page.getByText('1/3')).toBeVisible()
  const spokenTexts = await page.evaluate(() => (window as unknown as { __spokenTexts: string[] }).__spokenTexts)
  expect(spokenTexts).toEqual([
    'en-US|1|A short walk can change the shape of a difficult afternoon.',
  ])
})

test('toggles IPA and translation as display scaffolds and keeps them off by default', async ({ page }) => {
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()

  await expect(page.getByTestId('ipa-token')).toHaveCount(0)
  await expect(page.getByTestId('sentence-translation')).toHaveCount(0)

  await page.getByLabel('IPA').check()
  await page.getByLabel('Translation').check()

  const visibleTranslations = page.locator('[data-testid="sentence-translation"]:visible')
  await expect(page.getByTestId('ipa-token').first()).toBeVisible()
  await expect(page.getByTestId('ipa-token').first()).toContainText('/ə/')
  await expect(visibleTranslations).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Hide translation for sentence 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1' })).toHaveCount(0)

  expect(await page.locator('[role="button"] .sentence-text__token').count()).toBe(0)

  await page.getByRole('button', { name: 'Hide translation for sentence 1' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Show translation for sentence 1' })).toHaveAttribute('aria-expanded', 'false')
  await expect(visibleTranslations).toHaveCount(2)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Hide translation for sentence 1' })).toHaveAttribute('aria-expanded', 'true')
  await expect(visibleTranslations.first()).toContainText('一次短短的散步')
  await expect(visibleTranslations).toHaveCount(3)
})

test('stores completion records locally after an explicit finish action', async ({ page }) => {
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: "I finished today's reading" }).click()

  const completionHeading = page.getByRole('heading', { name: "You've finished today's reading ✓" })
  await expect(completionHeading).toBeVisible()
  await expect(completionHeading).toBeFocused()
  await expect(page.getByRole('region', { name: 'Read aloud controls' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Background / source' })).toBeVisible()
  const sourceLink = page.getByRole('link', { name: 'WHO physical activity fact sheet' })
  await expect(sourceLink).toBeVisible()
  await expect(sourceLink).toHaveAttribute('target', '_blank')
  await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')

  const storageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(storageKeys).toContain('yomu:practice-session:daily-en-2026-05-24-breathing-room')
})

test('opens word meaning popover and saves vocabulary locally', async ({ page }) => {
  await openFreshApp(page)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: 'walk: 散步' }).click()

  await expect(page.getByTestId('word-popover')).toContainText('walk')
  await expect(page.getByTestId('word-popover')).toContainText('/wɔːk/')
  await page.getByRole('button', { name: 'Save word' }).click()

  const savedVocabulary = await page.evaluate(() => localStorage.getItem('yomu:saved-vocabulary'))
  expect(savedVocabulary).toContain('s1-t3')
})

test('shows article-not-ready fallback when the daily package is not available yet', async ({ page }) => {
  await page.route('**/articles/today.json', route => route.fulfill({ status: 204 }))
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: "Today's piece is still being prepared." })).toBeVisible()
  await expect(page.getByText("It'll be ready shortly.")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('shows offline fallback when the article package cannot load and no saved package exists', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false })
  })
  await page.route('**/articles/today.json', route => route.abort('internetdisconnected'))
  await openFreshApp(page)

  await expect(page.getByRole('heading', { name: "You're offline, and today's piece isn't saved yet." })).toBeVisible()
  await expect(page.getByText('Reconnect to load it')).toBeVisible()
})

test('keeps visual reading available when a sentence audio ref fails', async ({ page }) => {
  await page.route('**/articles/today.json', async (route) => {
    const response = await route.fetch()
    const article = await response.json()
    article.sentences[0].audioRef.url = 'missing://audio/s1'
    await route.fulfill({ json: article })
  })
  await openFreshApp(page)

  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: 'Play lead voice' }).click()

  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: "This line's read-aloud didn't load." })).toHaveCount(1)
  await expect(page.locator('.read-aloud-controls__fallback')).toContainText("This line's read-aloud didn't load.")
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('#s1')).toContainText('Ashortwalkcanchange')
})

test.describe('mobile word popover layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps the selected word, meaning popover, and controls physically separate', async ({ page }) => {
    await openFreshApp(page)
    await page.getByRole('button', { name: 'Start reading' }).click()
    await page.getByLabel('IPA').check()
    await page.getByLabel('Translation').check()
    await page.getByRole('button', { name: 'Play lead voice' }).click()

    await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: 'walk: 散步', exact: true }).click()
    await page.getByRole('button', { name: 'Pause lead voice' }).click()
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
    expect(metrics.savedVocabulary).toContain('s1-t3')
  })
})
