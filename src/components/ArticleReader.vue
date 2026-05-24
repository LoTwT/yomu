<script setup lang="ts">
import { computed } from 'vue'

import type { ArticleToken, DailyArticle } from '@/features/article/types'
import type { DisplayPreferences } from '@/features/preferences/types'

import SentenceText from './SentenceText.vue'
import WordPopover from './WordPopover.vue'

const props = defineProps<{
  article: DailyArticle
  activeSentenceId: string | null
  preferences: DisplayPreferences
  revealedTranslationIds: string[]
  selectedTokenId: string | null
  selectedToken: ArticleToken | null
  isSelectedTokenSaved: boolean
}>()

const emit = defineEmits<{
  pressSentence: [sentenceId: string]
  selectToken: [token: ArticleToken]
  saveToken: [token: ArticleToken]
  closeTokenPopover: []
  togglePlayback: []
  complete: []
}>()

const selectedTokenSentenceId = computed(() => {
  if (!props.selectedToken) {
    return null
  }

  return props.article.sentences.find(sentence =>
    sentence.tokens.some(token => token.id === props.selectedToken?.id),
  )?.id ?? null
})
</script>

<template>
  <article class="article-reader" aria-labelledby="article-title" @click.self="emit('togglePlayback')">
    <header class="article-reader__header">
      <p class="article-reader__eyebrow">
        {{ article.topic === 'knowledge' ? 'Knowledge' : 'Story' }} · {{ article.level }}
      </p>
      <h1 id="article-title" class="article-reader__title">
        {{ article.title }}
      </h1>
      <p class="article-reader__deck">
        {{ article.deck }}
      </p>
    </header>

    <ol class="article-reader__sentences" aria-label="Article sentences">
      <template v-for="sentence in article.sentences" :key="sentence.id">
        <li
          :id="sentence.id"
          class="article-reader__sentence"
          :class="{ 'article-reader__sentence--active': sentence.id === activeSentenceId }"
          :aria-current="sentence.id === activeSentenceId ? 'true' : undefined"
        >
          <div
            class="article-reader__sentence-surface"
            :class="{ 'article-reader__sentence-surface--translation-mode': preferences.showTranslation }"
            @click="emit('pressSentence', sentence.id)"
          >
            <SentenceText
              :tokens="sentence.tokens"
              :show-pronunciation="preferences.showPronunciation"
              :selected-token-id="selectedTokenId"
              @select-token="emit('selectToken', $event)"
            />
            <button
              v-if="preferences.showTranslation"
              class="article-reader__translation-toggle"
              type="button"
              :aria-expanded="revealedTranslationIds.includes(sentence.id)"
              :aria-controls="`${sentence.id}-translation`"
              :aria-label="`Toggle translation for: ${sentence.original}`"
              @click.stop="emit('pressSentence', sentence.id)"
            >
              译
            </button>
          </div>
          <p
            v-if="preferences.showTranslation && revealedTranslationIds.includes(sentence.id)"
            :id="`${sentence.id}-translation`"
            class="article-reader__translation"
            data-testid="sentence-translation"
          >
            {{ sentence.translation }}
          </p>
        </li>
        <li
          v-if="selectedToken && selectedTokenSentenceId === sentence.id"
          class="article-reader__popover-slot"
          role="presentation"
        >
          <WordPopover
            class="article-reader__word-popover"
            :token="selectedToken"
            :saved="isSelectedTokenSaved"
            @save="emit('saveToken', $event)"
            @close="emit('closeTokenPopover')"
          />
        </li>
      </template>
    </ol>

    <button class="article-reader__complete" type="button" @click="emit('complete')">
      I finished today's reading
    </button>
  </article>
</template>

<style scoped>
.article-reader {
  max-inline-size: min(100%, 42rem);
  margin-inline: auto;
  padding: clamp(2.5rem, 7vw, 4.5rem) 1.25rem 8rem;
}

.article-reader__header {
  margin-block-end: 2.5rem;
}

.article-reader__eyebrow {
  margin: 0 0 0.65rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
}

.article-reader__title {
  margin: 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: clamp(2.55rem, 7vw, 4.4rem);
  line-height: 0.98;
}

.article-reader__deck {
  margin: 1rem 0 0;
  color: var(--yomu-ink-soft);
  font-size: 1.05rem;
  line-height: 1.7;
}

.article-reader__sentences {
  display: grid;
  gap: 1.1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.article-reader__sentence {
  border-radius: 0.65rem;
  padding: 0.65rem 0.8rem;
  transition: background-color 160ms ease;
}

.article-reader__sentence--active {
  background: var(--yomu-active);
}

.article-reader__popover-slot {
  padding: 0;
}

.article-reader__sentence-surface {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  inline-size: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--yomu-ink);
  font: inherit;
  font-family: var(--yomu-serif);
  font-size: clamp(1.35rem, 3.5vw, 1.85rem);
  line-height: 1.75;
  text-align: start;
}

.article-reader__translation-toggle:focus-visible,
.article-reader__complete:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

.article-reader__sentence-surface--translation-mode {
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--yomu-translation-rule) 55%, transparent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.28em;
}

.article-reader__translation-toggle {
  flex: 0 0 auto;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  background: var(--yomu-paper);
  color: var(--yomu-accent);
  font: inherit;
  font-family: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
}

.article-reader__translation {
  border-inline-start: 2px solid var(--yomu-translation-rule);
  margin: 0.6rem 0 0;
  padding-inline-start: 0.8rem;
  color: var(--yomu-muted);
  font-size: 0.95rem;
  line-height: 1.7;
}

.article-reader__complete {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  margin-block-start: 2.5rem;
  padding-inline: 1rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .article-reader__sentence {
    transition: none;
  }
}
</style>
