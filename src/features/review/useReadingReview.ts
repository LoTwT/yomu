import {
  onScopeDispose,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import { openOrCreateActiveAttempt } from '@/features/reader/attemptCommands'
import type { VocabularyListItem } from '@/features/vocabulary/types'
import {
  toVocabularyListItems,
  vocabularyItemsForArticle,
} from '@/features/vocabulary/useVocabularyLibrary'
import { listVocabulary } from '@/features/vocabulary/vocabularyQueries'

export type ReadingReviewStatus = 'loading' | 'ready' | 'missing' | 'incomplete' | 'error'
export type MissingReviewResource = 'attempt' | 'article'
export type ReadingRereadState = 'idle' | 'starting' | 'error'
export type ReviewVocabularyStatus = 'idle' | 'loading' | 'ready' | 'error'

export type CompletedReadingAttempt = ReadingAttempt & {
  status: 'completed'
  completedAt: string
}

export interface ReadingReviewRecord {
  article: ArticleRecord
  attempt: CompletedReadingAttempt
  vocabulary: readonly VocabularyListItem[]
}

export function useReadingReview(attemptId: MaybeRefOrGetter<string>) {
  const { lifecycle, repositories } = usePlatformServices()
  const status = shallowRef<ReadingReviewStatus>('loading')
  const review = shallowRef<ReadingReviewRecord | null>(null)
  const attempt = shallowRef<ReadingAttempt | null>(null)
  const missingResource = shallowRef<MissingReviewResource | null>(null)
  const errorMessage = shallowRef('')
  const rereadState = shallowRef<ReadingRereadState>('idle')
  const rereadErrorMessage = shallowRef('')
  const vocabularyStatus = shallowRef<ReviewVocabularyStatus>('idle')
  const vocabularyErrorMessage = shallowRef('')
  let loadVersion = 0
  let vocabularyLoadVersion = 0
  let currentVocabularyLoadVersion: number | null = null
  let lifecycleVocabularyRefreshPending = false
  let rereadOperation: {
    sourceAttemptId: string
    promise: Promise<ReadingAttempt | null>
  } | null = null

  watch(
    () => toValue(attemptId),
    () => void reload(),
    { immediate: true },
  )
  const unsubscribeLifecycle = lifecycle.subscribe((event) => {
    if (event.state === 'active') {
      void refreshVocabularyFromLifecycle()
    }
  })
  onScopeDispose(() => {
    loadVersion += 1
    vocabularyLoadVersion += 1
    currentVocabularyLoadVersion = null
    lifecycleVocabularyRefreshPending = false
    unsubscribeLifecycle()
  })

  async function reload(): Promise<void> {
    const version = ++loadVersion
    vocabularyLoadVersion += 1
    currentVocabularyLoadVersion = null
    lifecycleVocabularyRefreshPending = false
    const targetAttemptId = toValue(attemptId)
    status.value = 'loading'
    review.value = null
    attempt.value = null
    missingResource.value = null
    errorMessage.value = ''
    rereadState.value = 'idle'
    rereadErrorMessage.value = ''
    vocabularyStatus.value = 'idle'
    vocabularyErrorMessage.value = ''

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

      review.value = { article, attempt: loadedAttempt, vocabulary: [] }
      status.value = 'ready'
      await loadReviewVocabulary(version, targetAttemptId, article.id)
    }
    catch {
      if (!isCurrentLoad(version, targetAttemptId)) {
        return
      }
      status.value = 'error'
      errorMessage.value = '这次阅读回顾暂时无法读取。Yomu 没有修改本机记录，请稍后重试。'
    }
  }

  async function reloadVocabulary(): Promise<void> {
    await loadCurrentVocabulary(false)
  }

  async function refreshVocabularyFromLifecycle(): Promise<void> {
    if (currentVocabularyLoadVersion !== null) {
      lifecycleVocabularyRefreshPending = true
      return
    }
    if (vocabularyStatus.value !== 'ready') {
      return
    }
    await loadCurrentVocabulary(true)
  }

  async function loadCurrentVocabulary(silent: boolean): Promise<void> {
    const currentReview = review.value
    if (status.value !== 'ready' || !currentReview) {
      return
    }
    await loadReviewVocabulary(
      loadVersion,
      currentReview.attempt.id,
      currentReview.article.id,
      silent,
    )
  }

  async function loadReviewVocabulary(
    parentLoadVersion: number,
    targetAttemptId: string,
    articleId: string,
    silent = false,
  ): Promise<void> {
    const preserveReadySnapshot = silent && vocabularyStatus.value === 'ready'
    const version = ++vocabularyLoadVersion
    currentVocabularyLoadVersion = version
    if (!preserveReadySnapshot) {
      vocabularyStatus.value = 'loading'
    }
    vocabularyErrorMessage.value = ''
    try {
      const snapshot = await listVocabulary(repositories)
      if (!isCurrentVocabularyLoad(
        parentLoadVersion,
        version,
        targetAttemptId,
        articleId,
      )) {
        return
      }
      const currentReview = review.value!
      review.value = {
        ...currentReview,
        vocabulary: vocabularyItemsForArticle(
          toVocabularyListItems(snapshot),
          articleId,
        ),
      }
      vocabularyStatus.value = 'ready'
    }
    catch {
      if (!isCurrentVocabularyLoad(
        parentLoadVersion,
        version,
        targetAttemptId,
        articleId,
      )) {
        return
      }
      if (preserveReadySnapshot) {
        return
      }
      vocabularyStatus.value = 'error'
      vocabularyErrorMessage.value = '本文收藏词暂时无法读取。阅读回顾仍可使用，请稍后重试。'
    }
    finally {
      if (currentVocabularyLoadVersion === version) {
        currentVocabularyLoadVersion = null
      }
      if (version === vocabularyLoadVersion && lifecycleVocabularyRefreshPending) {
        lifecycleVocabularyRefreshPending = false
        if (status.value === 'ready' && vocabularyStatus.value === 'ready') {
          void loadCurrentVocabulary(true)
        }
      }
    }
  }

  function isCurrentVocabularyLoad(
    parentLoadVersion: number,
    version: number,
    targetAttemptId: string,
    articleId: string,
  ): boolean {
    return parentLoadVersion === loadVersion
      && version === vocabularyLoadVersion
      && targetAttemptId === toValue(attemptId)
      && review.value?.attempt.id === targetAttemptId
      && review.value.article.id === articleId
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
    vocabularyStatus: shallowReadonly(vocabularyStatus),
    vocabularyErrorMessage: shallowReadonly(vocabularyErrorMessage),
    reload,
    reloadVocabulary,
    startRereading,
  }
}

function isCompletedAttempt(attempt: ReadingAttempt): attempt is CompletedReadingAttempt {
  return attempt.status === 'completed' && typeof attempt.completedAt === 'string'
}
