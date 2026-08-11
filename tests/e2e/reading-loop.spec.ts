import { expect, test, type Page } from '@playwright/test'

import { isArticleRecord, type ArticleRecord } from '../../src/data/entities'

const importedSentences = [
  'A quiet reading habit gives the mind enough space to notice how an argument develops.',
  'When each sentence is considered on its own, unfamiliar words feel less overwhelming and context remains clear.',
  'Returning to the exact sentence later makes a local reading library useful across several short sessions.',
] as const

const importedBody = importedSentences.join(' ')

const secondImportedBody = [
  'Small improvements become easier to notice when a reader returns to a familiar subject with fresh attention.',
  'A second article also makes the library useful for comparing progress without mixing one text with another.',
  'Clear local organization keeps both reading sessions independent while preserving a calm interface.',
].join(' ')

const displayAssistanceArticle: ArticleRecord = {
  id: 'stage-3c-display-assistance',
  schemaVersion: 2,
  contentHash: 'stage-3c-display-assistance-content',
  title: 'A Calm Cross-Platform Reading Surface',
  description: 'A capable local article for reader display assistance coverage.',
  language: 'en',
  level: 'unassessed',
  source: {
    kind: 'paste',
    label: 'Display assistance fixture',
  },
  rights: {
    status: 'user-provided-unknown',
    note: 'User-provided test content.',
    ttsAllowed: true,
    translationAllowed: true,
    cacheAllowed: true,
  },
  capabilities: {
    sentenceTranslation: 'partial',
    sentenceIpa: 'complete',
    tokenMeaning: 'none',
  },
  sentences: [
    {
      id: 'stage-3c-display-assistance:s1',
      order: 0,
      paragraphIndex: 0,
      textHash: 'stage-3c-display-assistance-sentence-1',
      original: 'Focused reading makes unfamiliar ideas easier to revisit.',
      translation: '专注阅读让陌生的观点更容易被重新理解。',
      tokens: [
        {
          id: 'stage-3c-display-assistance:s1:t1',
          text: 'Focused',
          kind: 'word',
          ipa: 'ˈfoʊkəst',
        },
        {
          id: 'stage-3c-display-assistance:s1:t2',
          text: 'reading',
          kind: 'word',
        },
      ],
    },
    {
      id: 'stage-3c-display-assistance:s2',
      order: 1,
      paragraphIndex: 0,
      textHash: 'stage-3c-display-assistance-sentence-2',
      original: 'A quiet interface keeps attention on the current sentence.',
      sentenceIpa: '/ə ˈkwaɪət ˈɪntərfeɪs kiːps əˈtɛnʃən ɑːn ðə ˈkʌrənt ˈsɛntəns/',
      tokens: [
        {
          id: 'stage-3c-display-assistance:s2:t1',
          text: 'A',
          kind: 'word',
        },
        {
          id: 'stage-3c-display-assistance:s2:t2',
          text: 'quiet',
          kind: 'word',
        },
      ],
    },
  ],
  factSources: [],
  wordCount: 17,
  estimatedReadTimeMinutes: 1,
  createdAt: '2026-08-10T08:00:00.000Z',
  updatedAt: '2026-08-10T08:00:00.000Z',
}

const vocabularyLoopArticle: ArticleRecord = {
  id: 'stage-4b-vocabulary-loop',
  schemaVersion: 2,
  contentHash: 'stage-4b-vocabulary-loop-content',
  title: 'A Durable Vocabulary Loop',
  description: 'A local article with honest token meaning coverage.',
  language: 'en',
  level: 'unassessed',
  source: {
    kind: 'paste',
    label: 'Vocabulary loop fixture',
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
    tokenMeaning: 'partial',
  },
  sentences: [
    {
      id: 'stage-4b-vocabulary-loop:s1',
      order: 0,
      paragraphIndex: 0,
      textHash: 'stage-4b-vocabulary-loop-sentence-1',
      original: 'A lantern makes a quiet page feel welcoming.',
      tokens: [{
        id: 'stage-4b-vocabulary-loop:s1:t1',
        text: 'lantern',
        kind: 'word',
        meaning: '灯笼；提灯',
      }],
    },
    {
      id: 'stage-4b-vocabulary-loop:s2',
      order: 1,
      paragraphIndex: 0,
      textHash: 'stage-4b-vocabulary-loop-sentence-2',
      original: 'Patience helps a reader notice how an argument develops.',
      tokens: [{
        id: 'stage-4b-vocabulary-loop:s2:t1',
        text: 'Patience',
        kind: 'word',
      }],
    },
    {
      id: 'stage-4b-vocabulary-loop:s3',
      order: 2,
      paragraphIndex: 0,
      textHash: 'stage-4b-vocabulary-loop-sentence-3',
      original: 'Returning to an exact sentence keeps later review grounded.',
      tokens: [],
    },
  ],
  factSources: [],
  wordCount: 26,
  estimatedReadTimeMinutes: 1,
  createdAt: '2026-08-11T08:00:00.000Z',
  updatedAt: '2026-08-11T08:00:00.000Z',
}

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
  await thirdSentence.locator('[data-token-id]:not([data-word-token-id])').last().click()
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

test('an imported reading completes into a durable review and rereads only on request', async ({ page }) => {
  await installReaderSpeechProbe(page)
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('A completed reading loop')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const articleId = page.url().split('/').at(-1) ?? ''
  await page.locator('[data-sentence-id]').last().click()
  await page.getByRole('button', { name: '朗读当前句' }).click()
  await expect(page.getByRole('button', { name: '暂停朗读' })).toBeVisible()
  const cancelCountBeforeCompletion = await readSpeechProbe(page, 'cancelCount')
  await page.waitForTimeout(1_100)

  await page.getByRole('button', { name: '完成阅读' }).click()

  await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)
  const reviewUrl = page.url()
  await expect(page.getByRole('heading', { level: 1, name: '读后回顾' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'A completed reading loop' }))
    .toBeVisible()
  await expect(page.getByText('实际耗时')).toBeVisible()
  await expect(page.getByText('完成时间')).toBeVisible()
  await expect(page.getByText('粘贴文本', { exact: true })).toBeVisible()
  await expect.poll(() => readSpeechProbe(page, 'cancelCount'))
    .toBeGreaterThan(cancelCountBeforeCompletion)
  await expect.poll(() => readArticleAttempts(page, articleId)).toEqual([
    expect.objectContaining({
      activeDurationSec: expect.any(Number),
      completedAt: expect.any(String),
      status: 'completed',
    }),
  ])
  await expect.poll(async () => {
    const [completed] = await readArticleAttempts(page, articleId)
    return completed?.activeDurationSec ?? 0
  }).toBeGreaterThanOrEqual(1)

  await page.reload()
  await expect(page).toHaveURL(reviewUrl)
  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
  await page.getByRole('link', { name: '返回阅读库' }).click()
  await expect(page).toHaveURL(/\/$/)
  const articleItem = page.locator(`[data-article-id="${articleId}"]`)
  await expect(articleItem).toContainText('已完成')
  await expect(articleItem.getByRole('progressbar')).toHaveAttribute('value', '100')
  await expect.poll(() => readActiveSentenceId(page, articleId)).toBeNull()

  await page.goto(reviewUrl)
  await page.getByRole('button', { name: '再读一次' }).click()
  await expect(page).toHaveURL(new RegExp(`/read/${articleId}$`))
  await expect.poll(() => readArticleAttempts(page, articleId)).toEqual([
    expect.objectContaining({ status: 'completed' }),
    expect.objectContaining({ status: 'active' }),
  ])
})

test('saved vocabulary survives the complete reading loop without moving durable progress', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await seedArticleInIndexedDb(page, vocabularyLoopArticle)
  const readerPath = `/read/${vocabularyLoopArticle.id}`
  await page.goto(readerPath)
  await expect(page.getByRole('heading', {
    level: 2,
    name: vocabularyLoopArticle.title,
  })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    matchMedia('(min-width: 768px) and (pointer: fine)').matches)).toBe(true)

  const patienceToken = page.locator(
    '[data-word-token-id="stage-4b-vocabulary-loop:s2:t1"]',
  )
  const savedSentence = vocabularyLoopArticle.sentences[0]!
  const savedSentenceElement = page.locator(`[data-sentence-id="${savedSentence.id}"]`)
  const savedToken = page.locator(
    '[data-word-token-id="stage-4b-vocabulary-loop:s1:t1"]',
  )
  await patienceToken.click()
  let wordCard = page.locator('dialog.reader-word-card-overlay')
  await expect(wordCard).toBeVisible()
  await expect(wordCard).not.toHaveAttribute('aria-modal', 'true')
  await expect.poll(() => wordCard.evaluate(element => element.matches(':modal'))).toBe(false)
  await expect(wordCard.getByText(
    '暂无本地释义，仍可收藏这个词和当前原句。',
    { exact: true },
  )).toBeVisible()
  await savedToken.click()
  wordCard = page.locator('dialog.reader-word-card-overlay')
  await expect(wordCard).toBeVisible()
  await expect(wordCard).not.toHaveAttribute('aria-modal', 'true')
  await expect(wordCard.getByRole('heading', { name: 'lantern', exact: true })).toBeFocused()
  await expect(wordCard.getByText('灯笼；提灯', { exact: true })).toBeVisible()
  const saveButton = wordCard.getByRole('button', { name: '收藏单词' })
  await expect(saveButton).toBeEnabled()
  await page.setViewportSize({ width: 1280, height: 300 })
  await saveButton.scrollIntoViewIfNeeded()
  await expect.poll(() => saveButton.evaluate((button) => {
    const bounds = button.getBoundingClientRect()
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    )
    return hit === button || button.contains(hit)
  })).toBe(true)
  await saveButton.click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(wordCard.getByRole('button', { name: '取消收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect.poll(async () => summarizeVocabulary(page)).toEqual({
    contexts: [{
      articleId: vocabularyLoopArticle.id,
      sentenceId: savedSentence.id,
    }],
    terms: [{ normalizedTerm: 'lantern' }],
  })
  await wordCard.getByRole('button', { name: '关闭词卡' }).click()
  await expect(wordCard).toHaveCount(0)
  await expect(savedSentenceElement).toBeFocused()

  await page.reload()
  await expect(page.getByRole('heading', {
    level: 2,
    name: vocabularyLoopArticle.title,
  })).toBeVisible()
  await savedToken.click()
  wordCard = page.locator('dialog.reader-word-card-overlay')
  await expect(wordCard.getByRole('button', { name: '取消收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(wordCard).toBeVisible()
  await expect(wordCard).toHaveAttribute('aria-modal', 'true')
  await expect.poll(() => wordCard.evaluate(element => element.matches(':modal'))).toBe(true)

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(wordCard).not.toHaveAttribute('aria-modal', 'true')
  await expect.poll(() => wordCard.evaluate(element => element.matches(':modal'))).toBe(false)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(wordCard).toHaveAttribute('aria-modal', 'true')
  await expect.poll(() => wordCard.evaluate(element => element.matches(':modal'))).toBe(true)
  await wordCard.getByRole('button', { name: '关闭词卡' }).click()

  const durableSentence = vocabularyLoopArticle.sentences[2]!
  const durableSentenceElement = page.locator(`[data-sentence-id="${durableSentence.id}"]`)
  await durableSentenceElement.click()
  await expect(durableSentenceElement).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => readActiveSentenceId(page, vocabularyLoopArticle.id))
    .toBe(durableSentence.id)
  const attemptsBeforeLocation = await readArticleAttempts(page, vocabularyLoopArticle.id)
  expect(attemptsBeforeLocation).toHaveLength(1)
  expect(attemptsBeforeLocation[0]).toMatchObject({ status: 'active' })

  await page.getByRole('link', { name: '我的阅读' }).click()
  await page.getByRole('link', { name: '收藏词', exact: true }).click()
  await expect(page).toHaveURL(/\/words$/)
  await page.getByLabel('搜索收藏词').fill('LANTERN')
  await expect(page.getByText('找到 1 个词', { exact: true })).toBeVisible()
  const vocabularyDetails = page.locator('.vocabulary-details')
  await expect(vocabularyDetails.getByRole('heading', { name: 'lantern', exact: true }))
    .toBeVisible()
  await expect(vocabularyDetails.getByText('灯笼；提灯', { exact: true })).toBeVisible()
  await expect(vocabularyDetails.getByText(savedSentence.original, { exact: true })).toBeVisible()
  await vocabularyDetails.getByRole('button', { name: '回到原句' }).click()

  await expect.poll(() => page.evaluate(() => ({
    pathname: location.pathname,
    sentence: new URLSearchParams(location.search).get('sentence'),
  }))).toEqual({
    pathname: `/read/${vocabularyLoopArticle.id}`,
    sentence: savedSentence.id,
  })
  const locatedSentence = page.locator(`[data-sentence-id="${savedSentence.id}"]`)
  await expect(locatedSentence).toHaveClass(/reader-article__sentence--located/)
  await expect(locatedSentence).toBeFocused()
  await expect(locatedSentence).not.toHaveAttribute('aria-current', 'true')
  await expect(durableSentenceElement).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => readActiveSentenceId(page, vocabularyLoopArticle.id))
    .toBe(durableSentence.id)
  await expect.poll(async () => (await readArticleAttempts(page, vocabularyLoopArticle.id))
    .map(attempt => ({ id: attempt.id, status: attempt.status }))).toEqual([{
      id: attemptsBeforeLocation[0]!.id,
      status: 'active',
    }])

  await page.getByRole('button', { name: '完成阅读' }).click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)
  const reviewVocabulary = page.locator('.review-vocabulary')
  await expect(reviewVocabulary.getByRole('heading', { name: '本文收藏词' })).toBeVisible()
  await expect(reviewVocabulary.getByRole('heading', { name: 'lantern', exact: true }))
    .toBeVisible()
  await expect(reviewVocabulary.getByText('灯笼；提灯', { exact: true })).toBeVisible()
  await expect(reviewVocabulary.getByText(savedSentence.original, { exact: true })).toBeVisible()
  await reviewVocabulary.getByRole('button', { name: '撤销收藏' }).click()
  await expect(reviewVocabulary.getByText('这篇文章还没有收藏词。回顾仍可完整使用。'))
    .toBeVisible()
  await expect.poll(async () => summarizeVocabulary(page)).toEqual({
    contexts: [],
    terms: [],
  })

  await page.getByRole('link', { name: '我的阅读' }).click()
  await page.getByRole('link', { name: '收藏词', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有收藏词' })).toBeVisible()
  await expect(page.getByText('lantern', { exact: true })).toHaveCount(0)
})

test('completing in one tab stops the same attempt in another tab', async ({ page }) => {
  await installReaderSpeechProbe(page)
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('A shared completion event')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const readerUrl = page.url()

  const secondPage = await page.context().newPage()
  try {
    await installReaderSpeechProbe(secondPage)
    await secondPage.goto(readerUrl)
    await secondPage.getByRole('button', { name: '朗读当前句' }).click()
    await expect(secondPage.getByRole('button', { name: '暂停朗读' })).toBeVisible()
    const cancelCountBeforeCompletion = await readSpeechProbe(secondPage, 'cancelCount')

    await page.getByRole('button', { name: '完成阅读' }).click()
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)

    await expect(secondPage.getByRole('button', { name: '打开读后回顾' })).toBeVisible()
    await expect(secondPage.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
    await expect.poll(() => readSpeechProbe(secondPage, 'cancelCount'))
      .toBeGreaterThan(cancelCountBeforeCompletion)
  }
  finally {
    await secondPage.close()
  }
})

test('a failed Review load survives Reader reload without starting a reread', async ({ page }) => {
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('A recoverable completed reading')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const articleId = page.url().split('/').at(-1) ?? ''
  const reviewModulePattern = '**/src/views/ReviewView.vue*'
  await page.route(reviewModulePattern, route => route.abort())

  await page.getByRole('button', { name: '完成阅读' }).click()
  await expect(page.getByText('阅读已完成，但回顾页面暂时未能打开')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/read/${articleId}$`))
  await expect.poll(() => readArticleAttempts(page, articleId)).toEqual([
    expect.objectContaining({ status: 'completed' }),
  ])

  await page.reload()
  await expect(page.getByRole('button', { name: '打开读后回顾' })).toBeVisible()
  await expect(page.getByRole('button', { name: '完成阅读' })).toHaveCount(0)
  await expect.poll(() => readArticleAttempts(page, articleId)).toEqual([
    expect.objectContaining({ status: 'completed' }),
  ])

  await page.unroute(reviewModulePattern)
  await page.getByRole('button', { name: '打开读后回顾' }).click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]+$/)
})

test('continuous speech follows the reading sentence and stays paused after background recovery', async ({ page }) => {
  await installReaderSpeechProbe(page)
  await page.goto('/import')
  await page.getByLabel('英文正文').fill(importedBody)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByLabel('标题').fill('Continuous local reading')
  await page.getByRole('button', { name: '保存并开始阅读' }).click()

  await expect(page).toHaveURL(/\/read\/[0-9a-f-]+$/)
  const articleId = page.url().split('/').at(-1) ?? ''
  const sentences = page.locator('[data-sentence-id]')
  const firstSentence = sentences.nth(0)
  const secondSentence = sentences.nth(1)
  const secondSentenceId = await secondSentence.getAttribute('data-sentence-id')

  await page.getByRole('button', { name: '朗读当前句' }).click()

  await expect(page.getByRole('button', { name: '暂停朗读' })).toBeVisible()
  await expect(firstSentence).toHaveAttribute('aria-current', 'true')
  await expect(firstSentence).toHaveAttribute('data-playing', 'true')
  await expect.poll(() => readSpeechProbe(page, 'spokenTexts')).toEqual([
    importedSentences[0],
  ])

  await page.evaluate(() => {
    const probe = (window as unknown as {
      __readerSpeechProbe: { finish: () => void }
    }).__readerSpeechProbe
    probe.finish()
  })

  await expect(secondSentence).toHaveAttribute('aria-current', 'true')
  await expect(secondSentence).toHaveAttribute('data-playing', 'true')
  await expect(firstSentence).not.toHaveAttribute('data-playing', 'true')
  await expect.poll(() => readSpeechProbe(page, 'spokenTexts')).toHaveLength(2)
  const cancelCountBeforeBackground = await readSpeechProbe(page, 'cancelCount')

  await page.evaluate(() => {
    const probe = (window as unknown as {
      __readerSpeechProbe: { setVisibility: (state: 'visible' | 'hidden') => void }
    }).__readerSpeechProbe
    probe.setVisibility('hidden')
  })

  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
  await expect(page.locator('[data-playing="true"]')).toHaveCount(0)
  await expect.poll(() => readSpeechProbe(page, 'cancelCount'))
    .toBeGreaterThan(cancelCountBeforeBackground)
  await expect.poll(() => readActiveSentenceId(page, articleId)).toBe(secondSentenceId)

  await page.evaluate(() => {
    const probe = (window as unknown as {
      __readerSpeechProbe: { setVisibility: (state: 'visible' | 'hidden') => void }
    }).__readerSpeechProbe
    probe.setVisibility('visible')
  })
  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
  await expect(page.locator('[data-playing="true"]')).toHaveCount(0)

  await page.evaluate(() => {
    const sentence = document.querySelectorAll<HTMLElement>('[data-sentence-id]')[2]
    sentence?.click()
    window.location.reload()
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(sentences.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-playing="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '暂停朗读' })).toHaveCount(0)
  await expect.poll(() => readSpeechProbe(page, 'spokenTexts')).toEqual([])
})

test('reader display assistance adapts by viewport and only persists durable preferences', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  await page.goto(`/read/${displayAssistanceArticle.id}`)

  await expect(page.getByRole('heading', {
    level: 2,
    name: displayAssistanceArticle.title,
  })).toBeVisible()
  const articleBody = page.locator('.reader-article__body')
  const initialFontSize = await articleBody.evaluate(element =>
    Number.parseFloat(getComputedStyle(element).fontSize))
  await expect(page.getByTestId('sentence-translation')).toHaveCount(0)
  await expect(page.getByTestId('sentence-ipa')).toHaveCount(0)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await page.getByRole('link', { name: displayAssistanceArticle.title, exact: true }).click()
  await expect(page.getByRole('heading', {
    level: 2,
    name: displayAssistanceArticle.title,
  })).toBeVisible()

  const settingsButton = page.getByRole('button', { name: '阅读设置', exact: true })
  await expect(settingsButton).toBeVisible()
  const readBackgroundBounds = () => page.evaluate(() => {
    const reader = document.querySelector('.reader-view')?.getBoundingClientRect()
    const footer = document.querySelector('.reader-view__footer')?.getBoundingClientRect()
    const round = (value: number | undefined) => Math.round((value ?? -1) * 100) / 100
    return {
      readerLeft: round(reader?.left),
      readerRight: round(reader?.right),
      footerLeft: round(footer?.left),
      footerRight: round(footer?.right),
    }
  })
  const backgroundBoundsBeforeSettings = await readBackgroundBounds()
  await settingsButton.focus()
  await settingsButton.click()

  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(settingsDialog).toBeVisible()
  await expect(settingsDialog.getByRole('heading', { name: '调整当前阅读' })).toBeFocused()
  await expect.poll(readBackgroundBounds).toEqual(backgroundBoundsBeforeSettings)
  const ipaToggle = settingsDialog.getByRole('checkbox', { name: /本次阅读显示 IPA/ })
  await page.keyboard.press('Shift+Tab')
  await expect(ipaToggle).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(settingsDialog.getByRole('button', { name: '关闭阅读设置' })).toBeFocused()
  await expect.poll(() => settingsDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const round = (value: number) => Math.round(value * 100) / 100
    return {
      alignedToBottom: Math.abs(bounds.bottom - innerHeight) <= 1,
      spansViewport: Math.abs(bounds.left) <= 1 && Math.abs(bounds.right - innerWidth) <= 1,
      leavesReadingContextVisible: bounds.top > 0,
      leftGap: round(bounds.left),
      rightGap: round(innerWidth - bounds.right),
    }
  })).toEqual({
    alignedToBottom: true,
    spansViewport: true,
    leavesReadingContextVisible: true,
    leftGap: 0,
    rightGap: 0,
  })

  const readerUrl = page.url()
  const readerScrollY = await page.evaluate(() => scrollY)
  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerUrl)
  await expect(settingsButton).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(readerScrollY)

  await settingsButton.click()
  await expect(settingsDialog).toBeVisible()

  const extraLargeFont = settingsDialog.getByRole('radio', { name: /特大/ })
  await settingsDialog.getByText('特大', { exact: true }).click()
  await expect(extraLargeFont).toBeChecked()
  await settingsDialog.getByRole('checkbox', { name: /打开文章时展开译文/ }).check()
  await settingsDialog.getByRole('checkbox', { name: /本次阅读显示 IPA/ }).check()
  await expect(settingsDialog.getByText('字号与译文偏好已保存到此设备')).toBeVisible()
  await expect.poll(() => articleBody.evaluate(element =>
    Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFontSize)

  await page.keyboard.press('Escape')
  await expect(settingsDialog).toHaveCount(0)
  await expect(settingsButton).toBeFocused()

  const currentIpa = page.getByTestId('sentence-ipa')
  await expect(currentIpa).toHaveCount(1)
  await expect(currentIpa).toContainText('ˈfoʊkəst')
  const translationButton = page.getByRole('button', {
    name: '显示第 1 句译文',
    exact: true,
  })
  await expect.poll(() => translationButton.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.width >= 44 && bounds.height >= 44
  })).toBe(true)
  await translationButton.click()
  await expect(page.getByTestId('sentence-translation')).toHaveText(
    displayAssistanceArticle.sentences[0].translation,
  )
  await expect(page.getByRole('button', { name: /第 2 句译文/ })).toHaveCount(0)

  const secondSentence = page.locator('[data-sentence-id]').nth(1)
  await secondSentence.click()
  await expect(secondSentence).toHaveAttribute('aria-current', 'true')
  await expect(currentIpa).toHaveCount(1)
  await expect(currentIpa).toContainText(displayAssistanceArticle.sentences[1].sentenceIpa)
  await expect(currentIpa).not.toContainText('ˈfoʊkəst')

  await page.reload()
  await expect(page.getByRole('heading', {
    level: 2,
    name: displayAssistanceArticle.title,
  })).toBeVisible()
  await expect(page.getByTestId('sentence-translation')).toHaveText(
    displayAssistanceArticle.sentences[0].translation,
  )
  await expect(page.getByTestId('sentence-ipa')).toHaveCount(0)
  await expect.poll(() => articleBody.evaluate(element =>
    Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFontSize)

  await settingsButton.click()
  await expect(settingsDialog.getByRole('radio', { name: /特大/ })).toBeChecked()
  await expect(settingsDialog.getByRole('checkbox', { name: /打开文章时展开译文/ })).toBeChecked()
  await expect(settingsDialog.getByRole('checkbox', { name: /本次阅读显示 IPA/ })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(settingsButton).toBeFocused()

  await page.setViewportSize({ width: 1440, height: 1000 })
  await settingsButton.click()
  await expect(settingsDialog).toBeVisible()
  await expect.poll(() => settingsDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const round = (value: number) => Math.round(value * 100) / 100
    return {
      alignedToRight: Math.abs(bounds.right - innerWidth) <= 1,
      fillsHeight: Math.abs(bounds.top) <= 1 && Math.abs(bounds.bottom - innerHeight) <= 1,
      remainsASidePanel: bounds.left > innerWidth / 2 && bounds.width < innerWidth / 2,
      rightGap: round(innerWidth - bounds.right),
    }
  })).toEqual({
    alignedToRight: true,
    fillsHeight: true,
    remainsASidePanel: true,
    rightGap: 0,
  })
})

test('rapid browser back closes reader settings without skipping the direct predecessor', async ({
  page,
}) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()

  await page.getByRole('link', { name: '我的阅读', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', {
    name: displayAssistanceArticle.title,
    exact: true,
  }).click()
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await expect(page).toHaveURL(readerPath)
  await expect(page.getByRole('heading', {
    level: 2,
    name: displayAssistanceArticle.title,
  })).toBeVisible()

  const readerPosition = await page.evaluate(() => history.state.position as number)
  const settingsButton = page.getByRole('button', { name: '阅读设置', exact: true })
  await settingsButton.click()
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => new Promise<void>((resolve) => {
    addEventListener('popstate', () => resolve(), { once: true })
    history.back()
    history.back()
  }))

  await expect(settingsDialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => ({
    current: history.state.current as string,
    pathname: location.pathname,
    position: history.state.position as number,
    readerVisible: document.querySelector('.reader-view') !== null,
  }))).toEqual({
    current: readerPath,
    pathname: readerPath,
    position: readerPosition,
    readerVisible: true,
  })
  await expect(settingsButton).toBeFocused()

  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: '我的阅读' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => history.state.position as number))
    .toBe(readerPosition - 1)
})

test('programmatic replace waits for rapid Reader settings history repair', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  await page.goto('/import')
  await expect(page.getByRole('heading', { level: 1, name: '导入内容' })).toBeVisible()
  await page.goto(`/read/${displayAssistanceArticle.id}`)
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toBeVisible()

  await page.evaluate(async () => {
    const appRoot = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: {
        config: {
          globalProperties: {
            $router: {
              replace: (location: string) => Promise<unknown>
            }
          }
        }
      }
    }
    const router = appRoot.__vue_app__?.config.globalProperties.$router
    if (!router) {
      throw new Error('Vue Router was not available to the history-race probe.')
    }
    const replacements = new Promise<void>((resolve, reject) => {
      addEventListener('popstate', () => {
        void (async () => {
          await router.replace('/settings')
          await router.replace('/settings')
          resolve()
        })().catch(reject)
      }, { once: true })
    })
    history.back()
    history.back()
    await replacements
  })

  await expect(page).toHaveURL('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  await expect(page.locator('.reader-view')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    history.state.__yomuRouteHistoryLayer ?? null)).toBeNull()

  await page.reload()
  await expect(page).toHaveURL('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
})

test('a cross-document back closes Reader settings before leaving the deep link', async ({
  page,
}) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  await page.goto('http://localhost:57241/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()

  const readerUrl = `http://127.0.0.1:57241/read/${displayAssistanceArticle.id}`
  await page.goto(readerUrl)
  await expect(page.getByRole('heading', {
    level: 1,
    name: displayAssistanceArticle.title,
  })).toBeVisible()

  const readerPosition = await page.evaluate(() => history.state.position as number)
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => {
    history.back()
    history.back()
  })
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerUrl)
  await expect.poll(() => page.evaluate(() => ({
    hasLayerMarker: '__yomuRouteHistoryLayer' in history.state,
    position: history.state.position as number,
  }))).toEqual({
    hasLayerMarker: false,
    position: readerPosition,
  })
  await expect(page.getByRole('heading', {
    level: 1,
    name: displayAssistanceArticle.title,
  })).toBeVisible()

  await page.evaluate(() => history.forward())
  await expect(settingsDialog).toBeVisible()
  await expect(page).toHaveURL(readerUrl)

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerUrl)

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL('http://localhost:57241/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
})

test('Reader settings restore from their history marker after reload', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto(readerPath)
  await expect(page.getByRole('heading', {
    level: 1,
    name: displayAssistanceArticle.title,
  })).toBeVisible()

  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toBeVisible()
  await page.reload()

  const restoredDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(restoredDialog).toBeVisible()
  await page.evaluate(() => history.back())
  await expect(restoredDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerPath)
})

test('Back closes a reloaded settings marker before the overlay mounts', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto(readerPath)
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toBeVisible()

  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('.reader-view')
        && !document.querySelector('#reader-settings[open]')) {
        observer.disconnect()
        ;(window as typeof window & { __readerLoadingBackTriggered?: boolean })
          .__readerLoadingBackTriggered = true
        history.back()
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.reload()

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __readerLoadingBackTriggered?: boolean })
      .__readerLoadingBackTriggered ?? false)).toBe(true)
  await expect(page).toHaveURL(readerPath)
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '阅读设置', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    hasLayerMarker: Boolean(history.state.__yomuRouteHistoryLayer),
    pathname: location.pathname,
  }))).toEqual({
    hasLayerMarker: false,
    pathname: readerPath,
  })
})

test('navigation closes a reloaded settings marker before the overlay mounts without history debt', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto('/import')
  await page.goto(readerPath)
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toBeVisible()

  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const readerBack = document.querySelector<HTMLAnchorElement>('.reader-view__back')
      if (readerBack && !document.querySelector('#reader-settings[open]')) {
        observer.disconnect()
        ;(window as typeof window & { __readerLoadingNavigationTriggered?: boolean })
          .__readerLoadingNavigationTriggered = true
        readerBack.click()
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.reload()

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __readerLoadingNavigationTriggered?: boolean })
      .__readerLoadingNavigationTriggered ?? false)).toBe(true)
  await expect(page).toHaveURL(readerPath)
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    Boolean(history.state.__yomuRouteHistoryLayer))).toBe(false)

  await page.getByRole('link', { name: '我的阅读' }).click()
  await expect(page).toHaveURL('/')
  await page.goBack()
  await expect(page).toHaveURL(readerPath)
  await page.goBack()
  await expect(page).toHaveURL('/import')
})

test('Reader settings forward marker survives a reload of its base entry', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto(readerPath)
  const settingsButton = page.getByRole('button', { name: '阅读设置', exact: true })
  await settingsButton.click()
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await page.reload()
  await expect(settingsButton).toBeVisible()

  await page.evaluate(() => history.forward())
  await expect(settingsDialog).toBeVisible()
  await expect(page).toHaveURL(readerPath)

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerPath)
})

test('multi-step Forward adopts the Reader settings marker without history debt', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto('/import')
  await expect(page.getByRole('heading', { level: 1, name: '导入内容' })).toBeVisible()
  await page.evaluate(async (path) => {
    const appRoot = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: {
        config: {
          globalProperties: {
            $router: { push: (location: string) => Promise<unknown> }
          }
        }
      }
    }
    const router = appRoot.__vue_app__?.config.globalProperties.$router
    if (!router) {
      throw new Error('Vue Router was not available to the Forward probe.')
    }
    await router.push(path)
  }, readerPath)
  await expect(page).toHaveURL(readerPath)
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerPath)
  await page.goBack()
  await expect(page).toHaveURL('/import')
  await expect(page.getByRole('heading', { level: 1, name: '导入内容' })).toBeVisible()

  await page.evaluate(() => history.go(2))
  await expect(page).toHaveURL(readerPath)
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await expect(page).toHaveURL(readerPath)
  await page.goBack()
  await expect(page).toHaveURL('/import')
})

test('a multi-step Forward guard redirect replaces the Reader settings marker', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto('/import')
  await expect(page.getByRole('heading', { level: 1, name: '导入内容' })).toBeVisible()
  await page.evaluate(async (path) => {
    const appRoot = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: {
        config: {
          globalProperties: {
            $router: { push: (location: string) => Promise<unknown> }
          }
        }
      }
    }
    const router = appRoot.__vue_app__?.config.globalProperties.$router
    if (!router) {
      throw new Error('Vue Router was not available to the redirect probe.')
    }
    await router.push(path)
  }, readerPath)
  await expect(page).toHaveURL(readerPath)
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  await expect(settingsDialog).toBeVisible()

  await page.evaluate(() => history.back())
  await expect(settingsDialog).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL('/import')

  await page.evaluate((path) => {
    const appRoot = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: {
        config: {
          globalProperties: {
            $router: {
              beforeEach: (
                guard: (to: { fullPath: string }) => true | Record<string, unknown>,
              ) => () => void
            }
          }
        }
      }
    }
    const router = appRoot.__vue_app__?.config.globalProperties.$router
    if (!router) {
      throw new Error('Vue Router was not available to install the redirect probe.')
    }
    let redirectArrival = true
    router.beforeEach((to) => {
      if (redirectArrival && to.fullPath === path) {
        redirectArrival = false
        return {
          hash: '#arrival',
          path: '/settings',
          query: { from: 'reader' },
          state: { arrivalRedirect: 'preserved' },
        }
      }
      return true
    })
    history.go(2)
  }, readerPath)

  await expect(page).toHaveURL('/settings?from=reader#arrival')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    marker: history.state.__yomuRouteHistoryLayer ?? null,
    state: history.state.arrivalRedirect ?? null,
  }))).toEqual({ marker: null, state: 'preserved' })

  await page.goBack()
  await expect(page).toHaveURL(readerPath)
  await expect(settingsDialog).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL('/import')
})

test('a stale Reader settings marker cannot reactivate after reload', async ({ page }) => {
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  const readerPath = `/read/${displayAssistanceArticle.id}`
  await page.goto(readerPath)
  await page.getByRole('button', { name: '阅读设置', exact: true }).click()
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })
  await expect(settingsDialog).toBeVisible()

  await page.evaluate((stalePath) => {
    const currentState = history.state as Record<string, unknown> & { position: number }
    history.pushState({
      ...currentState,
      back: currentState.current ?? location.pathname,
      current: stalePath,
      forward: null,
      position: currentState.position + 1,
      replaced: false,
      scroll: null,
    }, '', stalePath)
  }, '/read/stale-history-entry')
  await settingsDialog.getByRole('button', { name: '关闭阅读设置' }).click()
  await expect(settingsDialog).toHaveCount(0)

  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(readerPath)
  await expect.poll(() => page.evaluate(() =>
    history.state.__yomuRouteHistoryLayer ?? null)).toBeNull()

  await page.reload()
  await expect(page).toHaveURL(readerPath)
  await expect(page.getByRole('dialog', { name: '调整当前阅读' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '阅读设置', exact: true })).toBeVisible()
})

test('reader settings keep backdrop scrolling from moving the reading position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await seedArticleInIndexedDb(page, displayAssistanceArticle)
  await page.goto(`/read/${displayAssistanceArticle.id}`)
  await expect(page.getByRole('heading', {
    level: 2,
    name: displayAssistanceArticle.title,
  })).toBeVisible()
  await page.evaluate(() => {
    document.body.style.minHeight = '300vh'
    scrollTo(0, 0)
  })

  const settingsButton = page.getByRole('button', { name: '阅读设置', exact: true })
  const settingsDialog = page.getByRole('dialog', { name: '调整当前阅读' })

  await settingsButton.click()
  await expect(settingsDialog).toBeVisible()
  await page.mouse.move(12, 12)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(settingsDialog).toHaveCount(0)

  await page.evaluate(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: undefined,
    })
  })
  await settingsButton.click()
  await expect(settingsDialog).toBeVisible()
  await expect(settingsDialog).toHaveAttribute('data-modal-fallback', '')
  await page.mouse.move(12, 12)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(settingsDialog).toHaveCount(0)
  await expect(settingsButton).toBeFocused()
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

  const settingsLink = page.getByRole('link', { name: '设置', exact: true })
  await settingsLink.click({ noWaitAfter: true })
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/import$/)
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(settingsLink).toBeFocused()

  await settingsLink.click({ noWaitAfter: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '继续编辑' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(settingsLink).toBeFocused()
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

test('browser back keeps the import draft until the confirmation is resolved', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '我的阅读', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', { name: '导入内容', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)

  await page.evaluate(() => history.back())
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await expect(bodyField).toHaveValue(importedBody)

  await page.evaluate(() => history.back())
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/import$/)
  await expect(bodyField).toHaveValue(importedBody)

  await page.evaluate(() => history.back())
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
})

test('rapid browser back keeps the import URL, route, and draft coherent', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '我的阅读', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', { name: '导入内容', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)

  await page.evaluate(() => new Promise<void>((resolve) => {
    addEventListener('popstate', () => resolve(), { once: true })
    history.back()
    history.back()
  }))
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  // WebKit may coalesce the burst into one pop while Chromium reports both.
  await expect.poll(async () => {
    if (await dialog.isVisible()) {
      return true
    }
    return page.evaluate(() => location.pathname === '/import'
      && document.querySelector('[data-page-heading]')?.textContent?.trim() === '导入内容')
  }).toBe(true)
  if (await dialog.isVisible()) {
    await page.keyboard.press('Escape')
  }

  await expect(page).toHaveURL(/\/import$/)
  await expect(page.getByRole('heading', { level: 1, name: '导入内容' })).toBeVisible()
  await expect(bodyField).toHaveValue(importedBody)
})

test('rapid back restores the exact duplicate-URL history entry', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '导入内容', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)
  await page.getByRole('link', { name: '我的阅读', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', { name: '导入内容', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)

  const originPosition = await page.evaluate(() => history.state.position as number)
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)
  await page.evaluate(() => new Promise<void>((resolve) => {
    addEventListener('popstate', () => resolve(), { once: true })
    history.back()
    history.back()
  }))

  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect.poll(async () => {
    if (await dialog.isVisible()) {
      return 'dialog'
    }
    return page.evaluate((expectedPosition) =>
      location.pathname === '/import' && history.state.position === expectedPosition
        ? 'stable'
        : 'pending', originPosition)
  }).toMatch(/^(dialog|stable)$/)
  if (await dialog.isVisible()) {
    await page.keyboard.press('Escape')
  }
  await expect(page).toHaveURL(/\/import$/)
  await expect.poll(() => page.evaluate(() => history.state.position as number))
    .toBe(originPosition)
  await expect(bodyField).toHaveValue(importedBody)

  await bodyField.fill('')
  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate(() => history.state.position as number))
    .toBe(originPosition - 1)
})

test('browser forward preserves its history entry through both decisions', async ({ page }) => {
  await page.goto('/import')
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(/\/import$/)

  const importPosition = await page.evaluate(() => history.state.position as number)
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)
  await page.evaluate(() => history.forward())
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '继续编辑' }).click()
  await expect(page).toHaveURL(/\/import$/)
  await expect.poll(() => page.evaluate(() => history.state.position as number))
    .toBe(importPosition)

  await page.evaluate(() => history.forward())
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect.poll(() => page.evaluate(() => history.state.position as number))
    .toBe(importPosition + 1)

  await page.evaluate(() => history.back())
  await expect(page).toHaveURL(/\/import$/)
})

test('a rejected discard navigation keeps the import draft without a page error', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))
  await page.route('**/src/views/VocabularyView.vue*', route => route.abort('failed'))
  await page.goto('/import')
  const bodyField = page.getByLabel('英文正文')
  await bodyField.fill(importedBody)

  const wordsLink = page.getByRole('link', { name: '收藏词', exact: true })
  await wordsLink.click({ noWaitAfter: true })
  const dialog = page.getByRole('dialog', { name: '放弃未保存的导入？' })
  await expect(dialog).toBeVisible()
  const failedRequest = page.waitForEvent(
    'requestfailed',
    request => request.url().includes('/src/views/VocabularyView.vue'),
  )
  await dialog.getByRole('button', { name: '放弃并离开' }).click()
  await failedRequest
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  await expect(page).toHaveURL(/\/import$/)
  await expect(bodyField).toHaveValue(importedBody)
  await expect(dialog).toHaveCount(0)
  await expect(wordsLink).toBeFocused()
  expect(pageErrors).toEqual([])
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

async function seedArticleInIndexedDb(
  page: Page,
  article: ArticleRecord,
): Promise<void> {
  expect(isArticleRecord(article)).toBe(true)
  await page.goto('/')
  await expect(page.getByTestId('library-empty-state')).toBeVisible()
  await page.evaluate(async (record) => {
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
          transaction.error ?? new Error('Article seed transaction was aborted.'),
        )
        transaction.onerror = () => reject(
          transaction.error ?? new Error('Article seed transaction failed.'),
        )
        transaction.objectStore('articles').put(record)
      })
    }
    finally {
      database.close()
    }
  }, article)
}

async function summarizeVocabulary(page: Page): Promise<{
  contexts: Array<{ articleId: string, sentenceId: string }>
  terms: Array<{ normalizedTerm: string }>
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yomu-v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(
        ['vocabularyTerms', 'vocabularyContexts'],
        'readonly',
      )
      const readAll = (storeName: 'vocabularyTerms' | 'vocabularyContexts') =>
        new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const [terms, contexts] = await Promise.all([
        readAll('vocabularyTerms'),
        readAll('vocabularyContexts'),
      ])
      return {
        contexts: contexts
          .flatMap(context => typeof context.articleId === 'string'
            && typeof context.sentenceId === 'string'
            ? [{
                articleId: context.articleId,
                sentenceId: context.sentenceId,
              }]
            : [])
          .sort((left, right) => left.articleId.localeCompare(right.articleId)
            || left.sentenceId.localeCompare(right.sentenceId)),
        terms: terms
          .flatMap(term => typeof term.normalizedTerm === 'string'
            ? [{ normalizedTerm: term.normalizedTerm }]
            : [])
          .sort((left, right) => left.normalizedTerm.localeCompare(right.normalizedTerm)),
      }
    }
    finally {
      database.close()
    }
  })
}

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

async function installReaderSpeechProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spokenTexts: string[] = []
    let cancelCount = 0
    let visibilityState: DocumentVisibilityState = 'visible'

    class TestSpeechSynthesisUtterance extends EventTarget {
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
    let activeUtterance: TestSpeechSynthesisUtterance | null = null

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: TestSpeechSynthesisUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {
          cancelCount += 1
          activeUtterance = null
        },
        getVoices: () => [],
        pause() {},
        resume() {},
        speak(utterance: TestSpeechSynthesisUtterance) {
          activeUtterance = utterance
          spokenTexts.push(utterance.text)
          utterance.onstart?.()
        },
      },
    })
    Object.defineProperty(window, '__readerSpeechProbe', {
      configurable: true,
      value: {
        get cancelCount() {
          return cancelCount
        },
        spokenTexts,
        finish() {
          const utterance = activeUtterance
          activeUtterance = null
          utterance?.onend?.()
        },
        setVisibility(state: DocumentVisibilityState) {
          visibilityState = state
          document.dispatchEvent(new Event('visibilitychange'))
        },
      },
    })
  })
}

function readSpeechProbe(page: Page, key: 'spokenTexts'): Promise<string[]>
function readSpeechProbe(page: Page, key: 'cancelCount'): Promise<number>
async function readSpeechProbe(
  page: Page,
  key: 'spokenTexts' | 'cancelCount',
): Promise<string[] | number> {
  return page.evaluate((probeKey) => {
    const probe = (window as unknown as {
      __readerSpeechProbe: { spokenTexts: string[], cancelCount: number }
    }).__readerSpeechProbe
    return probe[probeKey]
  }, key)
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

async function readArticleAttempts(page: Page, articleId: string): Promise<Array<{
  activeDurationSec: number
  completedAt?: string
  id: string
  status: 'active' | 'completed'
}>> {
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
        completedAt?: unknown
        id?: unknown
        status?: unknown
      }>>((resolve, reject) => {
        const transaction = database.transaction('attempts', 'readonly')
        const request = transaction.objectStore('attempts').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return attempts
        .filter((attempt): attempt is typeof attempt & {
          activeDurationSec: number
          id: string
          status: 'active' | 'completed'
        } => attempt.articleId === targetArticleId
          && typeof attempt.activeDurationSec === 'number'
          && typeof attempt.id === 'string'
          && (attempt.status === 'active' || attempt.status === 'completed'))
        .map(attempt => ({
          activeDurationSec: attempt.activeDurationSec,
          ...(typeof attempt.completedAt === 'string'
            ? { completedAt: attempt.completedAt }
            : {}),
          id: attempt.id,
          status: attempt.status,
        }))
        .sort((left, right) => {
          if (left.status !== right.status) {
            return left.status === 'completed' ? -1 : 1
          }
          return left.id.localeCompare(right.id)
        })
    }
    finally {
      database.close()
    }
  }, articleId)
}
