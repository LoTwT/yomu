import {
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { openOrCreateActiveAttempt } from '@/features/reader/attemptCommands'

export type ReadingReviewStatus = 'loading' | 'ready' | 'missing' | 'incomplete' | 'error'
export type MissingReviewResource = 'attempt' | 'article'
export type ReadingRereadState = 'idle' | 'starting' | 'error'

export type CompletedReadingAttempt = ReadingAttempt & {
  status: 'completed'
  completedAt: string
}

export interface ReadingReviewRecord {
  article: ArticleRecord
  attempt: CompletedReadingAttempt
}

export function useReadingReview(attemptId: MaybeRefOrGetter<string>) {
  const { repositories } = usePlatformServices()
  const status = shallowRef<ReadingReviewStatus>('loading')
  const review = shallowRef<ReadingReviewRecord | null>(null)
  const attempt = shallowRef<ReadingAttempt | null>(null)
  const missingResource = shallowRef<MissingReviewResource | null>(null)
  const errorMessage = shallowRef('')
  const rereadState = shallowRef<ReadingRereadState>('idle')
  const rereadErrorMessage = shallowRef('')
  let loadVersion = 0
  let rereadOperation: {
    sourceAttemptId: string
    promise: Promise<ReadingAttempt | null>
  } | null = null

  watch(
    () => toValue(attemptId),
    () => void reload(),
    { immediate: true },
  )

  async function reload(): Promise<void> {
    const version = ++loadVersion
    const targetAttemptId = toValue(attemptId)
    status.value = 'loading'
    review.value = null
    attempt.value = null
    missingResource.value = null
    errorMessage.value = ''
    rereadState.value = 'idle'
    rereadErrorMessage.value = ''

    if (!targetAttemptId) {
      missingResource.value = 'attempt'
      status.value = 'missing'
      return
    }

    try {
      const loadedAttempt = await repositories.attempts.get(targetAttemptId)
      if (!isCurrentLoad(version, targetAttemptId)) {
        return
      }
      if (!loadedAttempt) {
        missingResource.value = 'attempt'
        status.value = 'missing'
        return
      }

      attempt.value = loadedAttempt
      if (!isCompletedAttempt(loadedAttempt)) {
        status.value = 'incomplete'
        return
      }

      const article = await repositories.articles.get(loadedAttempt.articleId)
      if (!isCurrentLoad(version, targetAttemptId)) {
        return
      }
      if (!article) {
        missingResource.value = 'article'
        status.value = 'missing'
        return
      }

      review.value = { article, attempt: loadedAttempt }
      status.value = 'ready'
    }
    catch {
      if (!isCurrentLoad(version, targetAttemptId)) {
        return
      }
      status.value = 'error'
      errorMessage.value = '这次阅读回顾暂时无法读取。Yomu 没有修改本机记录，请稍后重试。'
    }
  }

  function isCurrentLoad(version: number, targetAttemptId: string): boolean {
    return version === loadVersion && targetAttemptId === toValue(attemptId)
  }

  function startRereading(): Promise<ReadingAttempt | null> {
    const currentReview = review.value
    if (status.value !== 'ready' || !currentReview) {
      return Promise.resolve(null)
    }

    const sourceAttemptId = currentReview.attempt.id
    if (rereadOperation?.sourceAttemptId === sourceAttemptId) {
      return rereadOperation.promise
    }
    rereadState.value = 'starting'
    rereadErrorMessage.value = ''
    const operation = openOrCreateActiveAttempt(
      repositories,
      currentReview.article.id,
    ).then(({ attempt: rereadAttempt }) => {
      if (review.value?.attempt.id === sourceAttemptId) {
        rereadState.value = 'idle'
      }
      return rereadAttempt
    }).catch(() => {
      if (review.value?.attempt.id === sourceAttemptId) {
        rereadState.value = 'error'
        rereadErrorMessage.value = '暂时无法开始新的阅读，请稍后重试。原回顾仍保留。'
      }
      return null
    })
    const trackedOperation = { sourceAttemptId, promise: operation }
    rereadOperation = trackedOperation
    void operation.finally(() => {
      if (rereadOperation === trackedOperation) {
        rereadOperation = null
      }
    })
    return operation
  }

  return {
    status: shallowReadonly(status),
    review: shallowReadonly(review),
    attempt: shallowReadonly(attempt),
    missingResource: shallowReadonly(missingResource),
    errorMessage: shallowReadonly(errorMessage),
    rereadState: shallowReadonly(rereadState),
    rereadErrorMessage: shallowReadonly(rereadErrorMessage),
    reload,
    startRereading,
  }
}

function isCompletedAttempt(attempt: ReadingAttempt): attempt is CompletedReadingAttempt {
  return attempt.status === 'completed' && typeof attempt.completedAt === 'string'
}
