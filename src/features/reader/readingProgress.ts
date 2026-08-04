import type { ReadingAttempt } from '@/data/entities'

export interface ReadingProgressInput {
  status: ReadingAttempt['status']
  furthestSentenceOrdinal: number
  sentenceCount: number
}

export function calculateReadingProgress({
  status,
  furthestSentenceOrdinal,
  sentenceCount,
}: ReadingProgressInput): number {
  if (status === 'completed') {
    return 100
  }

  const normalizedSentenceCount = Math.floor(sentenceCount)
  const normalizedOrdinal = Math.floor(furthestSentenceOrdinal)
  if (!Number.isFinite(normalizedSentenceCount)
    || normalizedSentenceCount <= 0
    || !Number.isFinite(normalizedOrdinal)
    || normalizedOrdinal < 0) {
    return 0
  }

  const visitedSentenceCount = Math.min(
    normalizedSentenceCount,
    normalizedOrdinal + 1,
  )
  return Math.min(99, Math.round(
    (visitedSentenceCount / normalizedSentenceCount) * 100,
  ))
}
