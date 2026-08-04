<script setup lang="ts">
import { PhCaretRight, PhFileText } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'

import type { LibraryArticle } from './libraryFixtures'

defineProps<{
  article: LibraryArticle
}>()
</script>

<template>
  <li class="article-object" :data-article-id="article.id">
    <article class="article-object__inner">
      <PhFileText class="article-object__document" aria-hidden="true" :size="27" />
      <div class="article-object__heading">
        <h3 class="article-object__title">
          <RouterLink
            class="article-object__link"
            :to="{
              name: article.availability === 'legacy-today'
                ? 'legacy-reader'
                : 'article-unavailable',
              params: { articleId: article.id },
            }"
            :aria-label="article.availability === 'unavailable'
              ? `${article.title}，尚未接入`
              : undefined"
            :title="article.availability === 'unavailable' ? '尚未接入' : undefined"
          >
            <span lang="en">{{ article.title }}</span>
            <PhCaretRight class="article-object__caret" aria-hidden="true" :size="16" />
          </RouterLink>
        </h3>
        <span class="article-object__level">{{ article.level }}</span>
      </div>

      <p v-if="article.summary" class="article-object__summary" lang="en">
        {{ article.summary }}
      </p>

      <p class="article-object__meta">
        <span lang="en">{{ article.source }}</span> · {{ article.level }} · {{ article.estimatedMinutes }} 分钟
      </p>

      <div class="article-object__progress-wrap">
        <progress
          class="article-object__progress"
          :value="article.progress"
          max="100"
          :aria-label="`${article.title} 阅读进度 ${article.progress}%`"
        />
        <span>{{ article.progress }}%</span>
      </div>

      <p class="article-object__activity">
        {{ article.lastOpened }}
      </p>
    </article>
  </li>
</template>

<style scoped>
.article-object {
  min-inline-size: 0;
  list-style: none;
}

.article-object__inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 0.75rem;
  border-block-end: 1px solid var(--border-subtle);
  padding-block: 0.65rem;
}

.article-object__document {
  display: none;
}

.article-object__heading {
  display: flex;
  grid-column: 1 / -1;
  gap: 0.75rem;
  align-items: start;
  justify-content: space-between;
  min-inline-size: 0;
}

.article-object__title {
  margin: 0;
  min-inline-size: 0;
  font-family: var(--font-reading);
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.article-object__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  inline-size: 100%;
  min-block-size: 2.75rem;
  color: var(--text-primary);
  text-decoration: none;
}

.article-object__link::after {
  position: absolute;
  inset: 0;
  content: '';
}

.article-object__caret {
  flex: none;
  color: var(--text-secondary);
}

.article-object__link:focus-visible {
  border-radius: 0.2rem;
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.article-object__level {
  display: none;
  flex: none;
  border-radius: 0.25rem;
  padding: 0.2rem 0.35rem;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.article-object__summary {
  display: none;
  margin: 0;
  font-family: var(--font-reading);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.article-object__meta,
.article-object__activity {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.article-object__meta {
  grid-column: 1;
  grid-row: 2;
  min-inline-size: 0;
}

.article-object__activity {
  grid-column: 2;
  grid-row: 2;
  text-align: end;
}

.article-object__progress-wrap {
  display: flex;
  grid-column: 1 / -1;
  grid-row: 3;
  align-items: center;
  gap: 0.65rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.article-object__progress {
  overflow: hidden;
  flex: 1;
  min-inline-size: 0;
  block-size: 0.25rem;
  border: 0;
  border-radius: var(--radius-full);
  appearance: none;
  background: var(--surface-muted);
  color: var(--accent-primary-active);
}

.article-object__inner:has(.article-object__link:active) {
  background: var(--accent-soft);
}

@media (hover: hover) {
  .article-object__inner:has(.article-object__link:hover) {
    background: var(--accent-soft);
  }
}

.article-object__progress::-webkit-progress-bar {
  border-radius: inherit;
  background: var(--surface-muted);
}

.article-object__progress::-webkit-progress-value {
  border-radius: inherit;
  background: var(--accent-primary-active);
}

.article-object__progress::-moz-progress-bar {
  border-radius: inherit;
  background: var(--accent-primary-active);
}

@media (min-width: 768px) and (max-width: 1199px) {
  .article-object__inner {
    grid-template-columns: 2.25rem minmax(0, 1fr) 8rem 7rem;
    align-items: center;
    min-block-size: 5.75rem;
    gap: 0.4rem 1.25rem;
    padding-block: 0.85rem;
  }

  .article-object__document {
    display: block;
    grid-column: 1;
    grid-row: 1 / 3;
    color: var(--text-secondary);
  }

  .article-object__heading,
  .article-object__meta {
    grid-column: 2;
  }

  .article-object__heading {
    grid-row: 1;
  }

  .article-object__meta {
    grid-row: 2;
  }

  .article-object__activity {
    grid-column: 3;
    grid-row: 1 / 3;
    text-align: start;
  }

  .article-object__progress-wrap {
    grid-column: 4;
    grid-row: 1 / 3;
  }
}

@media (min-width: 1200px) {
  .article-object__caret {
    position: absolute;
    inset-inline-end: 1.25rem;
    inset-block-end: 1.15rem;
    display: block;
  }

  .article-object__level {
    display: inline-flex;
  }

  .article-object__inner {
    grid-template-rows: auto minmax(3rem, auto) auto auto;
    min-block-size: 10.75rem;
    border: 1px solid var(--border-subtle);
    border-radius: 0.75rem;
    padding: 1.25rem;
    background: var(--surface-elevated);
  }

  .article-object__heading {
    grid-row: 1;
  }

  .article-object__summary {
    display: -webkit-box;
    grid-column: 1 / -1;
    grid-row: 2;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .article-object__progress-wrap {
    grid-column: 1 / -1;
    grid-row: 3;
  }

  .article-object__meta {
    grid-column: 1;
    grid-row: 4;
  }

  .article-object__activity {
    grid-column: 2;
    grid-row: 4;
    padding-inline-end: 1.5rem;
  }
}
</style>
