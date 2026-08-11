<script setup lang="ts">
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

import {
  normalizeIpa,
  sentenceHasIpa,
  sentenceHasTranslation,
} from '@/data/articleCapabilities'
import type {
  ArticleRecord,
  ArticleSentenceRecord,
  ArticleTokenRecord,
} from '@/data/entities'
import type { ReaderFontScale } from '@/features/preferences/useReaderDisplayPreferences'

export interface ReaderWordCardRequest {
  articleId: string
  sentenceId: string
  tokenId: string
  anchor: HTMLElement
  focusReturn: HTMLElement
  source: 'pointer' | 'keyboard'
}

interface RenderedSentenceToken {
  leadingText: string
  token: ArticleTokenRecord
}

interface RenderedSentenceText {
  matched: boolean
  tokens: RenderedSentenceToken[]
  trailingText: string
}

interface KeyboardWordSelection {
  sentenceId: string
  tokenId: string
}

const props = withDefaults(defineProps<{
  article: ArticleRecord
  currentSentenceId: string
  defaultExpandTranslation: boolean
  fontScale: ReaderFontScale
  locatedSentenceId?: string
  playingSentenceId: string | null
  preferencesReady: boolean
  showIpa: boolean
}>(), {
  locatedSentenceId: undefined,
})

const emit = defineEmits<{
  requestWordCard: [request: ReaderWordCardRequest]
  selectSentence: [sentenceId: string]
}>()

const articleRoot = useTemplateRef<HTMLElement>('articleRoot')
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
const sentenceTextLayouts = computed(() => new Map(
  props.article.sentences.map(sentence => [sentence.id, renderSentenceText(sentence)]),
))
const expandedTranslationIds = shallowRef<ReadonlySet<string>>(new Set())
const keyboardWordSelection = shallowRef<KeyboardWordSelection | null>(null)
const translationControlId = useId()
const wordSelectionInstructionsId = useId()
const translationPanelIds = computed(() => new Map(
  props.article.sentences.map((sentence, index) => [
    sentence.id,
    `${translationControlId}-translation-${index}`,
  ]),
))
const articleClasses = computed(() => ({
  [`reader-article--font-${Math.round(props.fontScale * 100)}`]: true,
}))
const selectedKeyboardWord = computed(() => {
  const selection = keyboardWordSelection.value
  if (!selection) {
    return null
  }
  const sentence = props.article.sentences.find(candidate => candidate.id === selection.sentenceId)
  return sentence?.tokens.find(token => token.id === selection.tokenId && token.kind === 'word')
    ?? null
})
const wordSelectionAnnouncement = computed(() => selectedKeyboardWord.value
  ? `已选择 ${selectedKeyboardWord.value.text}。使用方向键更改单词，按 Enter 打开词卡，按 Escape 退出选词。`
  : '')
let initializedArticleId: string | null = null
let activeArticleId = props.article.id
let translationStateTouched = false
let locationRequestVersion = 0

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

watch(
  [() => props.article.id, () => props.currentSentenceId],
  ([articleId, sentenceId], [previousArticleId]) => {
    const selection = keyboardWordSelection.value
    if (selection
      && (articleId !== previousArticleId || selection.sentenceId !== sentenceId)) {
      keyboardWordSelection.value = null
    }
  },
)

watch(
  [() => props.article, () => props.locatedSentenceId],
  async ([, locatedSentenceId]) => {
    const requestVersion = ++locationRequestVersion
    if (!locatedSentenceId) {
      return
    }

    await nextTick()
    if (requestVersion !== locationRequestVersion
      || locatedSentenceId !== props.locatedSentenceId) {
      return
    }

    const sentence = findSentenceElement(locatedSentenceId)
    if (!sentence) {
      return
    }
    sentence.focus({ preventScroll: true })
    sentence.scrollIntoView?.({
      behavior: prefersReducedMotion(sentence.ownerDocument) ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    })
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

function sentenceTextLayout(sentence: ArticleSentenceRecord): RenderedSentenceText {
  return sentenceTextLayouts.value.get(sentence.id) ?? {
    matched: false,
    tokens: [],
    trailingText: sentence.original,
  }
}

function renderSentenceText(sentence: ArticleSentenceRecord): RenderedSentenceText {
  if (sentence.tokens.length === 0) {
    return { matched: false, tokens: [], trailingText: sentence.original }
  }

  let cursor = 0
  const tokens: RenderedSentenceToken[] = []
  for (const token of sentence.tokens) {
    const tokenIndex = sentence.original.indexOf(token.text, cursor)
    if (tokenIndex < 0) {
      return { matched: false, tokens: [], trailingText: sentence.original }
    }
    tokens.push({
      leadingText: sentence.original.slice(cursor, tokenIndex),
      token,
    })
    cursor = tokenIndex + token.text.length
  }

  return {
    matched: true,
    tokens,
    trailingText: sentence.original.slice(cursor),
  }
}

function translationPanelId(sentenceId: string): string {
  return translationPanelIds.value.get(sentenceId) ?? `${translationControlId}-translation`
}

function handleSentenceClick(sentenceId: string, event: MouseEvent): void {
  const sentence = event.currentTarget as HTMLButtonElement | null
  if (!sentence) {
    return
  }
  const tokenAnchor = readWordTokenAnchor(event.target, sentence)
  keyboardWordSelection.value = null
  selectAndFocusSentence(sentenceId, sentence)
  if (tokenAnchor) {
    requestWordCard(sentenceId, tokenAnchor.dataset.wordTokenId ?? '', tokenAnchor, sentence, 'pointer')
  }
}

function handleSentenceKeydown(sentenceRecord: ArticleSentenceRecord, event: KeyboardEvent): void {
  const currentSentence = event.currentTarget as HTMLButtonElement | null
  const articleBody = currentSentence?.closest('.reader-article__body')
  if (!currentSentence || !articleBody) {
    return
  }

  const wordTokens = sentenceRecord.tokens.filter(token => token.kind === 'word')
  const activeWordSelection = keyboardWordSelection.value?.sentenceId === sentenceRecord.id
    ? keyboardWordSelection.value
    : null

  if (event.key === 'Escape' && activeWordSelection) {
    event.preventDefault()
    event.stopPropagation()
    keyboardWordSelection.value = null
    return
  }

  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    if (wordTokens.length === 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!activeWordSelection) {
      keyboardWordSelection.value = {
        sentenceId: sentenceRecord.id,
        tokenId: wordTokens[0]!.id,
      }
      return
    }

    const tokenAnchor = findWordTokenAnchor(currentSentence, activeWordSelection.tokenId)
    if (tokenAnchor) {
      requestWordCard(
        sentenceRecord.id,
        activeWordSelection.tokenId,
        tokenAnchor,
        currentSentence,
        'keyboard',
      )
    }
    keyboardWordSelection.value = null
    return
  }

  if (activeWordSelection) {
    const currentWordIndex = wordTokens.findIndex(token => token.id === activeWordSelection.tokenId)
    let targetWordIndex: number | null = null
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        targetWordIndex = Math.max(0, currentWordIndex - 1)
        break
      case 'ArrowRight':
      case 'ArrowDown':
        targetWordIndex = Math.min(wordTokens.length - 1, currentWordIndex + 1)
        break
      case 'Home':
        targetWordIndex = 0
        break
      case 'End':
        targetWordIndex = wordTokens.length - 1
        break
    }
    if (targetWordIndex === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    keyboardWordSelection.value = {
      sentenceId: sentenceRecord.id,
      tokenId: wordTokens[targetWordIndex]!.id,
    }
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

function readWordTokenAnchor(target: EventTarget | null, sentence: HTMLButtonElement): HTMLElement | null {
  const element = target instanceof Element
    ? target.closest<HTMLElement>('[data-word-token-id]')
    : null
  return element && sentence.contains(element) ? element : null
}

function findWordTokenAnchor(sentence: HTMLButtonElement, tokenId: string): HTMLElement | null {
  return [...sentence.querySelectorAll<HTMLElement>('[data-word-token-id]')]
    .find(element => element.dataset.wordTokenId === tokenId) ?? null
}

function requestWordCard(
  sentenceId: string,
  tokenId: string,
  anchor: HTMLElement,
  focusReturn: HTMLElement,
  source: ReaderWordCardRequest['source'],
): void {
  if (!tokenId) {
    return
  }
  emit('requestWordCard', {
    articleId: props.article.id,
    sentenceId,
    tokenId,
    anchor,
    focusReturn,
    source,
  })
}

function findSentenceElement(sentenceId: string): HTMLButtonElement | null {
  return [...articleRoot.value?.querySelectorAll<HTMLButtonElement>('[data-sentence-id]') ?? []]
    .find(sentence => sentence.dataset.sentenceId === sentenceId) ?? null
}

function prefersReducedMotion(ownerDocument: Document): boolean {
  return ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
</script>

<template>
  <article ref="articleRoot" class="reader-article" :class="articleClasses">
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
              'reader-article__sentence--located': sentence.id === props.locatedSentenceId,
              'reader-article__sentence--playing': sentence.id === props.playingSentenceId,
            }"
            type="button"
            :data-sentence-id="sentence.id"
            :data-playing="sentence.id === props.playingSentenceId ? 'true' : undefined"
            :tabindex="isCurrentSentence(sentence.id) ? 0 : -1"
            :aria-current="isCurrentSentence(sentence.id) ? 'true' : undefined"
            :aria-describedby="isCurrentSentence(sentence.id) ? wordSelectionInstructionsId : undefined"
            @click="handleSentenceClick(sentence.id, $event)"
            @keydown="handleSentenceKeydown(sentence, $event)"
          >
            <template v-if="sentenceTextLayout(sentence).matched">
              <template
                v-for="part in sentenceTextLayout(sentence).tokens"
                :key="part.token.id"
              >{{ part.leadingText }}<span
                  class="reader-article__token"
                  :class="{
                    'reader-article__token--selectable': part.token.kind === 'word',
                    'reader-article__token--selected': keyboardWordSelection?.tokenId === part.token.id,
                  }"
                  :data-token-id="part.token.id"
                  :data-word-token-id="part.token.kind === 'word' ? part.token.id : undefined"
                >{{ part.token.text }}</span></template>{{ sentenceTextLayout(sentence).trailingText }}
            </template>
            <template v-else>
              {{ sentence.original }}
            </template>
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
    <p :id="wordSelectionInstructionsId" class="reader-article__assistive-text">
      按 Enter 进入当前句选词；使用方向键更改单词，再按 Enter 打开词卡，按 Escape 退出。
    </p>
    <p class="reader-article__assistive-text" aria-live="polite" aria-atomic="true">
      {{ wordSelectionAnnouncement }}
    </p>
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

.reader-article__sentence--located {
  outline: 2px solid var(--reading-focus);
  outline-offset: 0.18rem;
}

.reader-article__token {
  border-radius: 0.16rem;
}

.reader-article__token--selectable {
  text-decoration-color: transparent;
  text-decoration-line: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}

.reader-article__token--selected {
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
  text-decoration-color: currentColor;
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

.reader-article__assistive-text {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (hover: hover) {
  .reader-article__sentence:hover {
    background: var(--surface-muted);
  }

  .reader-article__token--selectable:hover {
    text-decoration-color: currentColor;
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
  .reader-article__sentence--located,
  .reader-article__sentence--playing {
    outline: 2px solid Highlight;
  }
}
</style>
