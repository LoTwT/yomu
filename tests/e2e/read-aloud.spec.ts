import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('renders today card and starts the in-page read aloud experience', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })).toBeVisible()
  await page.getByRole('button', { name: 'Start reading' }).click()

  await expect(page.getByRole('region', { name: 'Read aloud controls' })).toBeVisible()
  await page.getByRole('button', { name: 'Play' }).click()

  await expect(page.locator('#s1')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByText('Reading sentence 1 of 3')).toBeVisible()
})

test('toggles IPA and translation as display scaffolds and keeps them off by default', async ({ page }) => {
  await page.getByRole('button', { name: 'Start reading' }).click()

  await expect(page.getByTestId('ipa-token')).toHaveCount(0)
  await expect(page.getByTestId('sentence-translation')).toHaveCount(0)

  await page.getByLabel('IPA').check()
  await page.getByLabel('Translation').check()

  await expect(page.getByTestId('ipa-token').first()).toBeVisible()
  await expect(page.getByTestId('sentence-translation')).toHaveCount(0)

  await page.getByRole('button', { name: /Toggle translation for: A short walk/ }).click()
  await expect(page.getByTestId('sentence-translation').first()).toContainText('一次短短的散步')
  await expect(page.getByTestId('sentence-translation')).toHaveCount(1)
})

test('stores completion records locally after an explicit finish action', async ({ page }) => {
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.getByRole('button', { name: "I finished today's reading" }).click()

  await expect(page.getByRole('heading', { name: "Today's page is done." })).toBeVisible()

  const storageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(storageKeys).toContain('yomu:practice-session:daily-en-2026-05-24-breathing-room')
})
