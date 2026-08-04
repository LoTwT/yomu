<script setup lang="ts">
import { computed } from 'vue'

import type { ArticleRecord, ArticleSentenceRecord } from '@/data/entities'

const props = defineProps<{
  article: ArticleRecord
  currentSentenceId: string
}>()

const emit = defineEmits<{
  selectSentence: [sentenceId: string]
}>()

const paragraphs = computed(() => {
  const grouped = new Map<number, ArticleSentenceRecord[]>()
  const orderedSentences = [...props.article.sentences]
    .sort((left, right) => left.order - right.order)
  orderedSentences.forEach((sentence) => {
    const values = grouped.get(sentence.paragraphIndex) ?? []
    values.push(sentence)
    grouped.set(sentence.paragraphIndex, values)
  })
  return [...grouped.entries()].map(([paragraphIndex, sentences]) => ({
    paragraphIndex,
    sentences,
  }))
})

function handleSentenceClick(sentenceId: string, event: MouseEvent): void {
  const sentence = event.currentTarget as HTMLButtonElement | null
  if (!sentence) {
    return
  }
  selectAndFocusSentence(sentenceId, sentence)
}

function handleSentenceKeydown(event: KeyboardEvent): void {
  const currentSentence = event.currentTarget as HTMLButtonElement | null
  const articleBody = currentSentence?.closest('.reader-article__body')
  if (!currentSentence || !articleBody) {
    return
  }

  const sentences = [...articleBody.querySelectorAll<HTMLButtonElement>('[data-sentence-id]')]
  const currentIndex = sentences.indexOf(currentSentence)
  if (currentIndex < 0) {
    return
  }

  let targetIndex: number | null = null
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      targetIndex = Math.max(0, currentIndex - 1)
      break
    case 'ArrowRight':
    case 'ArrowDown':
      targetIndex = Math.min(sentences.length - 1, currentIndex + 1)
      break
    case 'Home':
      targetIndex = 0
      break
    case 'End':
      targetIndex = sentences.length - 1
      break
  }

  if (targetIndex === null) {
    return
  }
  event.preventDefault()

  const targetSentence = sentences[targetIndex]
  const sentenceId = targetSentence?.dataset.sentenceId
  if (!targetSentence || !sentenceId) {
    return
  }
  if (targetSentence === currentSentence) {
    currentSentence.focus({ preventScroll: true })
    return
  }
  selectAndFocusSentence(sentenceId, targetSentence)
}

function selectAndFocusSentence(sentenceId: string, sentence: HTMLButtonElement): void {
  emit('selectSentence', sentenceId)
  sentence.focus({ preventScroll: true })
}
</script>

<template>
  <article class="reader-article">
    <header class="reader-article__header">
      <p class="reader-article__source">
        {{ props.article.source.label }} · {{ props.article.level === 'unassessed' ? '未评估' : props.article.level }}
      </p>
      <h2 class="reader-article__title" lang="en">
        {{ props.article.title }}
      </h2>
      <p class="reader-article__meta">
        {{ props.article.wordCount }} 词 · 约 {{ props.article.estimatedReadTimeMinutes }} 分钟
      </p>
    </header>

    <div class="reader-article__body" lang="en">
      <p
        v-for="paragraph in paragraphs"
        :key="paragraph.paragraphIndex"
        class="reader-article__paragraph"
      >
        <button
          v-for="sentence in paragraph.sentences"
          :key="sentence.id"
          class="reader-article__sentence"
          :class="{ 'reader-article__sentence--current': sentence.id === props.currentSentenceId }"
          type="button"
          :data-sentence-id="sentence.id"
          :tabindex="sentence.id === props.currentSentenceId ? 0 : -1"
          :aria-current="sentence.id === props.currentSentenceId ? 'true' : undefined"
          @click="handleSentenceClick(sentence.id, $event)"
          @keydown="handleSentenceKeydown"
        >
          {{ sentence.original }}
        </button>
      </p>
    </div>
  </article>
</template>

<style scoped>
.reader-article {
  inline-size: min(100%, 46rem);
  margin-inline: auto;
}

.reader-article__header {
  padding-block: 2rem 1.5rem;
  border-block-end: 1px solid var(--border-subtle);
}

.reader-article__source,
.reader-article__title,
.reader-article__meta,
.reader-article__paragraph {
  margin: 0;
}

.reader-article__source,
.reader-article__meta {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.reader-article__title {
  margin-block: 0.6rem;
  font-family: var(--font-reading);
  font-size: clamp(2rem, 8vw, 3.25rem);
  font-weight: 620;
  line-height: 1.07;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}

.reader-article__body {
  display: grid;
  gap: 1.4rem;
  padding-block: 1.75rem 2rem;
  font-family: var(--font-reading);
  font-size: clamp(1.12rem, 2.4vw, 1.3rem);
  line-height: 1.9;
}

.reader-article__sentence {
  display: inline;
  border: 0;
  border-radius: 0.18rem;
  padding: 0.08em 0.12em;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  text-align: start;
  cursor: pointer;
}

.reader-article__sentence + .reader-article__sentence {
  margin-inline-start: 0.18em;
}

.reader-article__sentence--current {
  background: var(--accent-soft);
  box-shadow: inset 0 -0.12em 0 var(--accent-primary-active);
}

.reader-article__sentence:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (hover: hover) {
  .reader-article__sentence:hover {
    background: var(--surface-muted);
  }
}

@media (min-width: 768px) {
  .reader-article__header {
    padding-block-start: 3rem;
  }
}

@media (forced-colors: active) {
  .reader-article__sentence--current {
    outline: 2px solid Highlight;
  }
}
</style>
