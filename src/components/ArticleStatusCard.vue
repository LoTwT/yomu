<script setup lang="ts">
import { computed } from 'vue'

import type { ArticlePackageLoadResult } from '@/features/article/articlePackageLoader'

const props = defineProps<{
  state: Exclude<ArticlePackageLoadResult, { status: 'ready' }>
}>()

const emit = defineEmits<{
  retry: []
  openCached: []
}>()

const cachedArticle = computed(() => 'cachedArticle' in props.state ? props.state.cachedArticle : null)
const canOpenCached = computed(() => Boolean(cachedArticle.value))

const copy = computed(() => {
  switch (props.state.status) {
    case 'loading':
      return {
        eyebrow: 'Today',
        title: "Bringing in today's reading...",
        deck: 'Preparing the page, lead voice, translation, and IPA support.',
      }
    case 'not-ready':
      return {
        eyebrow: 'Today',
        title: "Today's piece is still being prepared.",
        deck: "It'll be ready shortly. In the meantime, you can revisit a past reading.",
      }
    case 'offline':
      return {
        eyebrow: 'Offline',
        title: "You're offline, and today's piece isn't saved yet.",
        deck: "Reconnect to load it, or open a reading you've saved.",
      }
    case 'error':
      return {
        eyebrow: 'Today',
        title: "Today's reading didn't load.",
        deck: props.state.message,
      }
  }
})
</script>

<template>
  <section class="article-status-card" aria-labelledby="article-status-title">
    <p class="article-status-card__eyebrow">
      {{ copy.eyebrow }}
    </p>
    <h1 id="article-status-title" class="article-status-card__title">
      {{ copy.title }}
    </h1>
    <p class="article-status-card__deck">
      {{ copy.deck }}
    </p>
    <div v-if="state.status !== 'loading'" class="article-status-card__actions">
      <button
        v-if="canOpenCached"
        class="article-status-card__button article-status-card__button--primary"
        type="button"
        @click="emit('openCached')"
      >
        {{ state.status === 'offline' ? 'Read a saved piece' : 'Read a past piece' }}
      </button>
      <button class="article-status-card__button" type="button" @click="emit('retry')">
        Try again
      </button>
    </div>
  </section>
</template>

<style scoped>
.article-status-card {
  max-inline-size: min(100%, 42rem);
  margin-inline: auto;
  padding: clamp(3rem, 9vw, 6rem) 1.25rem;
}

.article-status-card__eyebrow {
  margin: 0 0 0.75rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
}

.article-status-card__title {
  margin: 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: clamp(2.5rem, 8vw, 4.4rem);
  line-height: 1;
}

.article-status-card__deck {
  max-inline-size: 35rem;
  margin: 1rem 0 0;
  color: var(--yomu-ink-soft);
  font-size: 1.05rem;
  line-height: 1.7;
}

.article-status-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block-start: 1.5rem;
}

.article-status-card__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 1rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.article-status-card__button--primary {
  border-color: transparent;
  background: var(--yomu-accent);
  color: var(--yomu-paper);
  font-weight: 650;
}

.article-status-card__button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
