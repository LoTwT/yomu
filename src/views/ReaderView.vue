<script setup lang="ts">
import { PhArrowLeft, PhSlidersHorizontal } from '@phosphor-icons/vue'
import { computed, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import {
  isNavigationFailure,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  RouterLink,
  useRoute,
  useRouter,
} from 'vue-router'

import { useInteractionLayer } from '@/app/interactionLayer'
import { usePlatformServices } from '@/app/platformServices'
import { getRouteLeaveCoordinator } from '@/app/routeLeaveCoordinator'
import ReaderArticle, {
  type ReaderWordCardRequest,
} from '@/components/reader/ReaderArticle.vue'
import ReaderCompletionAction from '@/components/reader/ReaderCompletionAction.vue'
import ReaderPlaybackControls from '@/components/reader/ReaderPlaybackControls.vue'
import ReaderSettingsOverlay from '@/components/reader/ReaderSettingsOverlay.vue'
import ReaderWordCardOverlay from '@/components/reader/ReaderWordCardOverlay.vue'
import type { ArticleTokenRecord } from '@/data/entities'
import { requestLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { useReaderDisplayPreferences } from '@/features/preferences/useReaderDisplayPreferences'
import { deriveArticleCapabilities } from '@/features/reader/articleCapabilities'
import { useReadingSession } from '@/features/reader/useReadingSession'
import {
  removeVocabularyContext,
  saveVocabularyContext,
} from '@/features/vocabulary/vocabularyCommands'
import { findVocabularyContext } from '@/features/vocabulary/vocabularyQueries'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const props = defineProps<{
  articleId: string
}>()

interface ReaderWordCardState {
  actionState: 'idle' | 'loading' | 'saving'
  contextId: string | null
  errorMessage: string
  request: ReaderWordCardRequest
  token: ArticleTokenRecord
}

const route = useRoute()
const router = useRouter()
const { lifecycle, repositories } = usePlatformServices()
const interactionLayer = useInteractionLayer()
const routeLeaveCoordinator = getRouteLeaveCoordinator(router)
const settingsButton = useTemplateRef<HTMLButtonElement>('settingsButton')
const settingsOpen = shallowRef(false)
const showIpa = shallowRef(false)
const preferencesReady = shallowRef(false)
const reviewNavigationError = shallowRef('')
const wordCard = shallowRef<ReaderWordCardState | null>(null)
let viewUnmounted = false
let reviewNavigationVersion = 0
let wordCardVersion = 0
let wordCardRefreshPending = false
const unsubscribeVocabularyLifecycle = lifecycle.subscribe((event) => {
  if (event.state === 'active') {
    refreshOpenWordCard()
  }
})
let reviewNavigationOperation: {
  articleId: string
  attemptId: string
} | null = null
const pendingRouteTransitions: Array<{
  token: number
  from: string
  to: string
}> = []
const currentArticleId = computed(() => props.articleId)
const locatedSentenceId = computed(() => {
  const value = route.query.sentence
  return typeof value === 'string' && value.trim() ? value : undefined
})
const wordCardComponentKey = computed(() => wordCard.value
  ? JSON.stringify([
      wordCard.value.request.articleId,
      wordCard.value.request.sentenceId,
      wordCard.value.request.tokenId,
    ])
  : '')
const {
  defaultExpandTranslation,
  fontScale,
  persistence: readerPreferencePersistence,
  persistenceStatus: readerPreferencePersistenceStatus,
  ready: readerPreferencesReady,
  setDefaultExpandTranslation,
  setFontScale,
} = useReaderDisplayPreferences()
const {
  status,
  article,
  attempt,
  orderedSentences,
  currentSentenceId,
  currentSentenceIndex,
  progress,
  playingSentenceId,
  isPlaying,
  errorMessage,
  completionState,
  completionErrorMessage,
  playbackRate,
  activeSpeechProvider,
  cloudSpeechFallbackActive,
  speechProviderLabel,
  cloudConsentRequired,
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
  beginRouteTransition,
  resumeAfterFailedRouteTransition,
} = useReadingSession(currentArticleId)
const articleCapabilities = computed(() => article.value
  ? deriveArticleCapabilities(article.value.sentences)
  : undefined)
const completionActionError = computed(() =>
  reviewNavigationError.value || completionErrorMessage.value)
const settingsHistoryLayer = routeLeaveCoordinator.registerHistoryLayer({
  id: 'reader-settings',
  onActivate: () => {
    settingsOpen.value = true
  },
  onDeactivate: () => {
    settingsOpen.value = false
  },
  origin: () => router.currentRoute.value.fullPath,
})
// The open sheet is already the pending leave decision: restore a native pop
// to this Reader entry before asking the interaction layer to close the sheet.
const unregisterSettingsRouteBlocker = routeLeaveCoordinator.registerBlocker({
  hasPendingDecision: () => settingsOpen.value,
  onSecondaryPop: () => {
    if (!interactionLayer.requestCloseTop('navigation')) {
      void settingsHistoryLayer.deactivate()
    }
  },
  origin: () => router.currentRoute.value.fullPath,
  shouldBlock: () => settingsOpen.value,
})

void readerPreferencesReady.finally(() => {
  if (!viewUnmounted) {
    preferencesReady.value = true
  }
})

watch(currentArticleId, () => {
  closeWordCard()
  void settingsHistoryLayer.deactivate()
  showIpa.value = false
  reviewNavigationError.value = ''
})

watch(articleCapabilities, (capabilities) => {
  if (capabilities?.sentenceIpa === 'none') {
    showIpa.value = false
  }
})

watch(status, (nextStatus) => {
  if (nextStatus !== 'missing' && nextStatus !== 'error') {
    return
  }
  closeWordCard()
  void settingsHistoryLayer.retire()
  showIpa.value = false
})

watch(settingsOpen, (isOpen) => {
  if (isOpen && (status.value === 'missing' || status.value === 'error')) {
    void settingsHistoryLayer.retire()
  }
})

watch(cloudConsentRequired, (isRequired) => {
  if (isRequired && status.value === 'ready') {
    settingsHistoryLayer.activate()
  }
})

function takePendingRouteTransition(to: string, from: string) {
  const transitionIndex = pendingRouteTransitions.findIndex(transition =>
    transition.from === from && transition.to === to)
  if (transitionIndex < 0) {
    return undefined
  }
  return pendingRouteTransitions.splice(transitionIndex, 1)[0]
}

function settleFailedRouteTransition(to: string, from: string): void {
  const transition = takePendingRouteTransition(to, from)
  if (transition && pendingRouteTransitions.length === 0) {
    resumeAfterFailedRouteTransition(transition.token)
  }
}

const removeAfterEach = router.afterEach((to, from, failure) => {
  const transition = takePendingRouteTransition(to.fullPath, from.fullPath)
  if (!transition) {
    return
  }
  if (failure) {
    if (pendingRouteTransitions.length === 0) {
      resumeAfterFailedRouteTransition(transition.token)
    }
    return
  }
  if (to.name === 'library') {
    requestLibraryArticleFocus(props.articleId)
  }
})

const removeNavigationError = router.onError((_error, to, from) => {
  settleFailedRouteTransition(to.fullPath, from.fullPath)
})

onUnmounted(() => {
  viewUnmounted = true
  unsubscribeVocabularyLifecycle()
  closeWordCard()
  settingsHistoryLayer.dispose()
  unregisterSettingsRouteBlocker()
  removeAfterEach()
  removeNavigationError()
})

onBeforeRouteLeave(async (to, from) => {
  if (interactionLayer.requestCloseTop('navigation')) {
    return false
  }
  // A restored history layer can become active before article capabilities
  // allow its dialog to mount. Keep navigation overlay-first in that window
  // without treating a dialog that is already closing as a second overlay.
  if (settingsOpen.value && !articleCapabilities.value) {
    void settingsHistoryLayer.deactivate()
    return false
  }
  if (completionState.value === 'saving') {
    reviewNavigationVersion += 1
  }
  const transition = beginRouteTransition()
  pendingRouteTransitions.push({
    token: transition.token,
    from: from.fullPath,
    to: to.fullPath,
  })
  await transition.ready
  return true
})

onBeforeRouteUpdate(async (to, from) => {
  if (interactionLayer.requestCloseTop('navigation')) {
    return false
  }
  if (settingsOpen.value) {
    void settingsHistoryLayer.deactivate()
    return false
  }
  if (completionState.value === 'saving') {
    reviewNavigationVersion += 1
    const transition = beginRouteTransition()
    pendingRouteTransitions.push({
      token: transition.token,
      from: from.fullPath,
      to: to.fullPath,
    })
    await transition.ready
  }
  return true
})

usePageHeadingFocus()

function handleTogglePlayback(): void {
  void togglePlayback()
}

function handleRequestWordCard(request: ReaderWordCardRequest): void {
  const currentArticle = article.value
  if (!currentArticle || request.articleId !== currentArticle.id) {
    return
  }
  const sentence = currentArticle.sentences.find(candidate => candidate.id === request.sentenceId)
  const token = sentence?.tokens.find(candidate => candidate.id === request.tokenId)
  if (!sentence || !token || token.kind !== 'word') {
    return
  }

  if (isPlaying.value) {
    void togglePlayback()
  }
  wordCardRefreshPending = false
  const version = ++wordCardVersion
  wordCard.value = {
    actionState: 'loading',
    contextId: null,
    errorMessage: '',
    request,
    token,
  }
  loadWordCardSelection(version, request)
}

function refreshOpenWordCard(): void {
  const current = wordCard.value
  if (!current) {
    wordCardRefreshPending = false
    return
  }
  if (current.actionState === 'saving') {
    wordCardRefreshPending = true
    return
  }
  wordCardRefreshPending = false
  const version = ++wordCardVersion
  wordCard.value = {
    ...current,
    actionState: 'loading',
    errorMessage: '',
  }
  loadWordCardSelection(version, current.request)
}

function loadWordCardSelection(
  version: number,
  request: ReaderWordCardRequest,
): void {
  void findVocabularyContext(repositories, {
    articleId: request.articleId,
    sentenceId: request.sentenceId,
    tokenId: request.tokenId,
  }).then((savedSelection) => {
    updateWordCard(version, {
      actionState: 'idle',
      contextId: savedSelection?.context.id ?? null,
      errorMessage: '',
    })
  }).catch(() => {
    updateWordCard(version, {
      actionState: 'idle',
      errorMessage: '暂时无法读取收藏状态。你可以关闭词卡后重试。',
    })
  })
}

function handleSaveWord(): void {
  const current = wordCard.value
  if (!current || current.actionState !== 'idle' || current.contextId) {
    return
  }
  const version = wordCardVersion
  wordCard.value = {
    ...current,
    actionState: 'saving',
    errorMessage: '',
  }
  void saveVocabularyContext(repositories, {
    articleId: current.request.articleId,
    sentenceId: current.request.sentenceId,
    tokenId: current.request.tokenId,
  }).then((result) => {
    settleWordCardAction(version, {
      actionState: 'idle',
      contextId: result.context.id,
      errorMessage: '',
    })
  }).catch(() => {
    settleWordCardAction(version, {
      actionState: 'idle',
      errorMessage: '暂时无法收藏这个词，原文与已有收藏没有被修改。',
    })
  })
}

function handleRemoveWord(): void {
  const current = wordCard.value
  if (!current || current.actionState !== 'idle' || !current.contextId) {
    return
  }
  const version = wordCardVersion
  wordCard.value = {
    ...current,
    actionState: 'saving',
    errorMessage: '',
  }
  void removeVocabularyContext(repositories, {
    contextId: current.contextId,
  }).then(() => {
    settleWordCardAction(version, {
      actionState: 'idle',
      contextId: null,
      errorMessage: '',
    })
  }).catch(() => {
    settleWordCardAction(version, {
      actionState: 'idle',
      errorMessage: '暂时无法撤销收藏，原有收藏仍然保留。',
    })
  })
}

function updateWordCard(
  version: number,
  patch: Partial<Pick<ReaderWordCardState, 'actionState' | 'contextId' | 'errorMessage'>>,
): void {
  if (version !== wordCardVersion || !wordCard.value) {
    return
  }
  wordCard.value = { ...wordCard.value, ...patch }
}

function settleWordCardAction(
  version: number,
  patch: Partial<Pick<ReaderWordCardState, 'actionState' | 'contextId' | 'errorMessage'>>,
): void {
  updateWordCard(version, patch)
  if (version === wordCardVersion && wordCardRefreshPending) {
    refreshOpenWordCard()
  }
}

function closeWordCard(): void {
  wordCardRefreshPending = false
  wordCardVersion += 1
  wordCard.value = null
}

function handleCompleteReading(): void {
  const sourceArticle = article.value
  const sourceAttempt = attempt.value
  if (!sourceArticle || !sourceAttempt) {
    return
  }
  if (reviewNavigationOperation?.articleId === sourceArticle.id
    && reviewNavigationOperation.attemptId === sourceAttempt.id) {
    return
  }
  const operation = {
    articleId: sourceArticle.id,
    attemptId: sourceAttempt.id,
  }
  reviewNavigationOperation = operation
  reviewNavigationError.value = ''
  const navigationVersion = reviewNavigationVersion
  void completeReading()
    .then((completedAttempt) => {
      if (!completedAttempt) {
        return
      }
      return navigateToReview(completedAttempt.id, sourceArticle.id, navigationVersion)
    })
    .finally(() => {
      if (reviewNavigationOperation === operation) {
        reviewNavigationOperation = null
      }
    })
}

function handleOpenReview(): void {
  const sourceArticle = article.value
  const sourceAttempt = attempt.value
  if (!sourceArticle || sourceAttempt?.status !== 'completed') {
    return
  }
  if (reviewNavigationOperation?.articleId === sourceArticle.id
    && reviewNavigationOperation.attemptId === sourceAttempt.id) {
    return
  }
  const operation = {
    articleId: sourceArticle.id,
    attemptId: sourceAttempt.id,
  }
  reviewNavigationOperation = operation
  reviewNavigationError.value = ''
  const navigationVersion = reviewNavigationVersion
  void navigateToReview(sourceAttempt.id, sourceArticle.id, navigationVersion)
    .finally(() => {
      if (reviewNavigationOperation === operation) {
        reviewNavigationOperation = null
      }
    })
}

async function navigateToReview(
  attemptId: string,
  targetArticleId: string | undefined,
  navigationVersion: number,
): Promise<void> {
  if (viewUnmounted
    || navigationVersion !== reviewNavigationVersion
    || !targetArticleId
    || article.value?.id !== targetArticleId
    || router.currentRoute.value.name !== 'reader') {
    return
  }
  try {
    const failure = await router.replace({
      name: 'review',
      params: { attemptId },
    })
    if (failure && isNavigationFailure(failure) && !viewUnmounted) {
      reviewNavigationError.value = '阅读已完成，但回顾页面暂时未能打开。请重试。'
    }
  }
  catch {
    if (!viewUnmounted) {
      reviewNavigationError.value = '阅读已完成，但回顾页面暂时未能打开。请重试。'
    }
  }
}

function openSettings(): void {
  settingsHistoryLayer.activate()
}

function closeSettings(): void {
  if (cloudConsentRequired.value) {
    declineCloudSpeechConsent()
  }
  void settingsHistoryLayer.deactivate()
}

async function handleAcceptCloudSpeechConsent(): Promise<void> {
  await settingsHistoryLayer.deactivate()
  await acceptCloudSpeechConsent()
}

function handleDeclineCloudSpeechConsent(): void {
  declineCloudSpeechConsent()
  void settingsHistoryLayer.deactivate()
}

async function handleRepeatCurrentSentence(): Promise<void> {
  if (cloudConsentRequired.value) {
    await repeatCurrentSentence()
    return
  }
  await settingsHistoryLayer.deactivate()
  await repeatCurrentSentence()
}

async function handleRetryCloudSpeech(): Promise<void> {
  await settingsHistoryLayer.deactivate()
  await retryCloudSpeech()
}

async function handleManageSpeechServices(): Promise<void> {
  if (cloudConsentRequired.value) {
    declineCloudSpeechConsent()
  }
  await settingsHistoryLayer.deactivate()
  if (viewUnmounted) {
    return
  }
  await router.push({ name: 'settings', hash: '#settings-speech-title' })
}
</script>

<template>
  <div class="reader-view">
    <header class="reader-view__toolbar">
      <RouterLink class="reader-view__back" :to="{ name: 'library' }">
        <PhArrowLeft aria-hidden="true" :size="20" />
        <span>我的阅读</span>
      </RouterLink>
      <h1 ref="pageHeading" class="reader-view__short-title" data-page-heading tabindex="-1" lang="en">
        {{ article?.title ?? '专注阅读' }}
      </h1>
      <div class="reader-view__toolbar-actions">
        <div class="reader-view__progress-wrap">
          <progress
            class="reader-view__progress"
            :value="progress"
            max="100"
            :aria-label="`文章进度 ${progress}%`"
          />
          <span>{{ progress }}%</span>
        </div>
        <button
          v-if="status === 'ready' && article"
          ref="settingsButton"
          class="reader-view__settings"
          type="button"
          aria-label="阅读设置"
          :aria-controls="settingsOpen ? 'reader-settings' : undefined"
          :aria-expanded="settingsOpen"
          @click="openSettings"
        >
          <PhSlidersHorizontal aria-hidden="true" :size="20" />
        </button>
      </div>
    </header>

    <main class="reader-view__main">
      <p v-if="status === 'loading'" class="reader-view__state" role="status">
        正在打开此设备上的文章…
      </p>
      <section v-else-if="status === 'missing'" class="reader-view__state" role="alert">
        <h2>找不到这篇文章</h2>
        <p>它可能已被删除，Yomu 不会用 Today 或其他正文替代它。</p>
        <RouterLink :to="{ name: 'library' }">
          返回我的阅读
        </RouterLink>
      </section>
      <section v-else-if="status === 'error'" class="reader-view__state" role="alert">
        <h2>暂时无法打开</h2>
        <p>{{ errorMessage }}</p>
        <button type="button" @click="load">
          重试
        </button>
      </section>
      <template v-else-if="article">
        <p v-if="errorMessage" class="reader-view__notice" role="status">
          {{ errorMessage }}
        </p>
        <ReaderArticle
          :article="article"
          :current-sentence-id="currentSentenceId"
          :default-expand-translation="defaultExpandTranslation"
          :font-scale="fontScale"
          :located-sentence-id="locatedSentenceId"
          :playing-sentence-id="playingSentenceId"
          :preferences-ready="preferencesReady"
          :show-ipa="showIpa"
          @request-word-card="handleRequestWordCard"
          @select-sentence="selectSentence"
        />
        <ReaderCompletionAction
          :error-message="completionActionError"
          :state="completionState"
          @complete="handleCompleteReading"
          @open-review="handleOpenReview"
        />
      </template>
    </main>

    <footer
      v-if="status === 'ready' && (completionState === 'idle' || completionState === 'error')"
      class="reader-view__footer"
    >
      <ReaderPlaybackControls
        :current-index="currentSentenceIndex"
        :total="orderedSentences.length"
        :is-playing="isPlaying"
        :speech-available="speechAvailable"
        @previous="previousSentence"
        @toggle-playback="handleTogglePlayback"
        @next="nextSentence"
      />
    </footer>

    <ReaderSettingsOverlay
      v-if="settingsOpen && articleCapabilities"
      :article-capabilities="articleCapabilities"
      :active-speech-provider="activeSpeechProvider"
      :cloud-fallback-active="cloudSpeechFallbackActive"
      :cloud-consent-required="cloudConsentRequired"
      :default-expand-translation="defaultExpandTranslation"
      :focus-return="settingsButton"
      :font-scale="fontScale"
      :persistence="readerPreferencePersistence"
      :persistence-status="readerPreferencePersistenceStatus"
      :playback-rate="playbackRate"
      :show-ipa="showIpa"
      :speech-provider-label="speechProviderLabel"
      @accept-cloud-consent="void handleAcceptCloudSpeechConsent()"
      @close="closeSettings"
      @decline-cloud-consent="handleDeclineCloudSpeechConsent"
      @manage-speech-services="void handleManageSpeechServices()"
      @repeat-sentence="void handleRepeatCurrentSentence()"
      @retry-cloud-speech="void handleRetryCloudSpeech()"
      @update:default-expand-translation="setDefaultExpandTranslation"
      @update:font-scale="setFontScale"
      @update:playback-rate="setPlaybackRate"
      @update:show-ipa="showIpa = $event"
    />

    <ReaderWordCardOverlay
      v-if="wordCard"
      :key="wordCardComponentKey"
      :action-state="wordCard.actionState"
      :anchor="wordCard.request.anchor"
      :error-message="wordCard.errorMessage"
      :focus-return="wordCard.request.focusReturn"
      :saved="wordCard.contextId !== null"
      :token="wordCard.token"
      @close="closeWordCard"
      @remove="handleRemoveWord"
      @save="handleSaveWord"
    />
  </div>
</template>

<style scoped>
.reader-view {
  min-block-size: 100vh;
  min-block-size: 100dvh;
  background: var(--surface-canvas);
}

.reader-view__toolbar {
  position: sticky;
  inset-block-start: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(5rem, auto);
  align-items: center;
  gap: 0.75rem;
  min-block-size: calc(3.75rem + env(safe-area-inset-top));
  border-block-end: 1px solid var(--border-subtle);
  padding:
    env(safe-area-inset-top)
    max(1rem, env(safe-area-inset-right))
    0
    max(1rem, env(safe-area-inset-left));
  background: color-mix(in srgb, var(--surface-canvas) 94%, transparent);
  backdrop-filter: blur(16px);
}

.reader-view__back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-block-size: 2.75rem;
  color: var(--text-accent);
  font-size: 0.82rem;
  font-weight: 700;
  text-decoration: none;
}

.reader-view__short-title {
  overflow: hidden;
  margin: 0;
  font-family: var(--font-reading);
  font-size: 0.92rem;
  font-weight: 650;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-view__short-title:focus {
  outline: 0;
}

.reader-view__progress-wrap {
  display: grid;
  grid-template-columns: minmax(2.5rem, 5rem) auto;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.reader-view__toolbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  min-inline-size: 0;
}

.reader-view__settings {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  padding: 0;
  background: transparent;
  color: var(--text-accent);
  cursor: pointer;
}

.reader-view__progress {
  overflow: hidden;
  inline-size: 100%;
  block-size: 0.25rem;
  border: 0;
  border-radius: var(--radius-full);
  appearance: none;
  background: var(--surface-muted);
  color: var(--accent-primary-active);
}

.reader-view__progress::-webkit-progress-bar {
  background: var(--surface-muted);
}

.reader-view__progress::-webkit-progress-value {
  background: var(--accent-primary-active);
}

.reader-view__progress::-moz-progress-bar {
  background: var(--accent-primary-active);
}

.reader-view__main {
  padding: 0 max(1rem, env(safe-area-inset-right)) calc(7rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.reader-view__state,
.reader-view__notice {
  inline-size: min(100%, 42rem);
  margin: 2rem auto;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  line-height: 1.6;
}

.reader-view__state h2 {
  margin-block-start: 0;
  color: var(--text-primary);
}

.reader-view__state a,
.reader-view__state button {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: var(--surface-canvas);
  color: var(--text-accent);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.reader-view__footer {
  position: fixed;
  inset-inline: 0;
  inset-block-end: 0;
  z-index: 25;
  padding: 0.6rem max(0.5rem, env(safe-area-inset-right)) max(0.6rem, env(safe-area-inset-bottom)) max(0.5rem, env(safe-area-inset-left));
  background: linear-gradient(transparent, var(--surface-canvas) 28%);
}

.reader-view__back:focus-visible,
.reader-view__settings:focus-visible,
.reader-view__state a:focus-visible,
.reader-view__state button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (max-width: 479px) {
  .reader-view__back span {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .reader-view__toolbar {
    grid-template-columns: 2.75rem minmax(0, 1fr) minmax(4.75rem, auto);
  }
}

@media (hover: hover) {
  .reader-view__settings:hover {
    border-color: var(--border-subtle);
    background: var(--surface-muted);
  }
}

@media (min-width: 768px) {
  .reader-view__toolbar {
    padding-inline: 1.5rem;
  }

  .reader-view__main {
    padding-inline: 1.5rem;
  }
}
</style>
