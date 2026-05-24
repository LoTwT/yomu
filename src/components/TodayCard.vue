<script setup lang="ts">
import type { DailyArticle } from '@/features/article/types'

defineProps<{
  article: DailyArticle
  completed: boolean
  source: 'network' | 'cache'
}>()

const emit = defineEmits<{
  start: []
}>()
</script>

<template>
  <section class="today-card" aria-labelledby="today-title">
    <p class="today-card__eyebrow">Today · {{ article.level }} · {{ article.estimatedReadTimeMinutes }} min</p>
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
    </div>
    <button class="today-card__button" type="button" @click="emit('start')">
      {{ completed ? 'Read it again' : 'Start reading' }}
    </button>
    <p v-if="completed" class="today-card__complete" role="status">
      You've finished today's reading.
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
