import { expect, test, type Page } from '@playwright/test'

const importedBody = [
  'A quiet reading habit gives the mind enough space to notice how an argument develops.',
  'When each sentence is considered on its own, unfamiliar words feel less overwhelming and context remains clear.',
  'Returning to the exact sentence later makes a local reading library useful across several short sessions.',
].join(' ')

const secondImportedBody = [
  'Small improvements become easier to notice when a reader returns to a familiar subject with fresh attention.',
  'A second article also makes the library useful for comparing progress without mixing one text with another.',
  'Clear local organization keeps both reading sessions independent while preserving a calm interface.',
].join(' ')

test('empty library becomes a persistent reading session and resumes the selected sentence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const emptyState = page.getByTestId('library-empty-state')
  await expect(emptyState).toBeVisible()
  await expect(page.getByRole('link', { name: /Today/ })).toHaveCount(1)
  await expect(page.getByRole('link', { name: '粘贴英文内容' })).toBeInViewport()
  await page.getByRole('link', { name: '粘贴英文内容' }).click()

  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  const preview = page.getByTestId('import-preview')
  await expect(preview).toBeVisible()
  await expect(preview.getByText('3', { exact: true })).toBeVisible()
  await page.getByLabel('标题').fill('My local focus article')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const readerUrl = page.url()
  const articleId = readerUrl.split('/').at(-1) ?? ''
  await expect(page.getByRole('heading', { level: 2, name: 'My local focus article' })).toBeVisible()
  const readerSentences = page.locator('[data-sentence-id]')
  await expect(readerSentences.first()).toHaveAttribute('aria-current', 'true')
  await expect(readerSentences.first()).toHaveAttribute('tabindex', '0')
  await expect(readerSentences.nth(1)).toHaveAttribute('tabindex', '-1')
  await expect(page.locator('[data-sentence-id][tabindex="0"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)

  const thirdSentence = page.locator('[data-sentence-id]').nth(2)
  const thirdSentenceId = await thirdSentence.getAttribute('data-sentence-id')
  await page.waitForTimeout(1_100)
  await thirdSentence.click()
  await expect(thirdSentence).toHaveAttribute('aria-current', 'true')
  await expect(thirdSentence).toHaveAttribute('tabindex', '0')
  await expect(thirdSentence).toBeFocused()
  await expect(page.locator('[data-sentence-id][tabindex="0"]')).toHaveCount(1)
  await expect(page.getByText('第 3 / 3 句')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: '文章进度 99%' })).toBeVisible()
  await page.reload()

  await expect(page).toHaveURL(readerUrl)
  await expect(page.locator('[data-sentence-id]').nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-sentence-id]').nth(2)).toHaveAttribute('tabindex', '0')
  await expect(page.locator('[data-sentence-id][tabindex="0"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
  await expect.poll(() => readActiveSentenceId(page, articleId)).toBe(thirdSentenceId)
  await expect.poll(() => readActiveDuration(page, articleId)).toBeGreaterThanOrEqual(1)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page).toHaveURL(/\/$/)
  const restoredArticleLink = page.getByRole('link', { name: 'My local focus article' })
  await expect(restoredArticleLink).toBeVisible()
  await expect(restoredArticleLink).toBeFocused()
  await expect(page.getByText('第 3 / 3 句')).toBeVisible()
  await expect(page.locator('.article-object__progress')).toHaveAccessibleName(
    'My local focus article 阅读进度 99%',
  )
  await expect(page.locator('[data-article-id]')).toHaveCount(1)
})

test('same confirmed body opens the existing article instead of creating a duplicate', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('Original title')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const firstArticleUrl = page.url()

  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('Changed title does not affect the body hash')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page.getByTestId('import-duplicate-state')).toBeVisible()
  await expect(page.getByText('Original title', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开已有文章' }).click()
  await expect(page).toHaveURL(firstArticleUrl)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page.locator('[data-article-id]')).toHaveCount(1)
})

test('import errors keep the draft and move focus to a recoverable summary', async ({ page }) => {
  await page.goto('/import')
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill('This draft is too short.')
  await page.getByRole('button', { name: '生成预览' }).click()

  const errorHeading = page.getByRole('heading', { name: '无法生成预览' })
  await expect(errorHeading).toBeVisible()
  await expect(errorHeading).toBeFocused()
  await expect(bodyField).toHaveValue('This draft is too short.')

  await bodyField.fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await expect(page.getByTestId('import-preview')).toBeVisible()
})

test('unsaved import drafts require an explicit SPA navigation decision', async ({ page }) => {
  await page.goto('/import')
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)

  await page.getByRole('link', { name: '设置', exact: true }).click({ noWaitAfter: true })
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/import$/)
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused()
  await dialog.getByRole('button', { name: '继续编辑' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(bodyField).toHaveValue(importedBody)

  await page.getByRole('button', { name: '生成预览' }).click()
  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('Discarded preview title')
  await page.getByRole('link', { name: '我的阅读', exact: true }).click({ noWaitAfter: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/import$/)
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('library keeps one semantic list across the 1199 and 1200 pixel layout boundary', async ({ page }) => {
  await importAndReturnToLibrary(page, importedBody, 'First responsive article')
  await importAndReturnToLibrary(page, secondImportedBody, 'Second responsive article')
  await expect(page.locator('[data-article-id]')).toHaveCount(2)

  await page.setViewportSize({ width: 1199, height: 900 })
  const collection = page.getByTestId('article-collection')
  await expect(collection).toBeVisible()
  await expect.poll(() => collection.evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)

  const firstArticleLink = page.getByRole('link', { name: 'Second responsive article' })
  await firstArticleLink.focus()
  await expect(firstArticleLink).toBeFocused()

  await page.setViewportSize({ width: 1200, height: 900 })
  await expect.poll(() => collection.evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
  await expect(firstArticleLink).toBeFocused()
  await expect(page.locator('[data-article-id]')).toHaveCount(2)

  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect.poll(() => collection.evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
  await expect(firstArticleLink).toBeFocused()
})

async function importAndReturnToLibrary(
  page: Page,
  body: string,
  title: string,
): Promise<void> {
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(body)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill(title)
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function readActiveSentenceId(page: Page, articleId: string): Promise<string | null> {
  return page.evaluate(async (targetArticleId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yomu-v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const attempts = await new Promise<Array<{
        articleId?: unknown
        currentSentenceId?: unknown
        status?: unknown
      }>>((resolve, reject) => {
        const transaction = database.transaction('attempts', 'readonly')
        const request = transaction.objectStore('attempts').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const active = attempts.find(attempt =>
        attempt.articleId === targetArticleId && attempt.status === 'active')
      return typeof active?.currentSentenceId === 'string'
        ? active.currentSentenceId
        : null
    }
    finally {
      database.close()
    }
  }, articleId)
}

async function readActiveDuration(page: Page, articleId: string): Promise<number> {
  return page.evaluate(async (targetArticleId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yomu-v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const attempts = await new Promise<Array<{
        activeDurationSec?: unknown
        articleId?: unknown
        status?: unknown
      }>>((resolve, reject) => {
        const transaction = database.transaction('attempts', 'readonly')
        const request = transaction.objectStore('attempts').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const active = attempts.find(attempt =>
        attempt.articleId === targetArticleId && attempt.status === 'active')
      return typeof active?.activeDurationSec === 'number'
        ? active.activeDurationSec
        : 0
    }
    finally {
      database.close()
    }
  }, articleId)
}
