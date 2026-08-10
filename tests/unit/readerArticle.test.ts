import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReaderArticle from '@/components/reader/ReaderArticle.vue'
import type { ArticleRecord } from '@/data/entities'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('ReaderArticle', () => {
  it('keeps only the current sentence in the Tab order for a long article', async () => {
    const article = createArticle(240)
    const initialSentence = article.sentences[117]!
    const { host, selectedSentenceIds } = mountArticle(article, initialSentence.id)

    const sentences = [...host.querySelectorAll<HTMLButtonElement>('[data-sentence-id]')]
    expect(sentences).toHaveLength(240)
    expect(sentences.filter(sentence => sentence.tabIndex === 0)).toEqual([
      sentences[117],
    ])
    expect(sentences.filter(sentence => sentence.tabIndex === -1)).toHaveLength(239)
    expect(sentences.filter(sentence => sentence.getAttribute('aria-current') === 'true'))
      .toEqual([sentences[117]])

    const clickedSentence = sentences[203]!
    clickedSentence.click()
    await nextTick()

    expect(selectedSentenceIds).toEqual([article.sentences[203]!.id])
    expect(document.activeElement).toBe(clickedSentence)
    expect(clickedSentence.tabIndex).toBe(0)
    expect(clickedSentence.getAttribute('aria-current')).toBe('true')
    expect(sentences[117]!.tabIndex).toBe(-1)
    expect(sentences[117]!.hasAttribute('aria-current')).toBe(false)
    expect(sentences.filter(sentence => sentence.tabIndex === 0)).toEqual([clickedSentence])
  })

  it('moves selection and focus between sentences with roving-focus keys', async () => {
    const article = createArticle(16)
    const { host, selectedSentenceIds } = mountArticle(article, article.sentences[7]!.id)
    const sentences = [...host.querySelectorAll<HTMLButtonElement>('[data-sentence-id]')]
    const currentSentence = sentences[7]!
    currentSentence.focus()

    const nextEvent = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    currentSentence.dispatchEvent(nextEvent)
    await nextTick()

    expect(nextEvent.defaultPrevented).toBe(true)
    expect(selectedSentenceIds).toEqual([article.sentences[8]!.id])
    expect(document.activeElement).toBe(sentences[8])
    expect(sentences[8]!.tabIndex).toBe(0)
    expect(currentSentence.tabIndex).toBe(-1)

    const endEvent = new KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
      cancelable: true,
    })
    sentences[8]!.dispatchEvent(endEvent)
    await nextTick()

    expect(selectedSentenceIds).toEqual([
      article.sentences[8]!.id,
      article.sentences[15]!.id,
    ])
    expect(document.activeElement).toBe(sentences[15])
    expect(sentences[15]!.tabIndex).toBe(0)
    expect(sentences.filter(sentence => sentence.tabIndex === 0)).toEqual([sentences[15]])
  })

  it('renders sentence assistance from actual data without token Tab stops', async () => {
    const article = createArticle(3)
    article.sentences[0] = {
      ...article.sentences[0]!,
      translation: '这是第一句译文。',
    }
    article.sentences[1] = {
      ...article.sentences[1]!,
      tokens: [
        { id: 'token-reading', text: 'Reading', kind: 'word', ipa: 'ˈriːdɪŋ' },
        { id: 'token-helps', text: 'helps', kind: 'word', ipa: '/helps/' },
        { id: 'token-period', text: '.', kind: 'punctuation' },
      ],
    }

    const { host, showIpa } = mountArticle(article, article.sentences[0]!.id)
    const translationToggle = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.getAttribute('aria-label') === '显示第 1 句译文')
    expect(translationToggle).not.toBeUndefined()
    expect(translationToggle?.hasAttribute('aria-controls')).toBe(false)
    expect(host.querySelector('[data-testid="sentence-translation"]')).toBeNull()

    translationToggle?.click()
    await nextTick()
    const translation = host.querySelector<HTMLElement>('[data-testid="sentence-translation"]')
    expect(translationToggle?.getAttribute('aria-controls')).toBe(translation?.id)
    expect(translation?.textContent)
      .toContain('这是第一句译文。')

    showIpa.value = true
    host.querySelectorAll<HTMLButtonElement>('[data-sentence-id]')[1]?.click()
    await nextTick()

    expect(host.querySelector('[data-testid="sentence-ipa"]')?.textContent)
      .toContain('/ˈriːdɪŋ/')
    expect(host.querySelector('[data-testid="sentence-ipa"]')?.textContent)
      .toContain('/helps/')
    expect(host.querySelector('[data-testid="sentence-ipa"]')?.textContent)
      .not.toContain('//helps//')
    expect(host.querySelector('[data-testid="sentence-translation"]')?.textContent)
      .toContain('这是第一句译文。')
    expect(host.querySelectorAll('[data-testid="sentence-ipa"] button')).toHaveLength(0)
    expect(host.querySelectorAll<HTMLButtonElement>('[data-sentence-id][tabindex="0"]'))
      .toHaveLength(1)
  })

  it('normalizes one-sided IPA delimiters and falls back from delimiter-only sentence IPA', async () => {
    const article = createArticle(2)
    article.sentences[0] = {
      ...article.sentences[0]!,
      sentenceIpa: ' / ',
      tokens: [
        { id: 'token-leading', text: 'Leading', kind: 'word', ipa: '/ˈliːdɪŋ' },
        { id: 'token-trailing', text: 'trailing', kind: 'word', ipa: 'treɪlɪŋ/' },
        { id: 'token-delimiter', text: 'Delimiter', kind: 'word', ipa: '//' },
      ],
    }
    article.sentences[1] = {
      ...article.sentences[1]!,
      sentenceIpa: '/ˈsentəns',
    }

    const { host } = mountArticle(article, article.sentences[0]!.id, { showIpa: true })
    const firstIpa = host.querySelector<HTMLElement>('[data-testid="sentence-ipa"]')

    expect(firstIpa?.querySelector('.reader-article__sentence-ipa')).toBeNull()
    expect(firstIpa?.textContent).toContain('/ˈliːdɪŋ/')
    expect(firstIpa?.textContent).toContain('/treɪlɪŋ/')
    expect(firstIpa?.textContent).not.toContain('Delimiter')
    expect(firstIpa?.textContent).not.toContain('//')

    host.querySelectorAll<HTMLButtonElement>('[data-sentence-id]')[1]?.click()
    await nextTick()

    const secondIpa = host.querySelector<HTMLElement>('[data-testid="sentence-ipa"]')
    expect(secondIpa?.textContent).toContain('/ˈsentəns/')
    expect(secondIpa?.textContent).not.toContain('//ˈsentəns/')
  })

  it('checks expanded translations without scanning the expanded id collection', async () => {
    const article = createArticle(160)
    article.sentences = article.sentences.map((sentence, index) => ({
      ...sentence,
      translation: `第 ${index + 1} 句译文。`,
    }))
    const originalIncludes = Array.prototype.includes
    let expandedIdScans = 0
    const includesSpy = vi.spyOn(Array.prototype, 'includes').mockImplementation(function (
      this: unknown[],
      searchElement: unknown,
      fromIndex?: number,
    ) {
      if (this.length === article.sentences.length
        && this[0] === article.sentences[0]?.id
        && this.at(-1) === article.sentences.at(-1)?.id) {
        expandedIdScans += 1
      }
      return originalIncludes.call(this, searchElement, fromIndex)
    })

    try {
      const { host } = mountArticle(article, article.sentences[0]!.id, {
        defaultExpandTranslation: true,
      })
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(160)
    const translationToggles = [
      ...host.querySelectorAll<HTMLButtonElement>('.reader-article__translation-toggle'),
    ]
    expect(translationToggles.filter(button => button.tabIndex === 0))
      .toEqual([translationToggles[0]])
    expect(translationToggles.slice(1).every(button => button.tabIndex === -1)).toBe(true)

      host.querySelectorAll<HTMLButtonElement>('.reader-article__translation-toggle')[159]?.click()
      await nextTick()

      expect(expandedIdScans).toBe(0)
      expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(159)
    }
    finally {
      includesSpy.mockRestore()
    }
  })

  it('keeps a translation action available for every translated sentence', () => {
    const article = createArticle(3)
    article.sentences[0] = { ...article.sentences[0]!, translation: '第一句。' }
    article.sentences[2] = { ...article.sentences[2]!, translation: '第三句。' }

    const { host } = mountArticle(article, article.sentences[1]!.id)
    const translationActions = [
      ...host.querySelectorAll<HTMLButtonElement>('.reader-article__translation-toggle'),
    ]

    expect(translationActions.map(button => button.getAttribute('aria-label'))).toEqual([
      '显示第 1 句译文',
      '显示第 3 句译文',
    ])
  })

  it('applies the stored translation default once after preferences become ready', async () => {
    const article = createArticle(2)
    article.sentences = article.sentences.map((sentence, index) => ({
      ...sentence,
      translation: `第 ${index + 1} 句译文。`,
    }))
    const { defaultExpandTranslation, host, preferencesReady } = mountArticle(
      article,
      article.sentences[0]!.id,
      {
        defaultExpandTranslation: true,
        preferencesReady: false,
      },
    )

    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(0)
    preferencesReady.value = true
    await nextTick()
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(2)

    defaultExpandTranslation.value = false
    await nextTick()
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(2)
  })

  it('preserves a translation choice made before preferences finish loading', async () => {
    const article = createArticle(1)
    article.sentences[0] = { ...article.sentences[0]!, translation: '提前展开的译文。' }
    const { host, preferencesReady } = mountArticle(article, article.sentences[0]!.id, {
      defaultExpandTranslation: false,
      preferencesReady: false,
    })

    host.querySelector<HTMLButtonElement>('.reader-article__translation-toggle')?.click()
    await nextTick()
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(1)

    preferencesReady.value = true
    await nextTick()
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(1)
  })

  it('resets touched translation state and reapplies the default for a new article', async () => {
    const firstArticle = createArticle(1, 'reader-article-first')
    firstArticle.sentences[0] = {
      ...firstArticle.sentences[0]!,
      translation: '第一篇的译文。',
    }
    const secondArticle = createArticle(2, 'reader-article-second')
    secondArticle.sentences = secondArticle.sentences.map((sentence, index) => ({
      ...sentence,
      translation: `第二篇第 ${index + 1} 句译文。`,
    }))
    const { article, host } = mountArticle(firstArticle, firstArticle.sentences[0]!.id, {
      defaultExpandTranslation: true,
    })

    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(1)
    host.querySelector<HTMLButtonElement>('.reader-article__translation-toggle')?.click()
    await nextTick()
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(0)

    article.value = secondArticle
    await nextTick()

    expect(host.textContent).toContain('第二篇第 1 句译文。')
    expect(host.querySelectorAll('[data-testid="sentence-translation"]')).toHaveLength(2)
  })
})

interface MountArticleOptions {
  defaultExpandTranslation?: boolean
  preferencesReady?: boolean
  showIpa?: boolean
}

function mountArticle(
  article: ArticleRecord,
  initialSentenceId: string,
  options: MountArticleOptions = {},
) {
  const articleRef = shallowRef(article)
  const currentSentenceId = shallowRef(initialSentenceId)
  const defaultExpandTranslation = shallowRef(options.defaultExpandTranslation ?? false)
  const preferencesReady = shallowRef(options.preferencesReady ?? true)
  const showIpa = shallowRef(options.showIpa ?? false)
  const selectedSentenceIds: string[] = []
  const Root = defineComponent({
    setup() {
      return () => h(ReaderArticle, {
        article: articleRef.value,
        currentSentenceId: currentSentenceId.value,
        defaultExpandTranslation: defaultExpandTranslation.value,
        fontScale: 1,
        playingSentenceId: null,
        preferencesReady: preferencesReady.value,
        showIpa: showIpa.value,
        onSelectSentence: (sentenceId: string) => {
          selectedSentenceIds.push(sentenceId)
          currentSentenceId.value = sentenceId
        },
      })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Root)
  mountedApps.push(app)
  app.mount(host)

  return {
    article: articleRef,
    defaultExpandTranslation,
    host,
    preferencesReady,
    selectedSentenceIds,
    showIpa,
  }
}

function createArticle(sentenceCount: number, articleId = 'reader-article'): ArticleRecord {
  return {
    id: articleId,
    schemaVersion: 2,
    contentHash: 'reader-article-hash',
    title: 'A long article for focused reading',
    language: 'en',
    level: 'unassessed',
    source: { kind: 'paste', label: '粘贴文本' },
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
    sentences: Array.from({ length: sentenceCount }, (_, index) => ({
      id: `${articleId}:s${index + 1}`,
      order: index,
      paragraphIndex: Math.floor(index / 8),
      textHash: `reader-sentence-${index + 1}`,
      original: `This is sentence ${index + 1} in the article.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: sentenceCount * 7,
    estimatedReadTimeMinutes: Math.max(1, Math.ceil(sentenceCount / 20)),
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
  }
}
