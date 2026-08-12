import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { calculateReadingProgress } from '@/features/reader/readingProgress'

export type LibraryArticleStatus = '未开始' | '阅读中' | '已完成' | '重读中'

export interface LibraryArticleViewModel {
  id: string
  title: string
  summary?: string
  sourceLabel: string
  levelLabel: 'B1' | 'B2' | '未评估'
  estimatedMinutes: number
  progress: number
  lastOpenedLabel: string
  currentSentenceLabel?: string
  status: LibraryArticleStatus
}

export interface LibraryViewModel {
  articles: LibraryArticleViewModel[]
  continueReading: LibraryArticleViewModel | null
}

export function createLibraryViewModel(
  articles: readonly ArticleRecord[],
  attempts: readonly ReadingAttempt[],
  now = new Date(),
): LibraryViewModel {
  const attemptsByArticle = groupAttempts(attempts)
  const sortedArticles = [...articles].sort((left, right) =>
    resolveLastActivity(right, attemptsByArticle.get(right.id))
      .localeCompare(resolveLastActivity(left, attemptsByArticle.get(left.id))))
  const viewModels = sortedArticles.map(article => toArticleViewModel(
    article,
    attemptsByArticle.get(article.id) ?? [],
    now,
  ))
  const activeAttempts = attempts
    .filter(attempt => attempt.status === 'active')
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
  const continueReading = activeAttempts
    .map(attempt => viewModels.find(article => article.id === attempt.articleId) ?? null)
    .find((article): article is LibraryArticleViewModel => article !== null)
    ?? null

  return {
    articles: viewModels,
    continueReading,
  }
}

function toArticleViewModel(
  article: ArticleRecord,
  attempts: readonly ReadingAttempt[],
  now: Date,
): LibraryArticleViewModel {
  const activeAttempt = attempts.find(attempt => attempt.status === 'active')
  const completedAttempts = attempts.filter(attempt => attempt.status === 'completed')
  const latestAttempt = [...attempts]
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))[0]
  const currentAttempt = activeAttempt ?? latestAttempt
  const sortedSentences = [...article.sentences].sort((left, right) => left.order - right.order)
  const currentSentenceIndex = currentAttempt?.currentSentenceId
    ? sortedSentences.findIndex(sentence => sentence.id === currentAttempt.currentSentenceId)
    : -1
  const progress = currentAttempt
    ? calculateReadingProgress({
        status: currentAttempt.status,
        furthestSentenceOrdinal: currentAttempt.furthestSentenceOrdinal,
        sentenceCount: sortedSentences.length,
      })
    : 0

  return {
    id: article.id,
    title: article.title,
    summary: article.description,
    sourceLabel: article.source.label,
    levelLabel: article.level === 'unassessed' ? '未评估' : article.level,
    estimatedMinutes: article.estimatedReadTimeMinutes,
    progress,
    lastOpenedLabel: currentAttempt
      ? formatRelativeTime(currentAttempt.lastOpenedAt, now)
      : '尚未开始',
    currentSentenceLabel: currentSentenceIndex >= 0
      ? `第 ${currentSentenceIndex + 1} / ${sortedSentences.length} 句`
      : undefined,
    status: activeAttempt
      ? completedAttempts.length > 0 ? '重读中' : '阅读中'
      : completedAttempts.length > 0 ? '已完成' : '未开始',
  }
}

function groupAttempts(attempts: readonly ReadingAttempt[]): Map<string, ReadingAttempt[]> {
  const result = new Map<string, ReadingAttempt[]>()
  attempts.forEach((attempt) => {
    const values = result.get(attempt.articleId) ?? []
    values.push(attempt)
    result.set(attempt.articleId, values)
  })
  return result
}

function resolveLastActivity(
  article: ArticleRecord,
  attempts: readonly ReadingAttempt[] | undefined,
): string {
  if (!attempts?.length) {
    return article.createdAt
  }
  return attempts.reduce(
    (latest, attempt) => attempt.lastOpenedAt > latest ? attempt.lastOpenedAt : latest,
    attempts[0]!.lastOpenedAt,
  )
}

function formatRelativeTime(timestamp: string, now: Date): string {
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) {
    return '最近打开'
  }
  const deltaMs = Math.max(0, now.getTime() - value.getTime())
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  if (days === 1) {
    return '昨天'
  }
  if (days < 7) {
    return `${days} 天前`
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(value)
}
