<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, watch } from 'vue'

import ArticleStatusCard from './components/ArticleStatusCard.vue'
import ArticleReader from './components/ArticleReader.vue'
import AssistiveDisplayControls from './components/AssistiveDisplayControls.vue'
import CompletionPanel from './components/CompletionPanel.vue'
import ReadAloudControls from './components/ReadAloudControls.vue'
import TodayCard from './components/TodayCard.vue'
import {
  loadCachedArticlePackage,
  loadTodayArticlePackage,
  type ArticlePackageLoadResult,
} from './features/article/articlePackageLoader'
import type { ArticleToken, DailyArticle } from './features/article/types'
import type { DisplayPreferences } from './features/preferences/types'
import { defaultDisplayPreferences } from './features/preferences/types'
import { useReadAloudSession } from './features/player/useReadAloudSession'
import {
  loadDisplayPreferences,
  loadPracticeSession,
  loadSavedVocabularyIds,
  saveDisplayPreferences,
  savePracticeSession,
  saveSavedVocabularyIds,
  type PracticeSessionRecord,
} from './features/storage/practiceStorage'

const articleLoadResult = shallowRef<ArticlePackageLoadResult>({ status: 'loading' })
const view = shallowRef<'today' | 'reader'>('today')
const preferences = shallowRef<DisplayPreferences>({ ...defaultDisplayPreferences })
const completedSession = shallowRef<PracticeSessionRecord | null>(null)
const startedAt = shallowRef<number | null>(null)
const revealedTranslationIds = shallowRef<string[]>([])
const selectedToken = shallowRef<ArticleToken | null>(null)
const savedVocabularyIds = shallowRef<string[]>([])
const article = computed<DailyArticle | null>(() =>
  articleLoadResult.value.status === 'ready' ? articleLoadResult.value.article : null,
)
const articleStatus = computed(() =>
  articleLoadResult.value.status === 'ready' ? null : articleLoadResult.value,
)
const player = useReadAloudSession(article)

const activeIndex = computed(() => Math.max(player.currentIndex.value, 0))

onMounted(() => {
  const storedPreferences = loadDisplayPreferences(window.localStorage)
  preferences.value = storedPreferences
  savedVocabularyIds.value = loadSavedVocabularyIds(window.localStorage)
  void refreshTodayArticle()
})

watch(article, (nextArticle) => {
  player.stop()
  view.value = 'today'
  revealedTranslationIds.value = []
  selectedToken.value = null
  startedAt.value = null
  completedSession.value = nextArticle
    ? loadPracticeSession(window.localStorage, nextArticle.id)
    : null
})

watch(preferences, () => {
  saveDisplayPreferences(window.localStorage, preferences.value)
  if (!preferences.value.showTranslation) {
    revealedTranslationIds.value = []
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
  startedAt.value = Date.now()
}

function pressSentence(sentenceId: string) {
  if (!preferences.value.showTranslation) {
    return
  }

  const currentIds = revealedTranslationIds.value
  revealedTranslationIds.value = currentIds.includes(sentenceId)
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

  player.play()
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

      <ArticleReader
        :article="article"
        :active-sentence-id="player.activeSentenceId.value"
        :preferences="preferences"
        :revealed-translation-ids="revealedTranslationIds"
        :selected-token-id="selectedToken?.id ?? null"
        :selected-token="selectedToken"
        :is-selected-token-saved="selectedToken ? savedVocabularyIds.includes(selectedToken.id) : false"
        @press-sentence="pressSentence"
        @select-token="selectToken"
        @save-token="saveToken"
        @close-token-popover="closeTokenPopover"
        @toggle-playback="togglePlayback"
        @complete="completeReading"
      />

      <ReadAloudControls
        :active-index="activeIndex"
        :total="article.sentences.length"
        :is-playing="player.isPlaying.value"
        :audio-status="player.audioStatus.value"
        :playback-rate="player.playbackRate.value"
        @play="player.play()"
        @pause="player.pause()"
        @previous="player.previous()"
        @next="player.next()"
        @repeat="player.repeat()"
        @skip-audio="player.next()"
        @retry-audio="player.repeat()"
        @set-rate="player.setPlaybackRate($event)"
      />

      <CompletionPanel :article="article" :session="completedSession" />
    </template>
  </main>
</template>
