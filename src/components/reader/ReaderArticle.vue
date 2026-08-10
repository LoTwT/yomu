<script setup lang="ts">
import { computed, shallowRef, useId, watch } from 'vue'

import {
  normalizeIpa,
  sentenceHasIpa,
  sentenceHasTranslation,
} from '@/data/articleCapabilities'
import type { ArticleRecord, ArticleSentenceRecord } from '@/data/entities'
import type { ReaderFontScale } from '@/features/preferences/useReaderDisplayPreferences'

const props = defineProps<{
  article: ArticleRecord
  currentSentenceId: string
  defaultExpandTranslation: boolean
  fontScale: ReaderFontScale
  playingSentenceId: string | null
  preferencesReady: boolean
  showIpa: boolean
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
const expandedTranslationIds = shallowRef<ReadonlySet<string>>(new Set())
const translationControlId = useId()
const translationPanelIds = computed(() => new Map(
  props.article.sentences.map((sentence, index) => [
    sentence.id,
    `${translationControlId}-translation-${index}`,
  ]),
))
const articleClasses = computed(() => ({
  [`reader-article--font-${Math.round(props.fontScale * 100)}`]: true,
}))
let initializedArticleId: string | null = null
let activeArticleId = props.article.id
let translationStateTouched = false

watch(
  [() => props.article.id, () => props.preferencesReady],
  ([articleId, preferencesReady]) => {
    if (activeArticleId !== articleId) {
      activeArticleId = articleId
      initializedArticleId = null
      translationStateTouched = false
      expandedTranslationIds.value = new Set()
    }
    if (!preferencesReady || initializedArticleId === articleId) {
      return
    }
    initializedArticleId = articleId
    if (!translationStateTouched) {
      expandedTranslationIds.value = props.defaultExpandTranslation
        ? new Set(props.article.sentences
            .filter(sentenceHasTranslation)
            .map(sentence => sentence.id))
        : new Set()
    }
  },
  { immediate: true },
)

function isCurrentSentence(sentenceId: string): boolean {
  return sentenceId === props.currentSentenceId
}

function isTranslationExpanded(sentenceId: string): boolean {
  return expandedTranslationIds.value.has(sentenceId)
}

function toggleTranslation(sentenceId: string): void {
  translationStateTouched = true
  const nextExpandedIds = new Set(expandedTranslationIds.value)
  if (nextExpandedIds.has(sentenceId)) {
    nextExpandedIds.delete(sentenceId)
  }
  else {
    nextExpandedIds.add(sentenceId)
  }
  expandedTranslationIds.value = nextExpandedIds
}

function tokenIpaEntries(sentence: ArticleSentenceRecord) {
  return sentence.tokens.flatMap((token) => {
    if (token.kind !== 'word') {
      return []
    }
    const ipa = normalizeIpa(token.ipa)
    return ipa ? [{ id: token.id, ipa, text: token.text }] : []
  })
}

function translationPanelId(sentenceId: string): string {
  return translationPanelIds.value.get(sentenceId) ?? `${translationControlId}-translation`
}

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
  <article class="reader-article" :class="articleClasses">
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
        <span
          v-for="sentence in paragraph.sentences"
          :key="sentence.id"
          class="reader-article__sentence-cluster"
        >
          <button
            class="reader-article__sentence"
            :class="{
              'reader-article__sentence--current': isCurrentSentence(sentence.id),
              'reader-article__sentence--playing': sentence.id === props.playingSentenceId,
            }"
            type="button"
            :data-sentence-id="sentence.id"
            :data-playing="sentence.id === props.playingSentenceId ? 'true' : undefined"
            :tabindex="isCurrentSentence(sentence.id) ? 0 : -1"
            :aria-current="isCurrentSentence(sentence.id) ? 'true' : undefined"
            @click="handleSentenceClick(sentence.id, $event)"
            @keydown="handleSentenceKeydown"
          >
            {{ sentence.original }}
          </button>

          <span
            v-if="props.showIpa && isCurrentSentence(sentence.id) && sentenceHasIpa(sentence)"
            class="reader-article__ipa"
            data-testid="sentence-ipa"
          >
            <span class="reader-article__assist-label">IPA</span>
            <span v-if="normalizeIpa(sentence.sentenceIpa)" class="reader-article__sentence-ipa">
              {{ normalizeIpa(sentence.sentenceIpa) }}
            </span>
            <span v-else class="reader-article__token-ipa-list" aria-label="当前句单词 IPA">
              <span
                v-for="entry in tokenIpaEntries(sentence)"
                :key="entry.id"
                class="reader-article__token-ipa"
              >
                <span class="reader-article__ipa-word">{{ entry.text }}</span>
                <span class="reader-article__ipa-value">{{ entry.ipa }}</span>
              </span>
            </span>
          </span>

          <span
            v-if="sentenceHasTranslation(sentence)"
            class="reader-article__translation-action"
          >
            <button
              class="reader-article__translation-toggle"
              type="button"
              :tabindex="isCurrentSentence(sentence.id) ? 0 : -1"
              :aria-expanded="isTranslationExpanded(sentence.id)"
              :aria-controls="isTranslationExpanded(sentence.id) ? translationPanelId(sentence.id) : undefined"
              :aria-label="`${isTranslationExpanded(sentence.id) ? '收起' : '显示'}第 ${sentence.order + 1} 句译文`"
              @click="toggleTranslation(sentence.id)"
            >
              {{ isTranslationExpanded(sentence.id) ? '收起译文' : '译文' }}
            </button>
          </span>

          <span
            v-if="isTranslationExpanded(sentence.id) && sentenceHasTranslation(sentence)"
            :id="translationPanelId(sentence.id)"
            class="reader-article__translation"
            data-testid="sentence-translation"
            lang="zh-CN"
          >
            {{ sentence.translation }}
          </span>
        </span>
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
  font-size: var(--reader-body-font-size, clamp(1.12rem, 2.4vw, 1.3rem));
  line-height: 1.9;
}

.reader-article--font-90 {
  --reader-body-font-size: clamp(1.01rem, 2.16vw, 1.17rem);
}

.reader-article--font-100 {
  --reader-body-font-size: clamp(1.12rem, 2.4vw, 1.3rem);
}

.reader-article--font-115 {
  --reader-body-font-size: clamp(1.29rem, 2.76vw, 1.5rem);
}

.reader-article--font-130 {
  --reader-body-font-size: clamp(1.46rem, 3.12vw, 1.69rem);
}

.reader-article__sentence-cluster {
  display: inline;
}

.reader-article__sentence {
  display: inline-block;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  max-inline-size: 100%;
  border: 0;
  border-radius: 0.18rem;
  padding: 0.08em 0.12em;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  text-align: start;
  vertical-align: baseline;
  cursor: pointer;
}

.reader-article__sentence-cluster + .reader-article__sentence-cluster .reader-article__sentence {
  margin-inline-start: 0.18em;
}

.reader-article__sentence--current {
  background: var(--accent-soft);
  box-shadow: inset 0 -0.12em 0 var(--accent-primary-active);
}

.reader-article__sentence--playing {
  box-shadow: inset 0 -0.18em 0 var(--accent-primary-active);
}

.reader-article__sentence:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.reader-article__ipa,
.reader-article__translation {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  margin-block: 0.55rem 0.85rem;
  border-inline-start: 2px solid var(--reading-rule);
  padding-inline-start: 0.8rem;
}

.reader-article__ipa {
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-family: var(--reading-font-mono);
  font-size: 0.7em;
  line-height: 1.65;
}

.reader-article__assist-label {
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reader-article__token-ipa-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
}

.reader-article__token-ipa {
  display: inline-flex;
  gap: 0.3rem;
}

.reader-article__ipa-word {
  color: var(--text-primary);
  font-family: var(--reading-font-body);
}

.reader-article__ipa-value {
  color: var(--text-secondary);
}

.reader-article__translation-action {
  display: inline-flex;
  margin-inline-start: 0.16em;
  vertical-align: baseline;
}

.reader-article__translation-toggle {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 0;
  border-radius: var(--radius-control);
  padding-inline: 0.55rem;
  background: transparent;
  color: var(--text-accent);
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.reader-article__translation {
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 0.82em;
  line-height: 1.75;
}

.reader-article__translation-toggle:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

@media (hover: hover) {
  .reader-article__sentence:hover {
    background: var(--surface-muted);
  }

  .reader-article__translation-toggle:hover {
    background: var(--accent-soft);
  }
}

@media (min-width: 768px) {
  .reader-article__header {
    padding-block-start: 3rem;
  }
}

@media (forced-colors: active) {
  .reader-article__sentence--current,
  .reader-article__sentence--playing {
    outline: 2px solid Highlight;
  }
}
</style>
