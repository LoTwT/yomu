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
import { useProviderSettings } from '@/features/settings/useProviderSettings'
import { createReadingSpeechEngine } from '@/features/tts/readingSpeechEngine'
import {
  getActiveTtsProvider,
  getTtsProviderLabel,
} from '@/features/tts/settings'
import type {
  AppLifecycleState,
  ReadingAttemptCompletedEvent,
  SpeechPlaybackHandle,
} from '@/platform/contracts'
import {
  ArticleNotFoundError,
  completeReadingAttempt,
  flushReadingPosition,
  openReadingAttempt,
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
export type ReadingCompletionState = 'idle' | 'saving' | 'completed' | 'error'
export type ReadingPlaybackRate = 0.85 | 1 | 1.15
export const readingPlaybackRates = [0.85, 1, 1.15] as const

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

interface ReadingCompletionOperation {
  articleId: string
  attemptId: string
  promise: Promise<ReadingAttempt | null>
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
  const {
    ttsSettings,
    ready: providerSettingsReady,
  } = useProviderSettings()
  const speechEngine = createReadingSpeechEngine({
    speech: services.speech,
    audio: services.audio,
    cloudSpeech: services.cloudSpeech,
    getSettings: () => ttsSettings.value,
  })
  const journalWriterId = createReadingProgressJournalWriterId()
  const status = shallowRef<ReadingSessionStatus>('loading')
  const article = shallowRef<ArticleRecord | null>(null)
  const attempt = shallowRef<ReadingAttempt | null>(null)
  const currentSentenceId = shallowRef('')
  const furthestSentenceOrdinal = shallowRef(0)
  const playbackState = shallowRef<ReadingPlaybackState>(idlePlaybackState)
  const errorMessage = shallowRef('')
  const completionState = shallowRef<ReadingCompletionState>('idle')
  const completionErrorMessage = shallowRef('')
  const playbackRate = shallowRef<ReadingPlaybackRate>(1)
  const cloudConsentRequired = shallowRef(false)
  const cloudSpeechFallbackActive = shallowRef(false)
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
  const configuredSpeechProvider = computed(() => getActiveTtsProvider(ttsSettings.value))
  const activeSpeechProvider = computed(() => cloudSpeechFallbackActive.value
    || (configuredSpeechProvider.value === 'mimo'
      && (!services.audio.isAvailable() || !services.cloudSpeech.isAvailable()))
    ? 'webspeech'
    : configuredSpeechProvider.value)
  const speechProviderLabel = computed(() => {
    if (configuredSpeechProvider.value === 'mimo' && !services.audio.isAvailable()) {
      return '浏览器朗读（此平台无法播放云音频）'
    }
    if (configuredSpeechProvider.value === 'mimo' && !services.cloudSpeech.isAvailable()) {
      return '浏览器朗读（此平台未提供云语音）'
    }
    return cloudSpeechFallbackActive.value
      ? '浏览器朗读（MiMo 暂不可用）'
      : getTtsProviderLabel(ttsSettings.value)
  })
  const speechAvailable = computed(() => article.value?.rights.ttsAllowed === true
    && (activeSpeechProvider.value === 'webspeech'
      ? services.speech.isAvailable()
      : speechEngine.isAvailable()))

  let loadVersion = 0
  let playbackVersion = 0
  let articlePresenceValidationVersion = 0
  let activeArticleRevalidationPending = false
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
  let completionOperation: ReadingCompletionOperation | null = null
  let providerSettingsLoaded = false
  let cloudConsentAccepted = false
  let pendingCloudConsentSentenceId: string | null = null
  const observedCompletedAttempts = new Map<string, ReadingAttemptCompletedEvent['attempt']>()
  let disposed = false

  void providerSettingsReady.finally(() => {
    providerSettingsLoaded = true
  })

  watch(
    ttsSettings,
    () => {
      clearSpeechRuntime()
    },
  )

  const unsubscribeLifecycle = services.lifecycle.subscribe((event) => {
    lifecycleState = event.state
    if (event.state === 'active') {
      void revalidateActiveArticle()
      return
    }
    clearSpeechRuntime()
    articlePresenceValidationVersion += 1
    activeArticleRevalidationPending = false
    if (event.reason === 'pagehide'
      || event.reason === 'system'
      || event.reason === 'window-close') {
      suspendForTerminalLifecycleEvent()
      return
    }
    void suspend().catch(() => {})
  })
  const unsubscribeAttemptEvents = services.readingAttemptEvents?.subscribeCompleted((event) => {
    observedCompletedAttempts.set(event.attempt.id, event.attempt)
    if (attempt.value?.id === event.attempt.id
      && attempt.value.status !== 'completed'
      && article.value?.id === event.attempt.articleId) {
      presentCompletedAttempt(article.value, event.attempt)
    }
  }) ?? (() => {})
  const unsubscribeArticleEvents = services.articleEvents?.subscribeDeleted((event) => {
    presentMissingArticle(event.articleId)
  }) ?? (() => {})

  watch(
    () => toValue(articleId),
    () => void load(),
    { immediate: true },
  )

  onUnmounted(() => {
    disposed = true
    loadVersion += 1
    articlePresenceValidationVersion += 1
    unsubscribeLifecycle()
    unsubscribeAttemptEvents()
    unsubscribeArticleEvents()
    cancelScheduledFlush()
    void suspend().catch(() => {})
    void speechEngine.dispose().catch(() => {})
  })

  async function load(): Promise<void> {
    const version = ++loadVersion
    articlePresenceValidationVersion += 1
    activeArticleRevalidationPending = false
    const targetArticleId = toValue(articleId)
    status.value = 'loading'
    cloudSpeechFallbackActive.value = false
    await suspend()
    await speechEngine.clearCache().catch(() => {})
    if (!isCurrentLoad(version, targetArticleId)) {
      return
    }
    resetCloudConsent()
    article.value = null
    attempt.value = null
    currentSentenceId.value = ''
    furthestSentenceOrdinal.value = 0
    activeDurationMs = 0
    activeSinceMs = null
    cursorDirty = false
    errorMessage.value = ''
    completionState.value = 'idle'
    completionErrorMessage.value = ''

    try {
      const result = await openReadingAttempt(
        services.repositories,
        targetArticleId,
      )
      if (!isCurrentLoad(version, targetArticleId)) {
        return
      }
      const observedCompletion = observedCompletedAttempts.get(result.attempt.id)
      if (result.attempt.status === 'completed' || observedCompletion) {
        presentCompletedAttempt(result.article, observedCompletion ?? result.attempt)
        return
      }
      const recovered = await replayProgressJournal(
        result.article,
        result.attempt,
      )
      if (!isCurrentLoad(version, targetArticleId)) {
        return
      }
      const completionDuringRecovery = observedCompletedAttempts.get(recovered.attempt.id)
      if (completionDuringRecovery) {
        presentCompletedAttempt(result.article, completionDuringRecovery)
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
        presentMissingArticle(targetArticleId)
        return
      }
      status.value = 'error'
      errorMessage.value = '这篇文章暂时无法打开。阅读库内容没有被修改，请返回后重试。'
    }
  }

  function selectSentence(sentenceId: string): void {
    if (status.value !== 'ready'
      || routeTransitionSuspended
      || !allowsReadingInteraction()
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
    if (!providerSettingsLoaded) {
      return providerSettingsReady
        .then(() => startPlayback(sentenceId))
        .catch(() => startPlayback(sentenceId))
    }
    if (!speechAvailable.value) {
      errorMessage.value = article.value?.rights.ttsAllowed === false
        ? '这篇文章的使用许可不允许语音朗读，纯阅读仍可继续。'
        : '当前没有可用的朗读方式，纯阅读仍可继续。'
      return Promise.resolve()
    }
    if (disposed
      || status.value !== 'ready'
      || routeTransitionSuspended
      || !allowsReadingInteraction()
      || lifecycleState !== 'active') {
      return Promise.resolve()
    }
    const sentence = orderedSentences.value.find(value => value.id === sentenceId)
    if (!sentence || !article.value) {
      return Promise.resolve()
    }

    if (activeSpeechProvider.value === 'mimo' && !cloudConsentAccepted) {
      pendingCloudConsentSentenceId = sentence.id
      cloudConsentRequired.value = true
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
    const providerAtStart = activeSpeechProvider.value
    let providerPlaybackStarted = false
    try {
      const speechRequest = {
        id: sentence.id,
        original: sentence.original,
        textHash: sentence.textHash ?? sentence.id,
        cacheAllowed: article.value?.rights.cacheAllowed === true,
        cloudConsentGranted: providerAtStart === 'mimo' && cloudConsentAccepted,
        language: 'en-US',
        playbackRate: playbackRate.value,
        signal: abortController.signal,
        onStart: () => {
          providerPlaybackStarted = true
          if (isCurrentPlayback(version, sentence.id)) {
            playbackState.value = { phase: 'playing', sentenceId: sentence.id }
          }
        },
        onEnd: () => handlePlaybackEnd(version, sentence.id),
        onError: () => {
          if (providerAtStart === 'mimo' && !providerPlaybackStarted) {
            return
          }
          if (providerAtStart === 'mimo') {
            fallbackStartedCloudPlayback(version, sentence)
            return
          }
          failPlayback(version, sentence.id)
        },
      }
      const speakPromise = providerAtStart === 'mimo'
        ? speechEngine.playSentence(speechRequest)
        : speechEngine.playSystemSentence(speechRequest)
      if (providerAtStart === 'mimo' && cloudConsentAccepted) {
        prefetchUpcomingSentences(sentence.id)
      }
      let handle: SpeechPlaybackHandle | null
      try {
        handle = await raceSpeechStartWithAbort(
          speakPromise,
          abortController.signal,
        )
      }
      catch (error) {
        if (providerAtStart !== 'mimo'
          || providerPlaybackStarted
          || !services.speech.isAvailable()
          || !isCurrentPlayback(version, sentence.id)
          || abortController.signal.aborted
          || isAbortError(error)) {
          throw error
        }
        speechEngine.stop()
        cloudSpeechFallbackActive.value = true
        cloudConsentRequired.value = false
        pendingCloudConsentSentenceId = null
        errorMessage.value = 'MiMo 暂时不可用，已改用浏览器朗读当前句。'
        handle = await raceSpeechStartWithAbort(
          speechEngine.playSystemSentence({
            ...speechRequest,
            onError: () => failPlayback(version, sentence.id),
          }),
          abortController.signal,
        )
      }
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

  function prefetchUpcomingSentences(sentenceId: string): void {
    if (article.value?.rights.cacheAllowed !== true) {
      return
    }
    const sentenceIndex = orderedSentences.value.findIndex(value => value.id === sentenceId)
    if (sentenceIndex < 0) {
      return
    }
    const upcoming = orderedSentences.value
      .slice(sentenceIndex + 1, sentenceIndex + 3)
      .map(sentence => ({
        id: sentence.id,
        original: sentence.original,
        textHash: sentence.textHash ?? sentence.id,
      }))
    void speechEngine.prefetchSentences(upcoming, cloudConsentAccepted).catch(() => {})
  }

  function fallbackStartedCloudPlayback(
    version: number,
    sentence: ArticleSentenceRecord,
  ): void {
    if (!services.speech.isAvailable() || !isCurrentPlayback(version, sentence.id)) {
      failPlayback(version, sentence.id)
      return
    }
    try {
      speechEngine.stop()
    }
    catch {}
    playbackHandle = null
    cloudSpeechFallbackActive.value = true
    cloudConsentRequired.value = false
    pendingCloudConsentSentenceId = null
    errorMessage.value = 'MiMo 播放中断，已改用浏览器重新朗读当前句。'
    const fallbackVersion = ++playbackVersion
    playbackState.value = { phase: 'starting', sentenceId: sentence.id }
    void queueSpeechStart(fallbackVersion, sentence).catch(() => {})
  }

  function acceptCloudSpeechConsent(): Promise<void> {
    if (activeSpeechProvider.value !== 'mimo') {
      resetCloudConsent()
      return Promise.resolve()
    }
    cloudConsentAccepted = true
    cloudConsentRequired.value = false
    const sentenceId = pendingCloudConsentSentenceId ?? currentSentenceId.value
    pendingCloudConsentSentenceId = null
    return startPlayback(sentenceId)
  }

  function declineCloudSpeechConsent(): void {
    resetCloudConsent()
    errorMessage.value = '未发送正文；你仍可纯阅读，或在语音设置中改用浏览器朗读。'
  }

  function retryCloudSpeech(): Promise<void> {
    if (configuredSpeechProvider.value !== 'mimo') {
      return Promise.resolve()
    }
    cloudSpeechFallbackActive.value = false
    return startPlayback(currentSentenceId.value)
  }

  function repeatCurrentSentence(): Promise<void> {
    if (isPlaying.value || playbackHandle) {
      stopSpeech()
    }
    return startPlayback(currentSentenceId.value)
  }

  function setPlaybackRate(nextRate: ReadingPlaybackRate): void {
    if (!readingPlaybackRates.includes(nextRate) || playbackRate.value === nextRate) {
      return
    }
    const shouldRestart = isPlaying.value
    playbackRate.value = nextRate
    if (shouldRestart) {
      void repeatCurrentSentence()
    }
  }

  function resetCloudConsent(): void {
    cloudConsentAccepted = false
    cloudConsentRequired.value = false
    pendingCloudConsentSentenceId = null
  }

  function clearSpeechRuntime(): void {
    cloudSpeechFallbackActive.value = false
    resetCloudConsent()
    stopSpeech()
    void speechEngine.clearCache().catch(() => {})
  }

  function suspend(): Promise<void> {
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    if (completionState.value === 'completed') {
      return Promise.resolve()
    }
    if (completionState.value === 'saving') {
      const operation = currentCompletionOperation()
      return operation
        ? settleWithin(operation.promise, routeTransitionSaveDeadlineMs)
        : Promise.resolve()
    }
    const journalOperation = persistCurrentProgress()
    return queueSuspension(journalOperation)
  }

  function suspendForTerminalLifecycleEvent(): void {
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    if (completionState.value === 'completed') {
      return
    }
    persistCurrentProgressImmediately()
    if (completionState.value === 'saving') {
      return
    }
    void queueSuspension(Promise.resolve()).catch(() => {})
  }

  function beginRouteTransition(): ReadingRouteTransition {
    const token = ++routeTransitionVersion
    routeTransitionSuspended = true
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    if (completionState.value === 'completed') {
      return { token, ready: Promise.resolve() }
    }
    if (completionState.value === 'saving') {
      const operation = currentCompletionOperation()
      return {
        token,
        ready: operation
          ? settleWithin(operation.promise, routeTransitionSaveDeadlineMs)
          : Promise.resolve(),
      }
    }
    persistCurrentProgressImmediately()
    const backgroundSave = queueSuspension(Promise.resolve())
    return {
      token,
      ready: settleWithin(backgroundSave, routeTransitionSaveDeadlineMs),
    }
  }

  function resumeAfterFailedRouteTransition(token: number): void {
    if (disposed
      || token !== routeTransitionVersion
      || !allowsReadingInteraction()
      || attempt.value?.status !== 'active') {
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
      || !allowsReadingInteraction()
      || attempt.value?.status !== 'active'
      || lifecycleState !== 'active'
      || activeSinceMs !== null) {
      return
    }
    activeSinceMs = Date.now()
  }

  function allowsReadingInteraction(): boolean {
    return !activeArticleRevalidationPending
      && attempt.value?.status === 'active'
      && (completionState.value === 'idle' || completionState.value === 'error')
  }

  async function revalidateActiveArticle(): Promise<void> {
    const targetArticleId = toValue(articleId)
    if (disposed
      || lifecycleState !== 'active'
      || status.value !== 'ready'
      || article.value?.id !== targetArticleId) {
      startTiming()
      return
    }

    const version = ++articlePresenceValidationVersion
    activeArticleRevalidationPending = true
    checkpointActiveDuration(false)
    try {
      const persistedArticle = await services.repositories.articles.get(targetArticleId)
      if (!isCurrentArticlePresenceValidation(version, targetArticleId)) {
        return
      }
      activeArticleRevalidationPending = false
      if (!persistedArticle) {
        presentMissingArticle(targetArticleId)
        return
      }
      startTiming()
    }
    catch {
      if (!isCurrentArticlePresenceValidation(version, targetArticleId)) {
        return
      }
      activeArticleRevalidationPending = false
      stopSpeech()
      activeSinceMs = null
      status.value = 'error'
      errorMessage.value = '暂时无法确认这篇文章是否仍保存在本机。请重试后再继续阅读。'
    }
  }

  function isCurrentArticlePresenceValidation(
    version: number,
    targetArticleId: string,
  ): boolean {
    return !disposed
      && version === articlePresenceValidationVersion
      && lifecycleState === 'active'
      && targetArticleId === toValue(articleId)
  }

  function presentMissingArticle(targetArticleId: string): void {
    if (disposed || targetArticleId !== toValue(articleId)) {
      return
    }
    loadVersion += 1
    articlePresenceValidationVersion += 1
    activeArticleRevalidationPending = false
    cancelScheduledFlush()
    stopSpeech()
    activeSinceMs = null
    article.value = null
    attempt.value = null
    currentSentenceId.value = ''
    furthestSentenceOrdinal.value = 0
    activeDurationMs = 0
    cursorDirty = false
    errorMessage.value = ''
    completionState.value = 'idle'
    completionErrorMessage.value = ''
    completionOperation = null
    routeTransitionSuspended = false
    observedCompletedAttempts.forEach((completedAttempt, attemptId) => {
      if (completedAttempt.articleId === targetArticleId) {
        observedCompletedAttempts.delete(attemptId)
      }
    })
    status.value = 'missing'
  }

  function isCurrentLoad(version: number, targetArticleId: string): boolean {
    return version === loadVersion
      && !disposed
      && targetArticleId === toValue(articleId)
  }

  function presentCompletedAttempt(
    completedArticle: ArticleRecord,
    completedAttempt: ReadingAttempt,
  ): void {
    cancelScheduledFlush()
    stopSpeech()
    activeSinceMs = null
    article.value = completedArticle
    attempt.value = completedAttempt
    currentSentenceId.value = completedAttempt.currentSentenceId
      ?? completedArticle.sentences[0]?.id
      ?? ''
    furthestSentenceOrdinal.value = completedAttempt.furthestSentenceOrdinal
    activeDurationMs = completedAttempt.activeDurationSec * 1_000
    cursorDirty = false
    errorMessage.value = ''
    completionState.value = 'completed'
    completionErrorMessage.value = ''
    routeTransitionSuspended = false
    status.value = 'ready'
    void retireCompletedProgressJournal(completedAttempt)
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
    if (!currentAttempt
      || currentAttempt.status !== 'active'
      || completionState.value === 'completed'
      || !currentArticle
      || !sentenceId) {
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

  function completeReading(): Promise<ReadingAttempt | null> {
    const currentArticle = article.value
    const currentAttempt = attempt.value
    const existingOperation = currentCompletionOperation()
    if (existingOperation) {
      return existingOperation.promise
    }
    if (completionState.value === 'completed' && attempt.value?.status === 'completed') {
      return Promise.resolve(attempt.value)
    }

    if (status.value !== 'ready'
      || routeTransitionSuspended
      || !currentArticle
      || !currentAttempt
      || currentAttempt.status !== 'active'
      || !currentSentenceId.value) {
      return Promise.resolve(null)
    }

    completionState.value = 'saving'
    completionErrorMessage.value = ''
    routeTransitionSuspended = true
    routeTransitionVersion += 1
    cancelScheduledFlush()
    stopSpeech()
    checkpointActiveDuration(false)
    const snapshot = createCurrentProgressSnapshot()
    if (!snapshot) {
      completionState.value = 'error'
      completionErrorMessage.value = '本次阅读暂时无法完成，请继续阅读后重试。'
      routeTransitionSuspended = false
      startTiming()
      return Promise.resolve(null)
    }

    const operation = finishReading(snapshot)
    const trackedOperation: ReadingCompletionOperation = {
      articleId: snapshot.articleId,
      attemptId: snapshot.attemptId,
      promise: operation,
    }
    completionOperation = trackedOperation
    void operation.finally(() => {
      if (completionOperation === trackedOperation) {
        completionOperation = null
      }
    })
    return operation
  }

  async function finishReading(
    snapshot: ReadingProgressSnapshot,
  ): Promise<ReadingAttempt | null> {
    try {
      await settleWithin(
        queueSuspension(persistCurrentProgress()),
        routeTransitionSaveDeadlineMs,
      )
      const result = await completeReadingAttempt(services.repositories, {
        articleId: snapshot.articleId,
        attemptId: snapshot.attemptId,
        currentSentenceId: snapshot.currentSentenceId,
        furthestSentenceOrdinal: snapshot.furthestSentenceOrdinal,
        activeDurationSec: snapshot.activeDurationSec,
      })
      if (isCurrentCompletion(snapshot)) {
        attempt.value = result.attempt
        activeDurationMs = Math.max(
          activeDurationMs,
          result.attempt.activeDurationSec * 1_000,
        )
        furthestSentenceOrdinal.value = Math.max(
          furthestSentenceOrdinal.value,
          result.attempt.furthestSentenceOrdinal,
        )
        cursorDirty = false
        errorMessage.value = ''
        completionState.value = 'completed'
        completionErrorMessage.value = ''
      }
      if (result.attempt.status === 'completed'
        && typeof result.attempt.completedAt === 'string') {
        try {
          services.readingAttemptEvents?.publishCompleted({
            attempt: {
              ...result.attempt,
              status: 'completed',
              completedAt: result.attempt.completedAt,
            },
          })
        }
        catch {}
      }
      void retireCompletedProgressJournal(result.attempt)
      return result.attempt
    }
    catch {
      if (isCurrentCompletion(snapshot)) {
        if (attempt.value?.status === 'completed') {
          completionState.value = 'completed'
          completionErrorMessage.value = ''
          return attempt.value
        }
        completionState.value = 'error'
        completionErrorMessage.value = '本次阅读暂时无法保存为已完成，请稍后重试。当前进度仍会保留。'
        routeTransitionSuspended = false
        startTiming()
      }
      return null
    }
  }

  function isCurrentCompletion(snapshot: ReadingProgressSnapshot): boolean {
    return !disposed
      && article.value?.id === snapshot.articleId
      && attempt.value?.id === snapshot.attemptId
  }

  function currentCompletionOperation(): ReadingCompletionOperation | null {
    const operation = completionOperation
    return operation
      && article.value?.id === operation.articleId
      && attempt.value?.id === operation.attemptId
      ? operation
      : null
  }

  async function retireCompletedProgressJournal(
    completedAttempt: ReadingAttempt,
  ): Promise<void> {
    try {
      await journalWriter
      await journalStorageQueue
      const journal = await readReadingProgressJournal(
        services.preferences,
        completedAttempt.articleId,
        completedAttempt.id,
        completedAttempt.progressRevision ?? 0,
      )
      if (!journal || journal.attemptId !== completedAttempt.id) {
        return
      }
      await runJournalStorageOperation(() =>
        clearReadingProgressJournal(services.preferences, journal))
      scheduleProgressJournalCompaction(completedAttempt.articleId)
    }
    catch {}
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
    if (!currentArticle
      || !currentAttempt
      || currentAttempt.status !== 'active'
      || completionState.value === 'completed'
      || !sentenceId) {
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
      && attempt.value?.status === 'active'
      && completionState.value !== 'completed'
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
      speechEngine.stop()
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
      speechEngine.stop()
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

  function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'name' in error
      && error.name === 'AbortError'
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
    completionState: shallowReadonly(completionState),
    completionErrorMessage: shallowReadonly(completionErrorMessage),
    playbackRate: shallowReadonly(playbackRate),
    activeSpeechProvider,
    cloudSpeechFallbackActive: shallowReadonly(cloudSpeechFallbackActive),
    speechProviderLabel,
    cloudConsentRequired: shallowReadonly(cloudConsentRequired),
    speechAvailable,
    load,
    selectSentence,
    previousSentence,
    nextSentence,
    togglePlayback,
    repeatCurrentSentence,
    setPlaybackRate,
    acceptCloudSpeechConsent,
    declineCloudSpeechConsent,
    retryCloudSpeech,
    completeReading,
    suspend,
    beginRouteTransition,
    resumeAfterFailedRouteTransition,
  }
}
