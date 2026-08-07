<script setup lang="ts">
import { PhArrowLeft } from '@phosphor-icons/vue'
import { computed, onUnmounted } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRouter } from 'vue-router'

import ReaderArticle from '@/components/reader/ReaderArticle.vue'
import ReaderPlaybackControls from '@/components/reader/ReaderPlaybackControls.vue'
import { requestLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { useReadingSession } from '@/features/reader/useReadingSession'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const props = defineProps<{
  articleId: string
}>()

const router = useRouter()
const pendingRouteTransitions: Array<{
  token: number
  from: string
  to: string
}> = []
const currentArticleId = computed(() => props.articleId)
const {
  status,
  article,
  orderedSentences,
  currentSentenceId,
  currentSentenceIndex,
  progress,
  playingSentenceId,
  isPlaying,
  errorMessage,
  speechAvailable,
  load,
  selectSentence,
  previousSentence,
  nextSentence,
  togglePlayback,
  beginRouteTransition,
  resumeAfterFailedRouteTransition,
} = useReadingSession(currentArticleId)

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
  removeAfterEach()
  removeNavigationError()
})

onBeforeRouteLeave(async (to, from) => {
  const transition = beginRouteTransition()
  pendingRouteTransitions.push({
    token: transition.token,
    from: from.fullPath,
    to: to.fullPath,
  })
  await transition.ready
  return true
})

usePageHeadingFocus()

function handleTogglePlayback(): void {
  void togglePlayback()
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
      <div class="reader-view__progress-wrap">
        <progress
          class="reader-view__progress"
          :value="progress"
          max="100"
          :aria-label="`文章进度 ${progress}%`"
        />
        <span>{{ progress }}%</span>
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
          :playing-sentence-id="playingSentenceId"
          @select-sentence="selectSentence"
        />
      </template>
    </main>

    <footer v-if="status === 'ready'" class="reader-view__footer">
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
    grid-template-columns: 2.75rem minmax(0, 1fr) minmax(4rem, auto);
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
