<script setup lang="ts">
import { PhArrowRight, PhCalendarBlank } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'

import type { LibraryArticleViewModel } from '@/features/library/libraryViewModel'

defineProps<{
  article: LibraryArticleViewModel
}>()
</script>

<template>
  <article class="continue-card">
    <div class="continue-card__content">
      <h3 class="continue-card__title" lang="en">
        {{ article.title }}
      </h3>
      <p class="continue-card__meta">
        {{ article.sourceLabel }} · {{ article.levelLabel }} · {{ article.estimatedMinutes }} 分钟
      </p>
      <p v-if="article.summary" class="continue-card__summary" lang="en">
        {{ article.summary }}
      </p>
    </div>

    <div class="continue-card__action">
      <span class="continue-card__percent">{{ article.progress }}%</span>
      <progress
        class="continue-card__progress"
        :value="article.progress"
        max="100"
        :aria-label="`${article.title} 阅读进度 ${article.progress}%`"
      />
      <RouterLink
        class="continue-card__button"
        :to="{ name: 'reader', params: { articleId: article.id } }"
      >
        继续阅读
        <PhArrowRight aria-hidden="true" :size="21" />
      </RouterLink>
    </div>

    <p class="continue-card__device">
      <PhCalendarBlank aria-hidden="true" :size="17" />
      {{ article.currentSentenceLabel ?? article.status }} · 存储在此设备
    </p>
  </article>
</template>

<style scoped>
.continue-card {
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
}

.continue-card__content,
.continue-card__action {
  min-inline-size: 0;
}

.continue-card__title {
  margin: 0;
  font-family: var(--font-reading);
  font-size: clamp(1.65rem, 7vw, 1.9rem);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
}

.continue-card__meta,
.continue-card__device,
.continue-card__percent {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.continue-card__meta {
  margin: 0.75rem 0 0;
}

.continue-card__summary {
  display: none;
  max-inline-size: 42rem;
  margin: 1rem 0 0;
  font-family: var(--font-reading);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.continue-card__device {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
}

.continue-card__action {
  display: grid;
  align-content: end;
  gap: 0.75rem;
}

.continue-card__percent {
  font-variant-numeric: tabular-nums;
}

.continue-card__progress {
  overflow: hidden;
  inline-size: 100%;
  block-size: 0.25rem;
  border: 0;
  border-radius: var(--radius-full);
  appearance: none;
  background: var(--surface-muted);
  color: var(--accent-primary-active);
}

.continue-card__progress::-webkit-progress-bar {
  border-radius: inherit;
  background: var(--surface-muted);
}

.continue-card__progress::-webkit-progress-value {
  border-radius: inherit;
  background: var(--accent-primary-active);
}

.continue-card__progress::-moz-progress-bar {
  border-radius: inherit;
  background: var(--accent-primary-active);
}

.continue-card__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-block-size: 3rem;
  border-radius: 0.45rem;
  padding-inline: 1.25rem;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
  font-weight: 700;
  text-decoration: none;
}

.continue-card__button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.continue-card__button:active {
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
}

@media (hover: hover) {
  .continue-card__button:hover {
    background: var(--accent-primary-active);
    color: var(--accent-contrast-active);
  }
}

@media (min-width: 768px) {
  .continue-card {
    gap: 1rem;
    padding: 1.5rem;
  }

  .continue-card__title {
    font-size: 2rem;
  }

}

@media (min-width: 1200px) {
  .continue-card {
    grid-template-columns: minmax(0, 2fr) minmax(14rem, 0.9fr);
    grid-template-rows: auto auto;
    align-items: stretch;
    padding: 1.5rem;
  }

  .continue-card__title {
    font-size: 2.5rem;
  }

  .continue-card__summary {
    display: block;
  }

  .continue-card__content {
    grid-column: 1;
    grid-row: 1;
  }

  .continue-card__action {
    grid-column: 2;
    grid-row: 1 / 3;
  }

  .continue-card__device {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>
