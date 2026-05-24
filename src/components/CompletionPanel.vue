<script setup lang="ts">
import { computed } from 'vue'

import type { DailyArticle } from '@/features/article/types'
import type { PracticeSessionRecord } from '@/features/storage/practiceStorage'

const props = defineProps<{
  article: DailyArticle
  session: PracticeSessionRecord | null
}>()

const vocabulary = computed(() => props.article.sentences.flatMap(sentence => sentence.vocab ?? []))
const factSources = computed(() => props.article.factSources)
</script>

<template>
  <section v-if="session" class="completion-panel" aria-labelledby="completion-title">
    <p class="completion-panel__eyebrow">
      Completed
    </p>
    <h2 id="completion-title" class="completion-panel__title">
      Today's page is done.
    </h2>
    <p class="completion-panel__copy">
      You finished {{ article.title }} in this local practice record.
    </p>
    <section v-if="vocabulary.length" class="completion-panel__section" aria-labelledby="vocab-title">
      <h3 id="vocab-title" class="completion-panel__section-title">
        Words to keep
      </h3>
      <ul class="completion-panel__list">
        <li v-for="item in vocabulary" :key="item.term">
          <strong>{{ item.term }}</strong> — {{ item.meaning }}
        </li>
      </ul>
    </section>
    <section v-if="factSources.length" class="completion-panel__section" aria-labelledby="source-title">
      <h3 id="source-title" class="completion-panel__section-title">
        Background / source
      </h3>
      <ul class="completion-panel__list">
        <li v-for="source in factSources" :key="source.url">
          <a :href="source.url" target="_blank" rel="noopener noreferrer">
            {{ source.title }}
          </a>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.completion-panel {
  max-inline-size: min(100%, 42rem);
  border-block-start: 1px solid var(--yomu-rule);
  margin: 0 auto 5rem;
  padding: 2rem 1.25rem 0;
}

.completion-panel__eyebrow,
.completion-panel__copy {
  color: var(--yomu-muted);
}

.completion-panel__eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
}

.completion-panel__title {
  margin: 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: clamp(2rem, 5vw, 3rem);
}

.completion-panel__copy {
  margin-block: 0.75rem 1rem;
  line-height: 1.7;
}

.completion-panel__section {
  margin-block-start: 1.15rem;
}

.completion-panel__section-title {
  margin: 0 0 0.5rem;
  color: var(--yomu-ink);
  font-size: 1rem;
}

.completion-panel__list {
  margin: 0;
  padding-inline-start: 1.15rem;
  color: var(--yomu-ink-soft);
  line-height: 1.7;
}

.completion-panel__list a {
  color: var(--yomu-accent);
  text-underline-offset: 0.18em;
}

.completion-panel__list a:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
