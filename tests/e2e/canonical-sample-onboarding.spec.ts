import { expect, test, type Page } from '@playwright/test'

import {
  isArticleRecord,
  isReadingAttempt,
  type ArticleRecord,
  type ReadingAttempt,
} from '../../src/data/entities'

const sampleTitle = 'Alice Falls and Shrinks'
const sampleSourceUrl = 'https://www.gutenberg.org/ebooks/11'
const legacyTodayArticleId = 'daily-en-2026-05-25-why-the-brain-loves-sleep'

test('the bundled sample joins the canonical reading loop from both library entry surfaces', async ({
  page,
}) => {
  await page.goto('/')

  const emptyState = page.getByTestId('library-empty-state')
  await expect(emptyState).toBeVisible()
  await expect(emptyState.locator('a[href="/legacy"]')).toHaveCount(0)

  const emptyStateAction = emptyState.getByRole('button', { name: /加入并阅读/ })
  await expect(emptyStateAction).toContainText('加入并阅读')
  await emptyStateAction.click()

  await expect(page).toHaveURL(/\/read\/[^/?#]+$/)
  expect(new URL(page.url()).pathname).not.toBe('/legacy')
  const articleId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  expect(articleId).not.toBe('')
  expect(articleId).not.toBe(legacyTodayArticleId)
  await expect(page.getByRole('heading', { level: 2, name: sampleTitle })).toBeVisible()

  const firstSnapshot = await readCanonicalSampleSnapshot(page)
  assertCanonicalSampleSnapshot(firstSnapshot, articleId)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page).toHaveURL('/')

  const recommendation = page.locator('[data-library-recommendation]')
  await expect(recommendation).toBeVisible()
  await expect(recommendation.locator('a[href="/legacy"]')).toHaveCount(0)
  const recommendationAction = recommendation.getByRole('button', { name: /加入并阅读/ })
  await expect(recommendationAction).toContainText('加入并阅读')
  await recommendationAction.click()

  await expectReaderArticleUrl(page, articleId)
  const repeatedSnapshot = await readCanonicalSampleSnapshot(page)
  assertCanonicalSampleSnapshot(repeatedSnapshot, articleId)
})

test('legacy Today routes remain available only as direct compatibility routes', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  await expect(page.locator('a[href="/legacy"], a[href="/today"]')).toHaveCount(0)

  await page.goto('/legacy')
  await expect(page).toHaveURL('/legacy')
  await expect(page.locator('.legacy-route')).toBeVisible()

  await page.goto('/today')
  await expect(page).toHaveURL('/legacy')
  await expect(page.locator('.legacy-route')).toBeVisible()
})

test('the bundled sample completes through canonical Review and starts a reread only on request', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('library-empty-state')
    .getByRole('button', { name: /加入并阅读/ })
    .click()

  await expect(page).toHaveURL(/\/read\/[^/?#]+$/)
  const articleId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  await page.locator('[data-sentence-id]').last().click()
  await page.getByRole('button', { name: '完成阅读' }).click()

  await expect(page).toHaveURL(/\/review\/[^/?#]+$/)
  await expect(page.getByRole('heading', { level: 1, name: '读后回顾' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: sampleTitle })).toBeVisible()
  await expect.poll(() => readCanonicalSampleSnapshot(page)).toMatchObject({
    articles: [expect.objectContaining({ id: articleId })],
    attempts: [expect.objectContaining({ articleId, status: 'completed' })],
  })

  await page.getByRole('link', { name: '返回阅读库' }).click()
  const articleItem = page.locator(`[data-article-id="${articleId}"]`)
  await expect(articleItem).toContainText('已完成')
  await page.locator('[data-library-recommendation]')
    .getByRole('button', { name: /加入并阅读/ })
    .click()

  await expectReaderArticleUrl(page, articleId)
  await expect.poll(async () => {
    const snapshot = await readCanonicalSampleSnapshot(page)
    return {
      articleIds: snapshot.articles.flatMap(article =>
        isArticleRecord(article) ? [article.id] : []),
      statuses: snapshot.attempts.flatMap(attempt =>
        isReadingAttempt(attempt) && attempt.articleId === articleId
          ? [attempt.status]
          : []).sort(),
    }
  }).toEqual({
    articleIds: [articleId],
    statuses: ['active', 'completed'],
  })
})

test('a permanently deleted bundled sample starts again as a fresh durable incarnation', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('library-empty-state')
    .getByRole('button', { name: /加入并阅读/ })
    .click()

  await expect(page).toHaveURL(/\/read\/[^/?#]+$/)
  const deletedArticleId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  await page.getByRole('link', { name: '我的阅读' }).click()

  const deletedArticle = page.locator(`[data-article-id="${deletedArticleId}"]`)
  await deletedArticle.getByRole('button', { name: `管理《${sampleTitle}》` }).click()
  let managementDialog = page.getByRole('dialog', { name: '管理文章' })
  await managementDialog.getByRole('button', { name: '删除文章' }).click()
  managementDialog = page.getByRole('dialog', { name: '删除文章' })
  await managementDialog.getByRole('button', { name: '永久删除' }).click()

  await expect(deletedArticle).toHaveCount(0)
  const emptyState = page.getByTestId('library-empty-state')
  await expect(emptyState).toBeVisible()
  await emptyState.getByRole('button', { name: /加入并阅读/ }).click()

  await expect(page).toHaveURL(/\/read\/[^/?#]+$/)
  const readdedArticleId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  expect(readdedArticleId).not.toBe(deletedArticleId)
  await expect(page.getByRole('heading', { level: 2, name: sampleTitle })).toBeVisible()

  const targetSentence = page.locator('[data-sentence-id]').nth(1)
  await targetSentence.click()
  await expect(targetSentence).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.evaluate(articleId => {
    const journalPrefix = `yomu:v2:preference:reader-progress-journal:v4:${encodeURIComponent(articleId)}:`
    return Object.keys(localStorage).some(key => key.startsWith(journalPrefix))
  }, readdedArticleId)).toBe(true)

  await page.reload()
  await expectReaderArticleUrl(page, readdedArticleId)
  await expect(page.locator('[data-sentence-id]').nth(1)).toHaveAttribute('aria-current', 'true')
})

interface CanonicalSampleSnapshot {
  articles: unknown[]
  attempts: unknown[]
}

function assertCanonicalSampleSnapshot(
  snapshot: CanonicalSampleSnapshot,
  articleId: string,
): asserts snapshot is { articles: ArticleRecord[], attempts: ReadingAttempt[] } {
  expect(snapshot.articles).toHaveLength(1)
  expect(snapshot.attempts).toHaveLength(1)
  expect(isArticleRecord(snapshot.articles[0])).toBe(true)
  expect(isReadingAttempt(snapshot.attempts[0])).toBe(true)

  const article = snapshot.articles[0]
  const attempt = snapshot.attempts[0]
  if (!isArticleRecord(article) || !isReadingAttempt(attempt)) {
    throw new Error('The bundled sample did not create valid canonical records.')
  }

  expect(article).toMatchObject({
    id: articleId,
    title: sampleTitle,
    source: {
      kind: 'public-domain',
      url: sampleSourceUrl,
    },
    rights: {
      status: 'public-domain',
      cacheAllowed: true,
      translationAllowed: true,
      ttsAllowed: true,
    },
  })
  expect(article.sentences.every(sentence => sentence.id.startsWith(articleId))).toBe(true)
  expect(article.sentences.flatMap(sentence => sentence.tokens)
    .every(token => token.id.startsWith(articleId))).toBe(true)
  expect(attempt).toMatchObject({
    articleId,
    currentSentenceId: article.sentences[0]?.id,
    status: 'active',
  })
}

async function readCanonicalSampleSnapshot(page: Page): Promise<CanonicalSampleSnapshot> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yomu-v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(['articles', 'attempts'], 'readonly')
      const completion = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(
          transaction.error ?? new Error('Canonical sample snapshot transaction aborted.'),
        )
        transaction.onerror = () => reject(
          transaction.error ?? new Error('Canonical sample snapshot transaction failed.'),
        )
      })
      const readAll = (storeName: 'articles' | 'attempts') =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const [articles, attempts] = await Promise.all([
        readAll('articles'),
        readAll('attempts'),
      ])
      await completion
      return { articles, attempts }
    }
    finally {
      database.close()
    }
  })
}

async function expectReaderArticleUrl(page: Page, articleId: string): Promise<void> {
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe(`/read/${articleId}`)
}
