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
import type { ArticleRecord, ArticleSentenceRecord, ReadingAttempt } from '@/data/entities'
import type { AppLifecycleState, SpeechPlaybackHandle } from '@/platform/contracts'
import {
  ArticleNotFoundError,
  flushReadingPosition,
  openOrCreateActiveAttempt,
} from './attemptCommands'
import { calculateReadingProgress } from './readingProgress'
import {
  adoptReadingProgressJournal,
  clearReadingProgressJournal,
  clearSelectedReadingProgressJournal,
  compactReadingProgressJournalSlots,
  createReadingProgressJournal,
  createReadingProgressJournalWriterId,
  readReadingProgressJournal,
  readingProgressJournalOperationId,
  storeReadingProgressJournal,
  storeReadingProgressJournalImmediately,
  type CurrentReadingProgressJournal,
  type ReadingProgressJournal,
  type ReadingProgressJournalDraft,
  type ReadingProgressSnapshot,
} from './progressJournal'

export type ReadingSessionStatus = 'loading' | 'ready' | 'missing' | 'error'

type ReadingPlaybackState =
  | { phase: 'idle', sentenceId: null }
  | { phase: 'starting' | 'playing', sentenceId: string }

const idlePlaybackState: ReadingPlaybackState = {
  phase: 'idle',
  sentenceId: null,
}

const routeTransitionSaveDeadlineMs = 750
const progressJournalCompactionDeadlineMs = 250
const terminalSpeechStartSignals = new WeakSet<AbortSignal>()

interface ReadingJournalWriteOutcome {
  snapshot: ReadingProgressSnapshot
  intendedJournal: ReadingProgressJournalDraft
  journal: CurrentReadingProgressJournal | null
}

interface ReadingJournalDeferred {
  promise: Promise<ReadingJournalWriteOutcome>
  resolve: (outcome: ReadingJournalWriteOutcome) => void
}

interface PendingReadingJournalWrite {
  snapshot: ReadingProgressSnapshot
  deferred: ReadingJournalDeferred
}

interface VoidDeferred {
  promise: Promise<void>
  resolve: () => void
  reject: (reason?: unknown) => void
}

interface PendingFlush {
  deferred: VoidDeferred
}

interface PendingSpeechStart {
  version: number
  sentence: ArticleSentenceRecord
  deferred: VoidDeferred
}

interface PendingSuspension {
  journalOperation: Promise<unknown>
  deferred: VoidDeferred
}

export interface ReadingRouteTransition {
  token: number
  ready: Promise<void>
}

interface ReplayedProgress {
  attempt: ReadingAttempt
  warning: string
  cursorPending: boolean
}

export function useReadingSession(articleId: MaybeRefOrGetter<string>) {
  const services = usePlatformServices()
  const journalWriterId = createReadingProgressJournalWriterId()
  const status = shallowRef<ReadingSessionStatus>('loading')
  const article = shallowRef<ArticleRecord | null>(null)
  const attempt = shallowRef<ReadingAttempt | null>(null)
  const currentSentenceId = shallowRef('')
  const furthestSentenceOrdinal = shallowRef(0)
  const playbackState = shallowRef<ReadingPlaybackState>(idlePlaybackState)
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
      furthestSentenceOrdinal.value,
      currentSentenceIndex.value,
    ),
    sentenceCount: orderedSentences.value.length,
  }))
  const playingSentenceId = computed(() => playbackState.value.sentenceId)
  const isPlaying = computed(() => playbackState.value.phase !== 'idle')
  const speechAvailable = services.speech.isAvailable()

  let loadVersion = 0
  let playbackVersion = 0
  let lifecycleState: AppLifecycleState = services.lifecycle.currentState()
  let playbackHandle: SpeechPlaybackHandle | null = null
  let playbackStartAbortController: AbortController | null = null
  let activeSinceMs: number | null = null
  let activeDurationMs = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingFlush: PendingFlush | null = null
  let flushWorker: Promise<void> | null = null
  let pendingSpeechStart: PendingSpeechStart | null = null
  let speechStartWorker: Promise<void> | null = null
  let pendingSuspension: PendingSuspension | null = null
  let suspensionWorker: Promise<void> | null = null
  let pendingJournalWrite: PendingReadingJournalWrite | null = null
  let journalWriter: Promise<void> | null = null
  let journalStorageQueue: Promise<void> = Promise.resolve()
  const compactingJournalArticles = new Set<string>()
  const pendingJournalCompactions = new Set<string>()
  let journalWriteSequence = 0
  let cursorDirty = false
  let routeTransitionVersion = 0
  let routeTransitionSuspended = false
  let disposed = false

  const unsubscribeLifecycle = services.lifecycle.subscribe((event) => {
    lifecycleState = event.state
    if (event.state === 'active') {
      startTiming()
      return
    }
    if (event.reason === 'pagehide'
      || event.reason === 'system'
      || event.reason === 'window-close') {
      suspendForTerminalLifecycleEvent()
      return
    }
    void suspend().catch(() => {})
  })

  watch(
    () => toValue(articleId),
    () => void load(),
    { immediate: true },
  )

  onUnmounted(() => {
    disposed = true
    loadVersion += 1
    unsubscribeLifecycle()
    cancelScheduledFlush()
    void suspend().catch(() => {})
  })

  async function load(): Promise<void> {
    const version = ++loadVersion
    const targetArticleId = toValue(articleId)
    status.value = 'loading'
    await suspend()
    if (!isCurrentLoad(version, targetArticleId)) {
      return
    }
    article.value = null
    attempt.value = null
    currentSentenceId.value = ''
    furthestSentenceOrdinal.value = 0
    activeDurationMs = 0
    activeSinceMs = null
    cursorDirty = false
    errorMessage.value = ''

    try {
      const result = await openOrCreateActiveAttempt(
        services.repositories,
        targetArticleId,
      )
      if (!isCurrentLoad(version, targetArticleId)) {
        return
      }
      const recovered = await replayProgressJournal(
        result.article,
        result.attempt,
      )
      if (!isCurrentLoad(version, targetArticleId)) {
        return
      }
      article.value = result.article
      attempt.value = recovered.attempt
      currentSentenceId.value = recovered.attempt.currentSentenceId
        ?? result.article.sentences[0]?.id
        ?? ''
      furthestSentenceOrdinal.value = recovered.attempt.furthestSentenceOrdinal
      activeDurationMs = recovered.attempt.activeDurationSec * 1_000
      cursorDirty = recovered.cursorPending
      errorMessage.value = recovered.warning
      routeTransitionSuspended = false
      status.value = 'ready'
      startTiming()
    }
    catch (error) {
      if (!isCurrentLoad(version, targetArticleId)) {
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
    if (status.value !== 'ready'
      || routeTransitionSuspended
      || !orderedSentences.value.some(sentence => sentence.id === sentenceId)) {
      return
    }
    const shouldContinuePlayback = isPlaying.value
    if (sentenceId === currentSentenceId.value
      && (!shouldContinuePlayback || playingSentenceId.value === sentenceId)) {
      return
    }
    if (shouldContinuePlayback) {
      stopSpeech()
    }
    updateCurrentSentence(sentenceId)
    if (shouldContinuePlayback) {
      void startPlayback(sentenceId)
    }
  }

  function previousSentence(): void {
    const previous = orderedSentences.value[currentSentenceIndex.value - 1]
    if (previous) {
      selectSentence(previous.id)
    }
  }

  function nextSentence(): void {
    const next = orderedSentences.value[currentSentenceIndex.value + 1]
    if (next) {
      selectSentence(next.id)
    }
  }

  function togglePlayback(): Promise<void> {
    if (isPlaying.value) {
      stopSpeech()
      return Promise.resolve()
    }
    return startPlayback(currentSentenceId.value)
  }

  function startPlayback(sentenceId: string): Promise<void> {
    if (!speechAvailable) {
      errorMessage.value = '此设备当前没有可用的本机朗读能力，纯阅读仍可继续。'
      return Promise.resolve()
    }
    if (disposed
      || status.value !== 'ready'
      || routeTransitionSuspended
      || lifecycleState !== 'active') {
      return Promise.resolve()
    }
    const sentence = orderedSentences.value.find(value => value.id === sentenceId)
    if (!sentence || !article.value) {
      return Promise.resolve()
    }

    if (isPlaying.value || playbackHandle) {
      stopSpeech()
    }

    const version = ++playbackVersion
    playbackState.value = { phase: 'starting', sentenceId: sentence.id }
    errorMessage.value = ''
    return queueSpeechStart(version, sentence)
  }

  function queueSpeechStart(
    version: number,
    sentence: ArticleSentenceRecord,
  ): Promise<void> {
    if (pendingSpeechStart) {
      pendingSpeechStart.version = version
      pendingSpeechStart.sentence = sentence
      return pendingSpeechStart.deferred.promise
    }

    let resolveSpeechStart!: () => void
    let rejectSpeechStart!: (reason?: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveSpeechStart = resolve
      rejectSpeechStart = reject
    })
    pendingSpeechStart = {
      version,
      sentence,
      deferred: {
        promise,
        resolve: resolveSpeechStart,
        reject: rejectSpeechStart,
      },
    }
    ensureSpeechStartWorker()
    return promise
  }

  function ensureSpeechStartWorker(): void {
    if (!speechStartWorker) {
      speechStartWorker = drainSpeechStarts()
    }
  }

  async function drainSpeechStarts(): Promise<void> {
    try {
      while (pendingSpeechStart) {
        const pending = pendingSpeechStart
        pendingSpeechStart = null
        try {
          await speakSentence(pending.version, pending.sentence)
          pending.deferred.resolve()
        }
        catch (error) {
          pending.deferred.reject(error)
        }
      }
    }
    finally {
      speechStartWorker = null
      if (pendingSpeechStart) {
        ensureSpeechStartWorker()
      }
    }
  }

  async function speakSentence(
    version: number,
    sentence: ArticleSentenceRecord,
  ): Promise<void> {
    if (!isCurrentPlayback(version, sentence.id)) {
      return
    }
    const abortController = new AbortController()
    playbackStartAbortController = abortController
    try {
      const speakPromise = services.speech.speak({
        text: sentence.original,
        language: 'en-US',
        rate: 1,
        signal: abortController.signal,
        onStart: () => {
          if (isCurrentPlayback(version, sentence.id)) {
            playbackState.value = { phase: 'playing', sentenceId: sentence.id }
          }
        },
        onEnd: () => handlePlaybackEnd(version, sentence.id),
        onError: () => {
          failPlayback(version, sentence.id)
        },
      })
      const handle = await raceSpeechStartWithAbort(
        speakPromise,
        abortController.signal,
      )
      if (!handle) {
        return
      }
      if (!isCurrentPlayback(version, sentence.id)) {
        handle.cancel()
        return
      }
      playbackHandle = handle
      playbackState.value = { phase: 'playing', sentenceId: sentence.id }
    }
    catch {
      failPlayback(version, sentence.id)
    }
    finally {
      if (playbackStartAbortController === abortController) {
        playbackStartAbortController = null
      }
    }
  }

  function suspend(): Promise<void> {
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    const journalOperation = persistCurrentProgress()
    return queueSuspension(journalOperation)
  }

  function suspendForTerminalLifecycleEvent(): void {
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    persistCurrentProgressImmediately()
    void queueSuspension(Promise.resolve()).catch(() => {})
  }

  function beginRouteTransition(): ReadingRouteTransition {
    const token = ++routeTransitionVersion
    routeTransitionSuspended = true
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    persistCurrentProgressImmediately()
    const backgroundSave = queueSuspension(Promise.resolve())
    return {
      token,
      ready: settleWithin(backgroundSave, routeTransitionSaveDeadlineMs),
    }
  }

  function resumeAfterFailedRouteTransition(token: number): void {
    if (disposed || token !== routeTransitionVersion) {
      return
    }
    routeTransitionSuspended = false
    startTiming()
  }

  function queueSuspension(journalOperation: Promise<unknown>): Promise<void> {
    if (pendingSuspension) {
      pendingSuspension.journalOperation = journalOperation
      return pendingSuspension.deferred.promise
    }

    let resolveSuspension!: () => void
    let rejectSuspension!: (reason?: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveSuspension = resolve
      rejectSuspension = reject
    })
    pendingSuspension = {
      journalOperation,
      deferred: {
        promise,
        resolve: resolveSuspension,
        reject: rejectSuspension,
      },
    }
    ensureSuspensionWorker()
    return promise
  }

  function ensureSuspensionWorker(): void {
    if (!suspensionWorker) {
      suspensionWorker = drainSuspensions()
    }
  }

  async function drainSuspensions(): Promise<void> {
    try {
      while (pendingSuspension) {
        const pending = pendingSuspension
        pendingSuspension = null
        try {
          await pending.journalOperation
          await flush()
          pending.deferred.resolve()
        }
        catch (error) {
          pending.deferred.reject(error)
        }
      }
    }
    finally {
      suspensionWorker = null
      if (pendingSuspension) {
        ensureSuspensionWorker()
      }
    }
  }

  function startTiming(): void {
    if (status.value !== 'ready'
      || routeTransitionSuspended
      || lifecycleState !== 'active'
      || activeSinceMs !== null) {
      return
    }
    activeSinceMs = Date.now()
  }

  function isCurrentLoad(version: number, targetArticleId: string): boolean {
    return version === loadVersion
      && !disposed
      && targetArticleId === toValue(articleId)
  }

  function checkpointActiveDuration(continueTiming = true): void {
    if (activeSinceMs === null) {
      return
    }
    const now = Date.now()
    activeDurationMs += Math.max(0, now - activeSinceMs)
    activeSinceMs = continueTiming
      && status.value === 'ready'
      && lifecycleState === 'active'
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

  function flush(): Promise<void> {
    if (pendingFlush) {
      return pendingFlush.deferred.promise
    }

    let resolveFlush!: () => void
    let rejectFlush!: (reason?: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveFlush = resolve
      rejectFlush = reject
    })
    pendingFlush = {
      deferred: {
        promise,
        resolve: resolveFlush,
        reject: rejectFlush,
      },
    }
    ensureFlushWorker()
    return promise
  }

  function ensureFlushWorker(): void {
    if (!flushWorker) {
      flushWorker = drainFlushes()
    }
  }

  async function drainFlushes(): Promise<void> {
    try {
      while (pendingFlush) {
        const pending = pendingFlush
        pendingFlush = null
        try {
          await flushLatestProgress()
          pending.deferred.resolve()
        }
        catch (error) {
          pending.deferred.reject(error)
        }
      }
    }
    finally {
      flushWorker = null
      if (pendingFlush) {
        ensureFlushWorker()
      }
    }
  }

  async function flushLatestProgress(): Promise<void> {
    checkpointActiveDuration()
    const currentAttempt = attempt.value
    const currentArticle = article.value
    const sentenceId = currentSentenceId.value
    if (!currentAttempt || !currentArticle || !sentenceId) {
      return
    }

    const journalOutcome = await persistCurrentProgress()

    const snapshot = journalOutcome?.snapshot ?? {
      articleId: currentArticle.id,
      attemptId: currentAttempt.id,
      baseAttemptRevision: currentAttempt.progressRevision ?? 0,
      cursorMutation: cursorDirty,
      currentSentenceId: sentenceId,
      furthestSentenceOrdinal: Math.max(
        currentAttempt.furthestSentenceOrdinal,
        furthestSentenceOrdinal.value,
        currentSentenceIndex.value,
      ),
      activeDurationSec: Math.floor(activeDurationMs / 1_000),
    }
    const persistedProgress = journalOutcome?.journal
      ?? journalOutcome?.intendedJournal
    try {
      const result = await flushReadingPosition(services.repositories, {
        articleId: snapshot.articleId,
        attemptId: snapshot.attemptId,
        baseAttemptRevision: persistedProgress?.baseAttemptRevision
          ?? snapshot.baseAttemptRevision,
        cursorMutation: persistedProgress?.cursorMutation
          ?? snapshot.cursorMutation,
        currentSentenceId: persistedProgress?.currentSentenceId
          ?? snapshot.currentSentenceId,
        furthestSentenceOrdinal: persistedProgress?.furthestSentenceOrdinal
          ?? snapshot.furthestSentenceOrdinal,
        activeDurationSec: persistedProgress?.activeDurationSec
          ?? snapshot.activeDurationSec,
        journalOperationId: persistedProgress
          ? readingProgressJournalOperationId(persistedProgress)
          : undefined,
        journalEpochId: journalOutcome?.journal?.epochId,
        journalGeneration: journalOutcome?.journal?.generation,
      })
      if (isCurrentProgressSnapshot(snapshot)) {
        activeDurationMs = Math.max(
          activeDurationMs,
          result.attempt.activeDurationSec * 1_000,
        )
        attempt.value = result.attempt
        furthestSentenceOrdinal.value = Math.max(
          furthestSentenceOrdinal.value,
          result.attempt.furthestSentenceOrdinal,
        )
        if (result.cursorApplied
          && (persistedProgress?.cursorMutation ?? snapshot.cursorMutation)
          && (persistedProgress?.currentSentenceId ?? snapshot.currentSentenceId)
            === currentSentenceId.value) {
          cursorDirty = false
        }
      }
      if (journalOutcome && result.journalSettled) {
        await retireProgressJournal(journalOutcome)
      }
    }
    catch {
      if (isCurrentProgressSnapshot(snapshot)) {
        errorMessage.value = '阅读位置尚未保存，请保持页面打开并稍后重试。'
      }
    }
  }

  async function replayProgressJournal(
    currentArticle: ArticleRecord,
    openedAttempt: ReadingAttempt,
  ): Promise<ReplayedProgress> {
    let recoveryBase = openedAttempt
    while (true) {
      const journal = await readReadingProgressJournal(
        services.preferences,
        currentArticle.id,
        recoveryBase.id,
        recoveryBase.progressRevision ?? 0,
      )
      if (!journal) {
        return { attempt: recoveryBase, warning: '', cursorPending: false }
      }

      const sentenceIndex = [...currentArticle.sentences]
        .sort((left, right) => left.order - right.order)
        .findIndex(sentence => sentence.id === journal.currentSentenceId)
      if (journal.attemptId !== recoveryBase.id || sentenceIndex < 0) {
        try {
          await retireSelectedProgressJournal(journal)
        }
        catch {
          return { attempt: recoveryBase, warning: '', cursorPending: false }
        }
        continue
      }
      if (isJournalCoveredByAttempt(journal, recoveryBase)) {
        try {
          await retireSelectedProgressJournal(journal)
        }
        catch {
          return { attempt: recoveryBase, warning: '', cursorPending: false }
        }
        continue
      }

      try {
        const result = await flushReadingPosition(services.repositories, {
          articleId: currentArticle.id,
          attemptId: recoveryBase.id,
          baseAttemptRevision: journal.schemaVersion === 2
            ? journal.baseAttemptRevision
            : recoveryBase.progressRevision ?? 0,
          cursorMutation: journal.schemaVersion === 1 || journal.cursorMutation,
          currentSentenceId: journal.currentSentenceId,
          furthestSentenceOrdinal: journal.schemaVersion === 2
            ? Math.max(journal.furthestSentenceOrdinal, sentenceIndex)
            : sentenceIndex,
          activeDurationSec: journal.activeDurationSec,
          journalOperationId: readingProgressJournalOperationId(journal),
          journalEpochId: journal.schemaVersion === 2 ? journal.epochId : undefined,
          journalGeneration: journal.schemaVersion === 2 ? journal.generation : undefined,
        })
        recoveryBase = result.attempt
        if (!result.journalSettled) {
          return {
            attempt: recoveryBase,
            warning: '',
            cursorPending: false,
          }
        }
        try {
          await retireSelectedProgressJournal(journal)
        }
        catch {
          return { attempt: recoveryBase, warning: '', cursorPending: false }
        }
      }
      catch {
        let recoverableJournal = journal
        if (journal.schemaVersion === 2) {
          const currentRevision = recoveryBase.progressRevision ?? 0
          const sameRevision = journal.baseAttemptRevision === currentRevision
          const newerInCommittedEpoch = journal.epochId
            === recoveryBase.progressJournalEpochId
            && journal.generation
              > (recoveryBase.progressJournalGeneration ?? -1)
          const revisionIsFuture = journal.baseAttemptRevision > currentRevision
          const cursorIsStale = journal.cursorMutation
            && journal.baseAttemptRevision < currentRevision
          if ((revisionIsFuture || cursorIsStale) && !newerInCommittedEpoch) {
            throw new Error('Reading progress journal could not be verified against durable state.')
          }
          if (!sameRevision) {
            recoverableJournal = {
              ...journal,
              baseAttemptRevision: currentRevision,
              ...(!journal.cursorMutation
                ? {
                    currentSentenceId: recoveryBase.currentSentenceId
                      ?? journal.currentSentenceId,
                  }
                : {}),
            }
          }
        }
        const cursorMutation = recoverableJournal.schemaVersion === 1
          || recoverableJournal.cursorMutation
        if (recoverableJournal.schemaVersion === 2) {
          try {
            const adopted = await runJournalStorageOperation(() =>
              adoptReadingProgressJournal(services.preferences, recoverableJournal, {
                writerId: journalWriterId,
                sequence: journalWriteSequence + 1,
              }))
            journalWriteSequence = Math.max(
              journalWriteSequence,
              adopted.journal.sequence,
            )
            if (adopted.sourcesSettled) {
              scheduleProgressJournalCompaction(currentArticle.id)
            }
          }
          catch {}
        }
        return {
          attempt: {
            ...recoveryBase,
            currentSentenceId: cursorMutation
              ? recoverableJournal.currentSentenceId
              : recoveryBase.currentSentenceId,
            furthestSentenceOrdinal: Math.max(
              recoveryBase.furthestSentenceOrdinal,
              sentenceIndex,
              recoverableJournal.schemaVersion === 2
                ? recoverableJournal.furthestSentenceOrdinal
                : 0,
            ),
            activeDurationSec: Math.max(
              recoveryBase.activeDurationSec,
              recoverableJournal.activeDurationSec,
            ),
          },
          warning: '已从刷新保护记录恢复阅读位置，持久存储将在稍后重试。',
          cursorPending: cursorMutation,
        }
      }
    }
  }

  function persistCurrentProgress(): Promise<ReadingJournalWriteOutcome | null> {
    const snapshot = createCurrentProgressSnapshot()
    return snapshot
      ? queueReadingProgressJournal(snapshot)
      : Promise.resolve(null)
  }

  function persistCurrentProgressImmediately(): void {
    const snapshot = createCurrentProgressSnapshot()
    if (!snapshot) {
      return
    }
    const sequence = ++journalWriteSequence
    const journal = createReadingProgressJournal(
      snapshot,
      { writerId: journalWriterId, sequence },
    )
    try {
      const stored = storeReadingProgressJournalImmediately(
        services.preferences,
        journal,
      )
      scheduleProgressJournalCompaction(stored.articleId)
    }
    catch {
      reportJournalFailure(snapshot)
    }
  }

  function createCurrentProgressSnapshot(): ReadingProgressSnapshot | null {
    const currentArticle = article.value
    const currentAttempt = attempt.value
    const sentenceId = currentSentenceId.value
    if (!currentArticle || !currentAttempt || !sentenceId) {
      return null
    }
    return {
      articleId: currentArticle.id,
      attemptId: currentAttempt.id,
      baseAttemptRevision: currentAttempt.progressRevision ?? 0,
      cursorMutation: cursorDirty,
      currentSentenceId: sentenceId,
      furthestSentenceOrdinal: Math.max(
        currentAttempt.furthestSentenceOrdinal,
        furthestSentenceOrdinal.value,
        currentSentenceIndex.value,
      ),
      activeDurationSec: Math.floor(activeDurationMs / 1_000),
    }
  }

  function queueReadingProgressJournal(
    snapshot: ReadingProgressSnapshot,
  ): Promise<ReadingJournalWriteOutcome> {
    if (pendingJournalWrite) {
      pendingJournalWrite.snapshot = snapshot
      return pendingJournalWrite.deferred.promise
    }

    let resolveJournal!: (outcome: ReadingJournalWriteOutcome) => void
    const promise = new Promise<ReadingJournalWriteOutcome>((resolve) => {
      resolveJournal = resolve
    })
    pendingJournalWrite = {
      snapshot,
      deferred: {
        promise,
        resolve: resolveJournal,
      },
    }
    ensureJournalWriter()
    return promise
  }

  function ensureJournalWriter(): void {
    if (!journalWriter) {
      journalWriter = drainJournalWrites()
    }
  }

  async function drainJournalWrites(): Promise<void> {
    try {
      while (pendingJournalWrite) {
        const pending = pendingJournalWrite
        pendingJournalWrite = null
        const sequence = ++journalWriteSequence
        const intendedJournal = createReadingProgressJournal(
          pending.snapshot,
          { writerId: journalWriterId, sequence },
        )
        try {
          const journal = await runJournalStorageOperation(async () => {
            return storeReadingProgressJournal(
              services.preferences,
              intendedJournal,
            )
          })
          scheduleProgressJournalCompaction(journal.articleId)
          pending.deferred.resolve({
            snapshot: pending.snapshot,
            intendedJournal,
            journal,
          })
        }
        catch {
          reportJournalFailure(pending.snapshot)
          pending.deferred.resolve({
            snapshot: pending.snapshot,
            intendedJournal,
            journal: null,
          })
        }
      }
    }
    finally {
      journalWriter = null
      if (pendingJournalWrite) {
        ensureJournalWriter()
      }
    }
  }

  async function retireProgressJournal(
    outcome: ReadingJournalWriteOutcome,
  ): Promise<void> {
    if (!outcome.journal) {
      return
    }
    const retired = await runJournalStorageOperation(() =>
      clearReadingProgressJournal(services.preferences, outcome.journal!))
      .then(() => true, () => false)
    if (retired) {
      scheduleProgressJournalCompaction(outcome.journal.articleId)
    }
  }

  function retireSelectedProgressJournal(
    journal: ReadingProgressJournal,
  ): Promise<void> {
    return runJournalStorageOperation(() =>
      clearSelectedReadingProgressJournal(services.preferences, journal)
    ).then(() => {
      scheduleProgressJournalCompaction(journal.articleId)
    })
  }

  function scheduleProgressJournalCompaction(articleId: string): void {
    if (compactingJournalArticles.has(articleId)) {
      pendingJournalCompactions.add(articleId)
      return
    }
    compactingJournalArticles.add(articleId)
    setTimeout(() => runProgressJournalCompaction(articleId), 0)
  }

  function runProgressJournalCompaction(articleId: string): void {
    const compaction = compactReadingProgressJournalSlots(
      services.preferences,
      articleId,
    )
    void compaction.then((removed) => {
      if (removed > 0) {
        scheduleProgressJournalCompaction(articleId)
      }
    }).catch(() => {})
    void settleWithin(compaction, progressJournalCompactionDeadlineMs)
      .finally(() => {
        compactingJournalArticles.delete(articleId)
        if (pendingJournalCompactions.delete(articleId)) {
          scheduleProgressJournalCompaction(articleId)
        }
      })
  }

  function runJournalStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = journalStorageQueue.then(operation)
    journalStorageQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function reportJournalFailure(snapshot: ReadingProgressSnapshot): void {
    if (isCurrentProgressSnapshot(snapshot)) {
      errorMessage.value = '刷新保护记录暂时不可用；Yomu 会继续尝试保存阅读位置。'
    }
  }

  function isCurrentProgressSnapshot(snapshot: ReadingProgressSnapshot): boolean {
    return !disposed
      && article.value?.id === snapshot.articleId
      && attempt.value?.id === snapshot.attemptId
  }

  function isJournalCoveredByAttempt(
    journal: ReadingProgressJournal,
    currentAttempt: ReadingAttempt,
  ): boolean {
    if (currentAttempt.furthestSentenceOrdinal < (journal.schemaVersion === 2
      ? journal.furthestSentenceOrdinal
      : 0)
      || currentAttempt.activeDurationSec < journal.activeDurationSec) {
      return false
    }
    const journalOperationId = readingProgressJournalOperationId(journal)
    if (currentAttempt.progressJournalId === journalOperationId) {
      return true
    }
    if (journal.schemaVersion !== 2) {
      return false
    }
    const sameWriterPrefix = `${journal.writerId}:`
    if (currentAttempt.progressJournalId?.startsWith(sameWriterPrefix)) {
      const savedSequence = Number(
        currentAttempt.progressJournalId.slice(sameWriterPrefix.length),
      )
      if (Number.isSafeInteger(savedSequence) && savedSequence >= journal.sequence) {
        return true
      }
    }
    return currentAttempt.progressJournalEpochId === journal.epochId
      && (currentAttempt.progressJournalGeneration ?? -1) >= journal.generation
  }

  function updateCurrentSentence(sentenceId: string): void {
    if (currentSentenceId.value === sentenceId) {
      return
    }
    currentSentenceId.value = sentenceId
    const selectedSentenceIndex = orderedSentences.value
      .findIndex(sentence => sentence.id === sentenceId)
    furthestSentenceOrdinal.value = Math.max(
      furthestSentenceOrdinal.value,
      selectedSentenceIndex,
    )
    cursorDirty = true
    checkpointActiveDuration()
    void persistCurrentProgress()
    scheduleFlush()
  }

  function stopSpeech(): void {
    playbackVersion += 1
    const startController = playbackStartAbortController
    playbackStartAbortController = null
    const handle = playbackHandle
    playbackHandle = null
    try {
      startController?.abort()
    }
    catch {}
    try {
      handle?.cancel()
    }
    catch {}
    try {
      services.speech.stop()
    }
    catch {}
    playbackState.value = idlePlaybackState
  }

  function handlePlaybackEnd(version: number, sentenceId: string): void {
    if (!isCurrentPlayback(version, sentenceId)) {
      return
    }
    finishPlayback(version, sentenceId)

    if (disposed
      || status.value !== 'ready'
      || lifecycleState !== 'active') {
      return
    }
    const sentenceIndex = orderedSentences.value.findIndex(sentence => sentence.id === sentenceId)
    const nextSentence = orderedSentences.value[sentenceIndex + 1]
    if (!nextSentence) {
      return
    }
    updateCurrentSentence(nextSentence.id)
    void startPlayback(nextSentence.id)
  }

  function failPlayback(version: number, sentenceId: string): void {
    if (!isCurrentPlayback(version, sentenceId)) {
      return
    }
    settleSpeechStartAsTerminal()
    playbackVersion += 1
    const handle = playbackHandle
    playbackHandle = null
    try {
      handle?.cancel()
    }
    catch {}
    try {
      services.speech.stop()
    }
    catch {}
    playbackState.value = idlePlaybackState
    errorMessage.value = '朗读没有成功启动，纯阅读和进度保存不受影响。'
  }

  function finishPlayback(version: number, sentenceId: string): void {
    if (!isCurrentPlayback(version, sentenceId)) {
      return
    }
    settleSpeechStartAsTerminal()
    playbackVersion += 1
    playbackHandle = null
    playbackState.value = idlePlaybackState
  }

  function isCurrentPlayback(version: number, sentenceId: string): boolean {
    return version === playbackVersion
      && playbackState.value.phase !== 'idle'
      && playbackState.value.sentenceId === sentenceId
  }

  function raceSpeechStartWithAbort(
    speakPromise: Promise<SpeechPlaybackHandle>,
    signal: AbortSignal,
  ): Promise<SpeechPlaybackHandle | null> {
    if (signal.aborted) {
      if (!terminalSpeechStartSignals.has(signal)) {
        cancelLateSpeechHandle(speakPromise)
      }
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        if (!terminalSpeechStartSignals.has(signal)) {
          cancelLateSpeechHandle(speakPromise)
        }
        resolve(null)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      speakPromise.then(
        (handle) => {
          signal.removeEventListener('abort', onAbort)
          resolve(handle)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  }

  function cancelLateSpeechHandle(speakPromise: Promise<SpeechPlaybackHandle>): void {
    void speakPromise.then((handle) => {
      try {
        handle.cancel()
      }
      catch {}
    }).catch(() => {})
  }

  function settleSpeechStartAsTerminal(): void {
    const controller = playbackStartAbortController
    if (!controller || controller.signal.aborted) {
      return
    }
    terminalSpeechStartSignals.add(controller.signal)
    try {
      controller.abort()
    }
    catch {}
  }

  function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      void operation.then(finish, finish)
    })
  }

  return {
    status: shallowReadonly(status),
    article: shallowReadonly(article),
    attempt: shallowReadonly(attempt),
    orderedSentences,
    currentSentenceId: shallowReadonly(currentSentenceId),
    currentSentenceIndex,
    progress,
    playingSentenceId,
    isPlaying,
    errorMessage: shallowReadonly(errorMessage),
    speechAvailable,
    load,
    selectSentence,
    previousSentence,
    nextSentence,
    togglePlayback,
    suspend,
    beginRouteTransition,
    resumeAfterFailedRouteTransition,
  }
}
