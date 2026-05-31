<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import ArticleStatusCard from './components/ArticleStatusCard.vue'
import ArticleReader from './components/ArticleReader.vue'
import AssistiveDisplayControls from './components/AssistiveDisplayControls.vue'
import CompletionPanel from './components/CompletionPanel.vue'
import ReadExpansionConsent from './components/ReadExpansionConsent.vue'
import ReadExpansionSettingsPanel from './components/ReadExpansionSettingsPanel.vue'
import ReadAloudControls from './components/ReadAloudControls.vue'
import TodayCard from './components/TodayCard.vue'
import TtsSettingsPanel from './components/TtsSettingsPanel.vue'
import {
  loadCachedArticlePackage,
  loadTodayArticlePackage,
  type ArticlePackageLoadResult,
} from './features/article/articlePackageLoader'
import type { ArticleToken, DailyArticle } from './features/article/types'
import type { DisplayPreferences } from './features/preferences/types'
import { defaultDisplayPreferences } from './features/preferences/types'
import { useReadAloudSession } from './features/player/useReadAloudSession'
import { requestAiWordExpansion } from './features/extension/aiAdapter'
import { extractReadExpansionTerms, findReadExpansionTermForToken } from './features/extension/localExtraction'
import {
  defaultReadExpansionSettings,
  getAiProviderLabel,
  isAiExpansionConfigured,
  loadReadExpansionSettings,
  saveReadExpansionSettings,
  type ReadExpansionSettings,
} from './features/extension/settings'
import type { AiWordExpansionState, ReadExpansionTerm } from './features/extension/types'
import {
  loadDisplayPreferences,
  loadPracticeSession,
  loadSavedVocabularyIds,
  saveDisplayPreferences,
  savePracticeSession,
  saveSavedVocabularyIds,
  type PracticeSessionRecord,
} from './features/storage/practiceStorage'
import { createConfiguredSentencePlayer } from './features/tts/configuredSentencePlayer'
import {
  defaultTtsSettings,
  getActiveTtsProvider,
  getTtsProviderLabel,
  loadTtsSettings,
  saveTtsSettings,
  type TtsSettings,
} from './features/tts/settings'

const articleLoadResult = shallowRef<ArticlePackageLoadResult>({ status: 'loading' })
const view = shallowRef<'today' | 'reader'>('today')
const preferences = shallowRef<DisplayPreferences>({ ...defaultDisplayPreferences })
const ttsSettings = shallowRef<TtsSettings>({ ...defaultTtsSettings, mimo: { ...defaultTtsSettings.mimo } })
const readExpansionSettings = shallowRef<ReadExpansionSettings>(defaultReadExpansionSettings)
const showTtsSettings = shallowRef(false)
const showReadExpansionSettings = shallowRef(false)
const showAiExpansionConsent = shallowRef(false)
const webSpeechAvailable = shallowRef(false)
const cloudConsentAccepted = shallowRef(false)
const showCloudConsent = shallowRef(false)
const completedSession = shallowRef<PracticeSessionRecord | null>(null)
const startedAt = shallowRef<number | null>(null)
const hasJustCompleted = shallowRef(false)
const visibleTranslationIds = shallowRef<string[]>([])
const selectedToken = shallowRef<ArticleToken | null>(null)
const savedVocabularyIds = shallowRef<string[]>([])
const readExpansionAiStates = shallowRef<Record<string, AiWordExpansionState>>({})
const completionPanel = useTemplateRef<InstanceType<typeof CompletionPanel>>('completionPanel')
let pendingReadAloudAction: (() => void) | null = null
let pendingAiExpansionTerm: ReadExpansionTerm | null = null
const article = computed<DailyArticle | null>(() =>
  articleLoadResult.value.status === 'ready' ? articleLoadResult.value.article : null,
)
const articleStatus = computed(() =>
  articleLoadResult.value.status === 'ready' ? null : articleLoadResult.value,
)
const player = useReadAloudSession(article, createConfiguredSentencePlayer(() => ttsSettings.value))

const activeIndex = computed(() => Math.max(player.currentIndex.value, 0))
const activeTtsProvider = computed(() => getActiveTtsProvider(ttsSettings.value))
const providerLabel = computed(() => getTtsProviderLabel(ttsSettings.value))
const readExpansionTerms = computed(() => article.value ? extractReadExpansionTerms(article.value) : [])
const selectedTokenSentence = computed(() => selectedToken.value && article.value
  ? article.value.sentences.find(sentence =>
      sentence.tokens.some(token => token.id === selectedToken.value?.id),
    ) ?? null
  : null)
const selectedExpansionTerm = computed(() =>
  selectedToken.value
    ? findReadExpansionTermForToken(readExpansionTerms.value, selectedToken.value, {
        context: selectedTokenSentence.value?.original,
        sentenceId: selectedTokenSentence.value?.id,
      })
    : null,
)
const aiExpansionConfigured = computed(() => isAiExpansionConfigured(readExpansionSettings.value))
const aiProviderLabel = computed(() => getAiProviderLabel(readExpansionSettings.value))
const selectedAiExpansionState = computed<AiWordExpansionState>(() =>
  selectedExpansionTerm.value
    ? readExpansionAiStates.value[selectedExpansionTerm.value.id] ?? { status: 'idle' }
    : { status: 'idle' },
)
const canPlayReadAloud = computed(() => {
  if (activeTtsProvider.value === 'mimo') {
    return true
  }

  return webSpeechAvailable.value
})
const readAloudDisabledReason = computed(() => {
  if (!canPlayReadAloud.value) {
    return '这个浏览器不支持 Web Speech 朗读。填入 MiMo key 后可启用神经语音。'
  }

  return null
})

onMounted(() => {
  const storedPreferences = loadDisplayPreferences(window.localStorage)
  preferences.value = storedPreferences
  ttsSettings.value = loadTtsSettings(window.localStorage)
  readExpansionSettings.value = loadReadExpansionSettings(window.localStorage)
  webSpeechAvailable.value = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  savedVocabularyIds.value = loadSavedVocabularyIds(window.localStorage)
  void refreshTodayArticle()
})

watch(article, (nextArticle) => {
  player.stop()
  view.value = 'today'
  visibleTranslationIds.value = []
  selectedToken.value = null
  readExpansionAiStates.value = {}
  showAiExpansionConsent.value = false
  pendingAiExpansionTerm = null
  startedAt.value = null
  hasJustCompleted.value = false
  completedSession.value = nextArticle
    ? loadPracticeSession(window.localStorage, nextArticle.id)
    : null
})

watch(preferences, () => {
  saveDisplayPreferences(window.localStorage, preferences.value)
  if (!preferences.value.showTranslation) {
    visibleTranslationIds.value = []
  }
})

watch(ttsSettings, () => {
  saveTtsSettings(window.localStorage, ttsSettings.value)
  cloudConsentAccepted.value = false
  showCloudConsent.value = false
  pendingReadAloudAction = null
  player.stop()
})

watch(readExpansionSettings, () => {
  saveReadExpansionSettings(window.localStorage, readExpansionSettings.value)
  if (!readExpansionSettings.value.ai.enabled) {
    showAiExpansionConsent.value = false
    pendingAiExpansionTerm = null
  }
})

watch(player.activeSentenceId, (sentenceId) => {
  if (!sentenceId) {
    return
  }

  window.requestAnimationFrame(() => {
    const sentenceElement = document.getElementById(sentenceId)
    if (!sentenceElement) {
      return
    }

    const controlsHeight = document.querySelector<HTMLElement>('.read-aloud-controls')
      ?.getBoundingClientRect().height ?? 0
    const targetY = sentenceElement.getBoundingClientRect().top + window.scrollY - controlsHeight - 48
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  })
})

watch(selectedToken, () => {
  void keepSelectedTokenClearOfStickyControls()
})

function startReading() {
  if (!article.value) {
    return
  }

  view.value = 'reader'
  hasJustCompleted.value = false
  player.stop()
  startedAt.value = Date.now()
}

function pressSentence(sentenceId: string) {
  if (!preferences.value.showTranslation) {
    return
  }

  const currentIds = visibleTranslationIds.value
  visibleTranslationIds.value = currentIds.includes(sentenceId)
    ? currentIds.filter(id => id !== sentenceId)
    : [...currentIds, sentenceId]
}

function selectToken(token: ArticleToken) {
  if (selectedToken.value?.id === token.id) {
    closeTokenPopover()
    return
  }

  selectedToken.value = token
}

function saveToken(token: ArticleToken) {
  const nextIds = [...savedVocabularyIds.value, token.id]
  savedVocabularyIds.value = [...new Set(nextIds)]
  saveSavedVocabularyIds(window.localStorage, savedVocabularyIds.value)
}

function closeTokenPopover() {
  selectedToken.value = null
}

function togglePlayback() {
  if (player.isPlaying.value) {
    player.pause()
    return
  }

  handlePlay()
}

function runReadAloudAction(action: () => void) {
  if (!canPlayReadAloud.value) {
    showTtsSettings.value = true
    return
  }

  if (activeTtsProvider.value === 'mimo' && !cloudConsentAccepted.value) {
    pendingReadAloudAction = action
    showCloudConsent.value = true
    return
  }

  action()
}

function handlePlay() {
  runReadAloudAction(() => player.play())
}

function handlePrevious() {
  runReadAloudAction(() => player.previous())
}

function handleNext() {
  runReadAloudAction(() => player.next())
}

function handleRepeat() {
  runReadAloudAction(() => player.repeat())
}

function acceptCloudReadAloud() {
  const action = pendingReadAloudAction ?? (() => player.play())
  pendingReadAloudAction = null
  cloudConsentAccepted.value = true
  showCloudConsent.value = false
  action()
}

function continueReadOnly() {
  pendingReadAloudAction = null
  showCloudConsent.value = false
}

function useWebSpeechReadAloud() {
  pendingReadAloudAction = null
  ttsSettings.value = {
    ...ttsSettings.value,
    provider: 'webspeech',
  }
}

function requestAiExpansion(term: ReadExpansionTerm) {
  if (!readExpansionSettings.value.ai.enabled || !aiExpansionConfigured.value) {
    showReadExpansionSettings.value = true
    return
  }

  if (!readExpansionSettings.value.ai.consentAccepted) {
    pendingAiExpansionTerm = term
    showAiExpansionConsent.value = true
    return
  }

  void fetchAiExpansion(term)
}

function acceptAiExpansion() {
  readExpansionSettings.value = {
    ...readExpansionSettings.value,
    ai: {
      ...readExpansionSettings.value.ai,
      consentAccepted: true,
    },
  }
  showAiExpansionConsent.value = false
  const term = pendingAiExpansionTerm
  pendingAiExpansionTerm = null
  if (term) {
    void fetchAiExpansion(term)
  }
}

function declineAiExpansion() {
  showAiExpansionConsent.value = false
  pendingAiExpansionTerm = null
}

async function fetchAiExpansion(term: ReadExpansionTerm): Promise<void> {
  const currentState = readExpansionAiStates.value[term.id]
  if (currentState?.status === 'loading' || currentState?.status === 'ready') {
    return
  }

  readExpansionAiStates.value = {
    ...readExpansionAiStates.value,
    [term.id]: { status: 'loading' },
  }

  try {
    const expansion = await requestAiWordExpansion({
      provider: 'openai',
      apiKey: readExpansionSettings.value.ai.openai.apiKey,
      baseUrl: readExpansionSettings.value.ai.openai.baseUrl,
      model: readExpansionSettings.value.ai.openai.model,
      term,
    })
    readExpansionAiStates.value = {
      ...readExpansionAiStates.value,
      [term.id]: { status: 'ready', expansion },
    }
  }
  catch {
    readExpansionAiStates.value = {
      ...readExpansionAiStates.value,
      [term.id]: { status: 'failed', message: 'AI 释义暂时取不到。本地释义仍可使用。' },
    }
  }
}

function completeReading() {
  if (!article.value) {
    return
  }

  const durationSec = startedAt.value
    ? Math.max(1, Math.round((Date.now() - startedAt.value) / 1000))
    : 1
  const session: PracticeSessionRecord = {
    articleId: article.value.id,
    completedAt: new Date().toISOString(),
    durationSec,
  }
  savePracticeSession(window.localStorage, session)
  completedSession.value = session
  hasJustCompleted.value = true
  selectedToken.value = null
  player.stop()
  void focusCompletionPanel()
}

async function focusCompletionPanel(): Promise<void> {
  await nextTick()
  window.requestAnimationFrame(() => {
    completionPanel.value?.focusPanel()
  })
}

async function refreshTodayArticle() {
  articleLoadResult.value = { status: 'loading' }
  articleLoadResult.value = await loadTodayArticlePackage()
}

function openCachedArticle() {
  const cachedArticle = articleLoadResult.value.status !== 'ready' && 'cachedArticle' in articleLoadResult.value
    ? articleLoadResult.value.cachedArticle
    : loadCachedArticlePackage(window.localStorage)

  if (!cachedArticle) {
    return
  }

  articleLoadResult.value = { status: 'ready', article: cachedArticle, source: 'cache' }
}

async function keepSelectedTokenClearOfStickyControls(): Promise<void> {
  if (!selectedToken.value) {
    return
  }

  await nextTick()

  window.requestAnimationFrame(() => {
    const popover = document.querySelector<HTMLElement>('[data-testid="word-popover"]')
    const selectedWord = document.querySelector<HTMLElement>('.sentence-text__token--selected')
    const controls = document.querySelector<HTMLElement>('.read-aloud-controls')
    const toolbar = document.querySelector<HTMLElement>('.app-shell__toolbar')

    if (!popover || !selectedWord || !controls) {
      return
    }

    const gap = 16
    const popoverRect = popover.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    const selectedWordRect = selectedWord.getBoundingClientRect()
    const safeTop = (toolbar?.getBoundingClientRect().bottom ?? 0) + gap
    const safeBottom = controlsRect.top - gap

    const minScrollDelta = popoverRect.bottom - safeBottom
    const maxScrollDelta = selectedWordRect.top - safeTop
    let scrollDelta = 0

    if (minScrollDelta <= maxScrollDelta) {
      if (minScrollDelta > 0) {
        scrollDelta = minScrollDelta
      }
      else if (maxScrollDelta < 0) {
        scrollDelta = maxScrollDelta
      }
    }
    else {
      scrollDelta = minScrollDelta > 0 ? minScrollDelta : maxScrollDelta
    }

    if (Math.abs(scrollDelta) > 1) {
      window.scrollBy({
        top: scrollDelta,
        behavior: 'auto',
      })
    }
  })
}
</script>

<template>
  <main class="app-shell">
    <TodayCard
      v-if="view === 'today' && articleLoadResult.status === 'ready'"
      :article="articleLoadResult.article"
      :completed="Boolean(completedSession)"
      :source="articleLoadResult.source"
      @start="startReading"
    />
    <ArticleStatusCard
      v-else-if="view === 'today' && articleStatus"
      :state="articleStatus"
      @retry="refreshTodayArticle"
      @open-cached="openCachedArticle"
    />

    <template v-else-if="article">
      <div class="app-shell__toolbar" aria-label="Reading settings">
        <button class="app-shell__back" type="button" @click="view = 'today'">
          Today
        </button>
        <AssistiveDisplayControls v-model="preferences" />
      </div>
      <TtsSettingsPanel
        v-if="showTtsSettings"
        v-model="ttsSettings"
      />
      <ReadExpansionSettingsPanel
        v-if="showReadExpansionSettings"
        v-model="readExpansionSettings"
      />
      <ReadExpansionConsent
        v-if="showAiExpansionConsent && !hasJustCompleted"
        :provider-label="aiProviderLabel"
        @accept="acceptAiExpansion"
        @decline="declineAiExpansion"
      />

      <ArticleReader
        :article="article"
        :active-sentence-id="player.activeSentenceId.value"
        :preferences="preferences"
        :visible-translation-ids="visibleTranslationIds"
        :selected-token-id="selectedToken?.id ?? null"
        :selected-token="selectedToken"
        :is-selected-token-saved="selectedToken ? savedVocabularyIds.includes(selectedToken.id) : false"
        :selected-expansion-term="selectedExpansionTerm"
        :ai-state-for-selected-term="selectedAiExpansionState"
        :ai-enabled="readExpansionSettings.ai.enabled"
        :ai-configured="aiExpansionConfigured"
        :provider-label="aiProviderLabel"
        @press-sentence="pressSentence"
        @select-token="selectToken"
        @save-token="saveToken"
        @close-token-popover="closeTokenPopover"
        @request-ai-expansion="requestAiExpansion"
        @open-expansion-settings="showReadExpansionSettings = true"
        @toggle-playback="togglePlayback"
        @complete="completeReading"
      />

      <ReadAloudControls
        v-if="!hasJustCompleted"
        :active-index="activeIndex"
        :total="article.sentences.length"
        :is-playing="player.isPlaying.value"
        :audio-status="player.audioStatus.value"
        :active-provider="activeTtsProvider"
        :playback-rate="player.playbackRate.value"
        :provider-label="providerLabel"
        :can-play="canPlayReadAloud"
        :disabled-reason="readAloudDisabledReason"
        :show-cloud-consent="showCloudConsent"
        @play="handlePlay"
        @pause="player.pause()"
        @previous="handlePrevious"
        @next="handleNext"
        @repeat="handleRepeat"
        @skip-audio="handleNext"
        @retry-audio="handleRepeat"
        @open-settings="showTtsSettings = !showTtsSettings"
        @accept-cloud-read-aloud="acceptCloudReadAloud"
        @continue-read-only="continueReadOnly"
        @use-web-speech="useWebSpeechReadAloud"
        @set-rate="player.setPlaybackRate($event)"
      />

      <CompletionPanel
        ref="completionPanel"
        v-model:read-expansion-settings="readExpansionSettings"
        :article="article"
        :session="hasJustCompleted ? completedSession : null"
        :read-expansion-terms="readExpansionTerms"
        :read-expansion-ai-states="readExpansionAiStates"
        :ai-configured="aiExpansionConfigured"
        :ai-provider-label="aiProviderLabel"
        :show-ai-consent-prompt="showAiExpansionConsent"
        @request-ai-expansion="requestAiExpansion"
        @accept-ai-expansion="acceptAiExpansion"
        @decline-ai-expansion="declineAiExpansion"
      />
    </template>
  </main>
</template>
