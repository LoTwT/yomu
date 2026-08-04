import {
  computed,
  onUnmounted,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import type { ArticleRecord, ReadingAttempt } from '@/data/entities'
import type { SpeechPlaybackHandle } from '@/platform/contracts'
import {
  ArticleNotFoundError,
  flushReadingPosition,
  openOrCreateActiveAttempt,
} from './attemptCommands'
import { calculateReadingProgress } from './readingProgress'
import {
  clearReadingProgressJournal,
  readReadingProgressJournal,
  removeReadingProgressJournal,
  writeReadingProgressJournal,
  type ReadingProgressJournal,
} from './progressJournal'

export type ReadingSessionStatus = 'loading' | 'ready' | 'missing' | 'error'

export function useReadingSession(articleId: MaybeRefOrGetter<string>) {
  const services = usePlatformServices()
  const status = shallowRef<ReadingSessionStatus>('loading')
  const article = shallowRef<ArticleRecord | null>(null)
  const attempt = shallowRef<ReadingAttempt | null>(null)
  const currentSentenceId = shallowRef('')
  const isPlaying = shallowRef(false)
  const errorMessage = shallowRef('')
  const orderedSentences = computed(() =>
    [...(article.value?.sentences ?? [])].sort((left, right) => left.order - right.order))
  const currentSentenceIndex = computed(() => Math.max(
    0,
    orderedSentences.value.findIndex(sentence => sentence.id === currentSentenceId.value),
  ))
  const progress = computed(() => calculateReadingProgress({
    status: attempt.value?.status ?? 'active',
    furthestSentenceOrdinal: Math.max(
      attempt.value?.furthestSentenceOrdinal ?? 0,
      currentSentenceIndex.value,
    ),
    sentenceCount: orderedSentences.value.length,
  }))
  const speechAvailable = services.speech.isAvailable()

  let loadVersion = 0
  let playbackVersion = 0
  let playbackHandle: SpeechPlaybackHandle | null = null
  let activeSinceMs: number | null = null
  let activeDurationMs = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushQueue: Promise<void> = Promise.resolve()

  const unsubscribeLifecycle = services.lifecycle.subscribe((event) => {
    if (event.state === 'active') {
      startTiming()
      return
    }
    void suspend()
  })

  watch(
    () => toValue(articleId),
    () => load(),
    { immediate: true },
  )

  onUnmounted(() => {
    loadVersion += 1
    unsubscribeLifecycle()
    cancelScheduledFlush()
    stopSpeech()
    void suspend()
  })

  async function load(): Promise<void> {
    const version = ++loadVersion
    await suspend()
    status.value = 'loading'
    article.value = null
    attempt.value = null
    currentSentenceId.value = ''
    activeDurationMs = 0
    activeSinceMs = null
    errorMessage.value = ''

    try {
      const result = await openOrCreateActiveAttempt(
        services.repositories,
        toValue(articleId),
      )
      if (version !== loadVersion) {
        return
      }
      const recoveredAttempt = await replayProgressJournal(
        result.article,
        result.attempt,
      )
      if (version !== loadVersion) {
        return
      }
      article.value = result.article
      attempt.value = recoveredAttempt
      currentSentenceId.value = recoveredAttempt.currentSentenceId
        ?? result.article.sentences[0]?.id
        ?? ''
      activeDurationMs = recoveredAttempt.activeDurationSec * 1_000
      status.value = 'ready'
      startTiming()
    }
    catch (error) {
      if (version !== loadVersion) {
        return
      }
      if (error instanceof ArticleNotFoundError) {
        status.value = 'missing'
        return
      }
      status.value = 'error'
      errorMessage.value = '这篇文章暂时无法打开。阅读库内容没有被修改，请返回后重试。'
    }
  }

  function selectSentence(sentenceId: string): void {
    if (!orderedSentences.value.some(sentence => sentence.id === sentenceId)) {
      return
    }
    currentSentenceId.value = sentenceId
    checkpointActiveDuration()
    void persistCurrentProgress().catch(reportJournalFailure)
    scheduleFlush()
  }

  function previousSentence(): void {
    stopSpeech()
    const previous = orderedSentences.value[currentSentenceIndex.value - 1]
    if (previous) {
      selectSentence(previous.id)
    }
  }

  function nextSentence(): void {
    stopSpeech()
    const next = orderedSentences.value[currentSentenceIndex.value + 1]
    if (next) {
      selectSentence(next.id)
    }
  }

  async function togglePlayback(): Promise<void> {
    if (isPlaying.value) {
      stopSpeech()
      return
    }
    if (!speechAvailable) {
      errorMessage.value = '此设备当前没有可用的本机朗读能力，纯阅读仍可继续。'
      return
    }
    const sentence = orderedSentences.value[currentSentenceIndex.value]
    if (!sentence) {
      return
    }

    const version = ++playbackVersion
    errorMessage.value = ''
    try {
      const handle = await services.speech.speak({
        text: sentence.original,
        language: 'en-US',
        rate: 1,
        onStart: () => {
          if (version === playbackVersion) {
            isPlaying.value = true
          }
        },
        onEnd: () => finishPlayback(version),
        onError: () => {
          finishPlayback(version)
          errorMessage.value = '朗读没有成功启动，纯阅读和进度保存不受影响。'
        },
      })
      if (version !== playbackVersion) {
        handle.cancel()
        return
      }
      playbackHandle = handle
      isPlaying.value = true
    }
    catch {
      finishPlayback(version)
      errorMessage.value = '朗读没有成功启动，纯阅读和进度保存不受影响。'
    }
  }

  async function suspend(): Promise<void> {
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    await persistCurrentProgress().catch(reportJournalFailure)
    await flush()
  }

  function startTiming(): void {
    if (status.value !== 'ready'
      || services.lifecycle.currentState() !== 'active'
      || activeSinceMs !== null) {
      return
    }
    activeSinceMs = Date.now()
  }

  function checkpointActiveDuration(continueTiming = true): void {
    if (activeSinceMs === null) {
      return
    }
    const now = Date.now()
    activeDurationMs += Math.max(0, now - activeSinceMs)
    activeSinceMs = continueTiming
      && status.value === 'ready'
      && services.lifecycle.currentState() === 'active'
      ? now
      : null
  }

  function scheduleFlush(): void {
    cancelScheduledFlush()
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, 450)
  }

  function cancelScheduledFlush(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  async function flush(): Promise<void> {
    const operation = flushQueue.then(flushLatestProgress)
    flushQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
  }

  async function flushLatestProgress(): Promise<void> {
    checkpointActiveDuration()
    const currentAttempt = attempt.value
    const currentArticle = article.value
    const sentenceId = currentSentenceId.value
    if (!currentAttempt || !currentArticle || !sentenceId) {
      return
    }

    let journal: ReadingProgressJournal | null = null
    try {
      journal = await persistCurrentProgress()
    }
    catch {
      reportJournalFailure()
    }

    try {
      const updated = await flushReadingPosition(services.repositories, {
        articleId: currentArticle.id,
        attemptId: currentAttempt.id,
        currentSentenceId: sentenceId,
        activeDurationSec: Math.floor(activeDurationMs / 1_000),
      })
      activeDurationMs = Math.max(activeDurationMs, updated.activeDurationSec * 1_000)
      if (attempt.value?.id === updated.id) {
        attempt.value = updated
      }
      if (journal) {
        await clearReadingProgressJournal(services.preferences, journal).catch(() => {})
      }
    }
    catch {
      errorMessage.value = '阅读位置尚未保存，请保持页面打开并稍后重试。'
    }
  }

  async function replayProgressJournal(
    currentArticle: ArticleRecord,
    openedAttempt: ReadingAttempt,
  ): Promise<ReadingAttempt> {
    let journal: ReadingProgressJournal | null
    try {
      journal = await readReadingProgressJournal(
        services.preferences,
        currentArticle.id,
      )
    }
    catch {
      return openedAttempt
    }
    if (!journal) {
      return openedAttempt
    }

    const sentenceIndex = [...currentArticle.sentences]
      .sort((left, right) => left.order - right.order)
      .findIndex(sentence => sentence.id === journal.currentSentenceId)
    if (journal.attemptId !== openedAttempt.id || sentenceIndex < 0) {
      await removeReadingProgressJournal(
        services.preferences,
        currentArticle.id,
      ).catch(() => {})
      return openedAttempt
    }

    try {
      const recovered = await flushReadingPosition(services.repositories, {
        articleId: currentArticle.id,
        attemptId: openedAttempt.id,
        currentSentenceId: journal.currentSentenceId,
        activeDurationSec: journal.activeDurationSec,
      })
      await clearReadingProgressJournal(services.preferences, journal).catch(() => {})
      return recovered
    }
    catch {
      errorMessage.value = '已从刷新保护记录恢复阅读位置，持久存储将在稍后重试。'
      return {
        ...openedAttempt,
        currentSentenceId: journal.currentSentenceId,
        furthestSentenceOrdinal: Math.max(
          openedAttempt.furthestSentenceOrdinal,
          sentenceIndex,
        ),
        activeDurationSec: Math.max(
          openedAttempt.activeDurationSec,
          journal.activeDurationSec,
        ),
      }
    }
  }

  function persistCurrentProgress(): Promise<ReadingProgressJournal | null> {
    const currentArticle = article.value
    const currentAttempt = attempt.value
    const sentenceId = currentSentenceId.value
    if (!currentArticle || !currentAttempt || !sentenceId) {
      return Promise.resolve(null)
    }
    return writeReadingProgressJournal(services.preferences, {
      articleId: currentArticle.id,
      attemptId: currentAttempt.id,
      currentSentenceId: sentenceId,
      activeDurationSec: Math.floor(activeDurationMs / 1_000),
    })
  }

  function reportJournalFailure(): void {
    errorMessage.value = '刷新保护记录暂时不可用；Yomu 会继续尝试保存阅读位置。'
  }

  function stopSpeech(): void {
    playbackVersion += 1
    playbackHandle?.cancel()
    playbackHandle = null
    services.speech.stop()
    isPlaying.value = false
  }

  function finishPlayback(version: number): void {
    if (version !== playbackVersion) {
      return
    }
    playbackHandle = null
    isPlaying.value = false
  }

  return {
    status: shallowReadonly(status),
    article: shallowReadonly(article),
    attempt: shallowReadonly(attempt),
    orderedSentences,
    currentSentenceId: shallowReadonly(currentSentenceId),
    currentSentenceIndex,
    progress,
    isPlaying: shallowReadonly(isPlaying),
    errorMessage: shallowReadonly(errorMessage),
    speechAvailable,
    load,
    selectSentence,
    previousSentence,
    nextSentence,
    togglePlayback,
    suspend,
  }
}
