<script setup lang="ts">
import { computed } from 'vue'

import type { DailyArticle } from '@/features/article/types'

const props = defineProps<{
  article: DailyArticle
  completed: boolean
  source: 'network' | 'cache' | 'public-domain'
}>()

const emit = defineEmits<{
  start: []
}>()

const levelLabel = computed(() =>
  props.article.publicDomainMetadata?.difficulty.label ?? props.article.level,
)
const publicDomainMetadata = computed(() => props.article.publicDomainMetadata)
</script>

<template>
  <section class="today-card" aria-labelledby="today-title">
    <p class="today-card__eyebrow">Today · {{ levelLabel }} · {{ article.estimatedReadTimeMinutes }} min</p>
    <h1 id="today-title" class="today-card__title">
      {{ article.title }}
    </h1>
    <p class="today-card__deck">
      {{ article.deck }}
    </p>
    <div class="today-card__meta" aria-label="Article metadata">
      <span>{{ article.topic === 'knowledge' ? 'Knowledge' : 'Story' }}</span>
      <span>{{ article.language.toUpperCase() }}</span>
      <span>{{ article.sentences.length }} sentences</span>
      <span v-if="source === 'cache'">Offline · saved for you</span>
      <span v-if="source === 'public-domain'">Public-domain fallback</span>
    </div>
    <div v-if="publicDomainMetadata" class="today-card__rights">
      <p>
        来源:
        <a
          :href="publicDomainMetadata.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          >
            {{ publicDomainMetadata.sourceName }}
            <span aria-hidden="true">↗</span>
            <span class="today-card__sr-only">在新窗口打开</span>
          </a>
          · {{ publicDomainMetadata.author }} · {{ publicDomainMetadata.publicationYear }}
      </p>
      <p>{{ publicDomainMetadata.sourceLabel }}</p>
    </div>
    <button class="today-card__button" type="button" @click="emit('start')">
      {{ completed ? 'Read it again' : 'Start reading' }}
    </button>
    <p v-if="completed" class="today-card__complete" role="status">
      You've finished today's reading ✓
    </p>
  </section>
</template>

<style scoped>
.today-card {
  max-inline-size: min(100%, 42rem);
  margin-inline: auto;
  padding: clamp(3rem, 9vw, 6rem) 1.25rem;
}

.today-card__eyebrow,
.today-card__complete {
  margin: 0 0 0.75rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
}

.today-card__title {
  margin: 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: clamp(2.75rem, 8vw, 5rem);
  line-height: 0.95;
}

.today-card__deck {
  max-inline-size: 35rem;
  margin: 1rem 0 0;
  color: var(--yomu-ink-soft);
  font-size: 1.125rem;
  line-height: 1.7;
}

.today-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 1.25rem 1.5rem;
}

.today-card__meta span {
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
}

.today-card__rights {
  max-inline-size: 34rem;
  margin-block: -0.5rem 1.25rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}

.today-card__rights p {
  margin: 0.2rem 0 0;
}

.today-card__rights a {
  color: var(--yomu-accent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.today-card__sr-only {
  position: absolute;
  overflow: hidden;
  inline-size: 1px;
  block-size: 1px;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.today-card__button {
  min-block-size: 2.75rem;
  border: 0;
  border-radius: 999px;
  padding-inline: 1.2rem;
  background: var(--yomu-accent);
  color: var(--yomu-paper);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.today-card__button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
