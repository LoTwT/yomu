import {
  YOMU_ENTITY_SCHEMA_VERSION,
  type ArticleRecord,
  type ReadingAttempt,
} from '@/data/entities'

export function createReviewArticle(
  id = 'article-review',
  title = 'A Quiet Reading',
  sourceLabel = 'Example Journal',
): ArticleRecord {
  return {
    id,
    schemaVersion: YOMU_ENTITY_SCHEMA_VERSION,
    contentHash: `${id}-content-hash`,
    title,
    language: 'en',
    level: 'unassessed',
    source: {
      kind: 'url',
      label: sourceLabel,
      url: `https://example.com/${id}`,
    },
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
    sentences: [{
      id: `${id}:s1`,
      order: 0,
      paragraphIndex: 0,
      textHash: `${id}-sentence-hash`,
      original: 'A short article is enough for this review fixture.',
      tokens: [],
    }],
    factSources: [],
    wordCount: 9,
    estimatedReadTimeMinutes: 1,
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
  }
}

export function createCompletedReviewAttempt(
  article: ArticleRecord,
  id = 'attempt-completed',
  activeDurationSec = 125,
  completedAt = '2026-08-10T08:05:00.000Z',
): ReadingAttempt {
  return {
    id,
    articleId: article.id,
    currentSentenceId: article.sentences[0]?.id,
    furthestSentenceOrdinal: 0,
    activeDurationSec,
    status: 'completed',
    startedAt: '2026-08-10T08:00:00.000Z',
    lastOpenedAt: completedAt,
    completedAt,
  }
}

export function createActiveReviewAttempt(
  article: ArticleRecord,
  id = 'attempt-active',
): ReadingAttempt {
  return {
    id,
    articleId: article.id,
    currentSentenceId: article.sentences[0]?.id,
    furthestSentenceOrdinal: 0,
    activeDurationSec: 25,
    status: 'active',
    startedAt: '2026-08-10T08:00:00.000Z',
    lastOpenedAt: '2026-08-10T08:02:00.000Z',
  }
}
