import { describe, expect, it } from 'vitest'

import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { createLibraryViewModel } from '@/features/library/libraryViewModel'

describe('library view model', () => {
  it('sorts by recent activity and derives one real continue-reading card', () => {
    const older = createArticle('older', 'Older article')
    const recent = createArticle('recent', 'Recent article')
    const attempts: ReadingAttempt[] = [
      createAttempt('older', '2026-08-03T08:00:00.000Z', 1),
      createAttempt('recent', '2026-08-04T08:00:00.000Z', 2),
    ]

    const result = createLibraryViewModel(
      [older, recent],
      attempts,
      new Date('2026-08-04T09:00:00.000Z'),
    )

    expect(result.articles.map(article => article.id)).toEqual(['recent', 'older'])
    expect(result.continueReading).toMatchObject({
      id: 'recent',
      progress: 75,
      currentSentenceLabel: '第 3 / 4 句',
      status: '阅读中',
      lastOpenedLabel: '1 小时前',
    })
  })

  it('caps an active attempt on the final sentence below completion', () => {
    const article = createArticle('active-final', 'Active final sentence')
    const result = createLibraryViewModel(
      [article],
      [createAttempt('active-final', '2026-08-04T08:00:00.000Z', 3)],
    )

    expect(result.articles[0]).toMatchObject({
      progress: 99,
      status: '阅读中',
    })
  })

  it('maps unassessed content and completed attempts without fake availability', () => {
    const article = createArticle('complete', 'Completed article')
    const completed = {
      ...createAttempt('complete', '2026-08-03T08:00:00.000Z', 3),
      status: 'completed' as const,
      completedAt: '2026-08-03T08:00:00.000Z',
    }

    const result = createLibraryViewModel([article], [completed])
    expect(result.continueReading).toBeNull()
    expect(result.articles[0]).toMatchObject({
      levelLabel: '未评估',
      progress: 100,
      status: '已完成',
    })
  })
})

function createArticle(id: string, title: string): ArticleRecord {
  return {
    id,
    schemaVersion: 2,
    contentHash: `hash-${id}`,
    title,
    description: `Summary for ${title}.`,
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
    sentences: [0, 1, 2, 3].map(index => ({
      id: `${id}:s${index + 1}`,
      order: index,
      paragraphIndex: 0,
      textHash: `${id}-sentence-${index}`,
      original: `Sentence ${index + 1} belongs to this article.`,
      tokens: [],
    })),
    factSources: [],
    wordCount: 24,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
  }
}

function createAttempt(
  articleId: string,
  lastOpenedAt: string,
  sentenceIndex: number,
): ReadingAttempt {
  return {
    id: `attempt-${articleId}`,
    articleId,
    currentSentenceId: `${articleId}:s${sentenceIndex + 1}`,
    furthestSentenceOrdinal: sentenceIndex,
    activeDurationSec: 0,
    status: 'active',
    startedAt: lastOpenedAt,
    lastOpenedAt,
  }
}
