import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

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
})

function mountArticle(article: ArticleRecord, initialSentenceId: string) {
  const currentSentenceId = shallowRef(initialSentenceId)
  const selectedSentenceIds: string[] = []
  const Root = defineComponent({
    setup() {
      return () => h(ReaderArticle, {
        article,
        currentSentenceId: currentSentenceId.value,
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

  return { host, selectedSentenceIds }
}

function createArticle(sentenceCount: number): ArticleRecord {
  return {
    id: 'reader-article',
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
      id: `reader-article:s${index + 1}`,
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
