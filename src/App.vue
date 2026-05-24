<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'

import ArticleReader from './components/ArticleReader.vue'
import AssistiveDisplayControls from './components/AssistiveDisplayControls.vue'
import CompletionPanel from './components/CompletionPanel.vue'
import ReadAloudControls from './components/ReadAloudControls.vue'
import TodayCard from './components/TodayCard.vue'
import WordPopover from './components/WordPopover.vue'
import { sampleArticle } from './features/article/sampleArticle'
import type { ArticleToken } from './features/article/types'
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

const article = shallowRef(sampleArticle)
const view = shallowRef<'today' | 'reader'>('today')
const preferences = shallowRef<DisplayPreferences>({ ...defaultDisplayPreferences })
const completedSession = shallowRef<PracticeSessionRecord | null>(null)
const startedAt = shallowRef<number | null>(null)
const revealedTranslationIds = shallowRef<string[]>([])
const selectedToken = shallowRef<ArticleToken | null>(null)
const savedVocabularyIds = shallowRef<string[]>([])
const player = useReadAloudSession(article)

const activeIndex = computed(() => Math.max(player.currentIndex.value, 0))

onMounted(() => {
  const storedPreferences = loadDisplayPreferences(window.localStorage)
  preferences.value = storedPreferences
  completedSession.value = loadPracticeSession(window.localStorage, article.value.id)
  savedVocabularyIds.value = loadSavedVocabularyIds(window.localStorage)
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

function startReading() {
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
</script>

<template>
  <main class="app-shell">
    <TodayCard
      v-if="view === 'today'"
      :article="article"
      :completed="Boolean(completedSession)"
      @start="startReading"
    />

    <template v-else>
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
        @press-sentence="pressSentence"
        @select-token="selectToken"
        @toggle-playback="togglePlayback"
        @complete="completeReading"
      />

      <WordPopover
        :token="selectedToken"
        :saved="selectedToken ? savedVocabularyIds.includes(selectedToken.id) : false"
        @save="saveToken"
        @close="closeTokenPopover"
      />

      <ReadAloudControls
        :active-index="activeIndex"
        :total="article.sentences.length"
        :is-playing="player.isPlaying.value"
        :playback-rate="player.playbackRate.value"
        @play="player.play()"
        @pause="player.pause()"
        @previous="player.previous()"
        @next="player.next()"
        @repeat="player.repeat()"
        @set-rate="player.setPlaybackRate($event)"
      />

      <CompletionPanel :article="article" :session="completedSession" />
    </template>
  </main>
</template>
