<script setup lang="ts">
import { PhCaretRight, PhFileText } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'

import type { LibraryArticle } from './libraryFixtures'

defineProps<{
  article: LibraryArticle
}>()
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
    </div>
    <p class="recommendation-card__meta">
      {{ article.level }} · {{ article.estimatedMinutes }} 分钟 · {{ article.progress }}%
    </p>
    <RouterLink
      class="recommendation-card__link"
      :to="{
        name: article.availability === 'legacy-today'
          ? 'legacy-reader'
          : 'article-unavailable',
        params: { articleId: article.id },
      }"
      :aria-label="article.availability === 'unavailable'
        ? `${article.title}，尚未接入`
        : `加入并阅读 ${article.title}`"
      :title="article.availability === 'unavailable' ? '尚未接入' : undefined"
    >
      <PhCaretRight aria-hidden="true" :size="18" />
    </RouterLink>
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
.recommendation-card__meta {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.recommendation-card__summary {
  margin-block-start: 0.25rem;
  overflow-wrap: anywhere;
}

.recommendation-card__link {
  display: inline-flex;
  grid-column: 3;
  grid-row: 1 / 3;
  align-items: center;
  justify-content: center;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border-radius: 0.45rem;
  padding-inline: 0.8rem;
  color: var(--text-accent);
  font-weight: 700;
  text-decoration: none;
}

.recommendation-card__link:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.recommendation-card:has(.recommendation-card__link:active) {
  background: var(--accent-soft);
}

@media (hover: hover) {
  .recommendation-card:has(.recommendation-card__link:hover) {
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

  .recommendation-card__link {
    grid-column: 4;
  }
}
</style>
