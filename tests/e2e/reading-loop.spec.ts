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

test('a duplicate file import returns to the edited preview', async ({ page }) => {
  await page.goto('/import')
  await page.getByRole('button', { name: 'TXT / Markdown' }).click()

  const firstChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择文件' }).click()
  const firstChooser = await firstChooserPromise
  await firstChooser.setFiles({
    name: 'duplicate-reading.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(importedBody, 'utf8'),
  })

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('Original file title')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)

  await page.goto('/import')
  await page.getByRole('button', { name: 'TXT / Markdown' }).click()
  const duplicateChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择文件' }).click()
  const duplicateChooser = await duplicateChooserPromise
  await duplicateChooser.setFiles({
    name: 'duplicate-reading.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(importedBody, 'utf8'),
  })

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('Edited duplicate title')
  await page.getByRole('textbox', { name: '来源' }).fill('Edited duplicate source')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page.getByTestId('import-duplicate-state')).toBeVisible()

  await page.getByRole('button', { name: '返回修改' }).click()

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await expect(page.getByLabel('标题')).toHaveValue('Edited duplicate title')
  await expect(page.getByRole('textbox', { name: '来源' }))
    .toHaveValue('Edited duplicate source')
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

test('web development serves the real URL import Worker boundary', async ({ request }) => {
  const response = await request.post('/api/import/url', {
    data: { url: 'http://localhost/private' },
  })

  expect(response.status()).toBe(403)
  await expect(response.json()).resolves.toMatchObject({
    code: 'private-url',
    variant: 'url.scheme',
  })

  const oversizedResponse = await request.post('/api/import/url', {
    data: {
      url: 'http://localhost/private',
      padding: 'x'.repeat(100_000),
    },
  })

  expect(oversizedResponse.status()).toBe(413)
  await expect(oversizedResponse.json()).resolves.toMatchObject({
    code: 'extract-failed',
    variant: 'url.extractFailed',
  })
})

test('URL Beta extracts a remote article locally without exposing or executing page HTML', async ({ page }) => {
  const directResourceRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('browser-resource-probe')) {
      directResourceRequests.push(request.url())
    }
  })
  const remoteHtml = [
    '<!doctype html><html><head><title>Remote focus article</title></head><body>',
    '<nav>REMOTE NAVIGATION MUST STAY HIDDEN</nav>',
    '<img src="http://127.0.0.1:9/browser-resource-probe" alt="probe">',
    '<link rel="stylesheet" href="http://127.0.0.1:9/browser-resource-probe.css">',
    `<article><h1>Remote focus article</h1><p>${importedBody}</p></article>`,
    '<script>window.__urlImportScriptRan = true</script>',
    '</body></html>',
  ].join('')
  await page.route('**/api/import/url', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({
      content: remoteHtml,
      contentType: 'text/html; charset=utf-8',
      sourceUrl: 'https://example.com/final-article',
    }),
  }))
  await page.goto('/import')

  await page.getByRole('button', { name: 'URL Beta' }).click()
  await page.getByLabel('文章网址').fill('https://example.com/original-article')
  await page.getByRole('button', { name: '提取正文' }).click()

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await expect(page.getByLabel('标题')).toHaveValue('Remote focus article')
  await expect(page.getByRole('textbox', { name: '来源' })).toHaveValue('example.com')
  await expect(page.getByLabel('提取后的正文')).toHaveValue(importedBody)
  await expect(page.getByText('REMOTE NAVIGATION MUST STAY HIDDEN')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    '__urlImportScriptRan' in window)).toBe(false)
  expect(directResourceRequests).toEqual([])
})

test('URL Beta saves into the reading loop and deduplicates the confirmed body', async ({ page }) => {
  const remoteHtml = [
    '<!doctype html><html><head><title>Remote library article</title></head><body>',
    `<article><h1>Remote library article</h1><p>${importedBody}</p></article>`,
    '</body></html>',
  ].join('')
  await page.route('**/api/import/url', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({
      content: remoteHtml,
      contentType: 'text/html; charset=utf-8',
      sourceUrl: 'https://example.com/final-library-article',
    }),
  }))

  await page.goto('/import')
  await page.getByRole('button', { name: 'URL Beta' }).click()
  await page.getByLabel('文章网址').fill('https://example.com/first-library-article')
  await page.getByRole('button', { name: '提取正文' }).click()

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('Saved URL article')
  await page.getByRole('textbox', { name: '来源' }).fill('Edited web source')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const savedArticleUrl = page.url()
  await expect(page.getByRole('heading', { level: 2, name: 'Saved URL article' })).toBeVisible()
  await expect(page.getByText('Edited web source · 未评估')).toBeVisible()

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page.getByRole('link', { name: 'Saved URL article' })).toBeVisible()
  await expect(page.locator('[data-article-id]')).toHaveCount(1)

  await page.getByRole('link', { name: '导入内容', exact: true }).click()
  await page.getByRole('button', { name: 'URL Beta' }).click()
  await page.getByLabel('文章网址').fill('https://example.com/duplicate-library-article')
  await page.getByRole('button', { name: '提取正文' }).click()
  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('A different URL title')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page.getByTestId('import-duplicate-state')).toBeVisible()
  await expect(page.getByText('Saved URL article', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开已有文章' }).click()
  await expect(page).toHaveURL(savedArticleUrl)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page.locator('[data-article-id]')).toHaveCount(1)
})

test('URL Beta keeps the address and offers paste fallback after a recoverable failure', async ({ page }) => {
  const originalUrl = 'https://example.com/unreadable'
  await page.route('**/api/import/url', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({
      code: 'url-unavailable',
      variant: 'url.unavailable',
      message: 'The remote page is temporarily unavailable.',
    }),
  }))
  await page.goto('/import')

  await page.getByRole('button', { name: 'URL Beta' }).click()
  await page.getByLabel('文章网址').fill(originalUrl)
  await page.getByRole('button', { name: '提取正文' }).click()

  const errorHeading = page.getByRole('heading', { name: '无法生成预览' })
  await expect(errorHeading).toBeFocused()
  await expect(page.getByLabel('文章网址')).toHaveValue(originalUrl)
  await expect(page.getByRole('button', { name: '改为粘贴正文' })).toBeVisible()
  await page.getByRole('button', { name: '改为粘贴正文' }).click()
  await expect(page.getByLabel('英文正文')).toBeVisible()

  await page.getByRole('button', { name: 'URL Beta' }).click()
  await expect(page.getByLabel('文章网址')).toHaveValue(originalUrl)

  await page.getByRole('link', { name: '我的阅读', exact: true }).click({ noWaitAfter: true })
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('library-empty-state')).toBeVisible()
  await expect(page.locator('[data-article-id]')).toHaveCount(0)
})

test('file picker rejects non-UTF-8 text and imports Markdown through the platform adapter', async ({ page }) => {
  await page.goto('/import')
  await page.getByRole('button', { name: 'TXT / Markdown' }).click()

  const utf16ChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择文件' }).click()
  const utf16Chooser = await utf16ChooserPromise
  await utf16Chooser.setFiles({
    name: 'utf16-without-bom.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(importedBody, 'utf16le'),
  })

  const errorHeading = page.getByRole('heading', { name: '无法生成预览' })
  await expect(errorHeading).toBeFocused()
  await expect(page.getByText('无法按 UTF-8 读取这个文件，请转换编码后重试。')).toBeVisible()
  await expect(page.getByText('utf16-without-bom.txt', { exact: true })).toBeVisible()

  const invalidChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择其他文件' }).click()
  const invalidChooser = await invalidChooserPromise
  await invalidChooser.setFiles({
    name: 'broken.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([0xc3, 0x28]),
  })

  await expect(errorHeading).toBeFocused()
  await expect(page.getByText('无法按 UTF-8 读取这个文件，请转换编码后重试。')).toBeVisible()
  await expect(page.getByText('broken.txt', { exact: true })).toBeVisible()

  const validChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择其他文件' }).click()
  const validChooser = await validChooserPromise
  await validChooser.setFiles({
    name: 'local-reading.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# ${importedBody}\n`, 'utf8'),
  })

  const preview = page.getByTestId('import-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByRole('textbox', { name: '来源' })).toHaveValue('local-reading.md')
  await expect(page.getByLabel('提取后的正文')).toHaveValue(importedBody)
  await page.getByLabel('标题').fill('Imported from Markdown')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Imported from Markdown' })).toBeVisible()
})

test('expanded file import accepts one dropped text file while keeping the picker visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/import')
  await page.getByRole('button', { name: 'TXT / Markdown' }).click()

  await expect(page.getByRole('button', { name: '选择文件' })).toBeVisible()
  await expect(page.getByText('或在宽屏桌面上把一个文件拖放到此处')).toBeVisible()

  const dataTransfer = await page.evaluateHandle((body) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([body], 'desktop-drop.txt', { type: 'text/plain' }))
    return transfer
  }, importedBody)
  await page.getByTestId('file-drop-zone').dispatchEvent('drop', { dataTransfer })
  await dataTransfer.dispose()

  await expect(page.getByTestId('import-preview')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '来源' })).toHaveValue('desktop-drop.txt')
  await expect(page.getByLabel('提取后的正文')).toHaveValue(importedBody)
})

test('unsaved import drafts require an explicit SPA navigation decision', async ({ page }) => {
  await page.goto('/import')
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)
  await page.getByRole('button', { name: 'TXT / Markdown' }).click()
  await expect(page.getByTestId('file-drop-zone')).toBeVisible()

  await page.getByRole('link', { name: '设置', exact: true }).click({ noWaitAfter: true })
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/import$/)
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused()
  await dialog.getByRole('button', { name: '继续编辑' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '粘贴文本' }).click()
  await expect(bodyField).toHaveValue(importedBody)

  await page.getByRole('button', { name: '生成预览' }).click()
  await expect(page.getByTestId('import-preview')).toBeVisible()
  await page.getByLabel('标题').fill('Discarded preview title')
  await page.getByRole('link', { name: '我的阅读', exact: true }).click({ noWaitAfter: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/import$/)
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('library-empty-state')).toBeVisible()
  await expect(page.locator('[data-article-id]')).toHaveCount(0)
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
