<script setup lang="ts">
import { PhCaretRight, PhFileText } from '@phosphor-icons/vue'

import type { LibraryRecommendation } from './libraryRecommendations'

withDefaults(defineProps<{
  article: LibraryRecommendation
  busy?: boolean
  sessionOnly?: boolean
}>(), {
  busy: false,
  sessionOnly: false,
})

const emit = defineEmits<{
  startSample: [focusReturn: HTMLButtonElement]
}>()

function handleStartSample(event: MouseEvent): void {
  const focusReturn = event.currentTarget
  if (focusReturn instanceof HTMLButtonElement) {
    emit('startSample', focusReturn)
  }
}
</script>

<template>
  <article class="recommendation-card">
    <div class="recommendation-card__icon" aria-hidden="true">
      <PhFileText :size="24" />
    </div>
    <div class="recommendation-card__copy">
      <h3 class="recommendation-card__title" lang="en">
        {{ article.title }}
      </h3>
      <p class="recommendation-card__summary" lang="en">
        {{ article.summary }}
      </p>
      <p v-if="sessionOnly" class="recommendation-card__session-note">
        样例和相关进度仅在本次使用期间保留，刷新或关闭后可能丢失。
      </p>
    </div>
    <p class="recommendation-card__meta">
      {{ article.sourceLabel }} · {{ article.levelLabel }} · {{ article.estimatedMinutes }} 分钟
    </p>
    <button
      class="recommendation-card__action"
      data-sample-start
      type="button"
      :disabled="busy"
      :aria-busy="busy"
      @click="handleStartSample"
    >
      {{ busy ? '正在加入…' : '加入并阅读' }}
      <PhCaretRight aria-hidden="true" :size="18" />
    </button>
  </article>
</template>

<style scoped>
.recommendation-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
}

.recommendation-card__icon {
  display: grid;
  grid-row: 1 / 3;
  place-items: center;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  border-radius: var(--radius-control);
  background: var(--accent-soft);
  color: var(--text-accent);
}

.recommendation-card__copy {
  grid-column: 2;
  min-inline-size: 0;
}

.recommendation-card__title,
.recommendation-card__summary,
.recommendation-card__session-note,
.recommendation-card__meta {
  grid-column: 2;
  margin: 0;
}

.recommendation-card__title {
  font-family: var(--font-reading);
  font-size: 1.05rem;
  overflow-wrap: anywhere;
}

.recommendation-card__summary,
.recommendation-card__session-note,
.recommendation-card__meta {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.recommendation-card__summary {
  margin-block-start: 0.25rem;
  overflow-wrap: anywhere;
}

.recommendation-card__session-note {
  margin-block-start: 0.35rem;
  color: var(--status-warning-fg);
}

.recommendation-card__action {
  display: inline-flex;
  grid-column: 3;
  grid-row: 1 / 3;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 0;
  border-radius: 0.45rem;
  padding-inline: 0.8rem;
  background: transparent;
  color: var(--text-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.recommendation-card__action:disabled {
  cursor: wait;
  opacity: 0.65;
}

.recommendation-card__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.recommendation-card:has(.recommendation-card__action:active) {
  background: var(--accent-soft);
}

@media (hover: hover) {
  .recommendation-card:has(.recommendation-card__action:hover:not(:disabled)) {
    background: var(--accent-soft);
  }
}

@media (min-width: 768px) {
  .recommendation-card {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: 0.25rem 1.5rem;
  }

  .recommendation-card__copy {
    grid-column: 2;
  }

  .recommendation-card__meta {
    grid-column: 3;
    grid-row: 1 / 3;
  }

  .recommendation-card__action {
    grid-column: 4;
  }
}
</style>
