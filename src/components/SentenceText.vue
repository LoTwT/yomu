<script setup lang="ts">
import type { ArticleToken } from '@/features/article/types'

defineProps<{
  tokens: ArticleToken[]
  showPronunciation: boolean
  isActiveSentence: boolean
  selectedTokenId: string | null
}>()

const emit = defineEmits<{
  selectToken: [token: ArticleToken]
}>()
</script>

<template>
  <span class="sentence-text">
    <template v-for="token in tokens" :key="token.id">
      <button
        v-if="token.kind !== 'punctuation'"
        class="sentence-text__token"
        :class="{ 'sentence-text__token--selected': token.id === selectedTokenId }"
        type="button"
        :aria-label="token.meaning ? `${token.text}: ${token.meaning}` : `Word: ${token.text}`"
        @click.stop="emit('selectToken', token)"
      >
        <ruby
          v-if="showPronunciation && token.ipa"
          class="sentence-text__ruby"
        >
          {{ token.text }}<rp>(</rp><rt
            class="sentence-text__rt"
            :class="{ 'sentence-text__rt--placeholder': !isActiveSentence }"
            :data-testid="isActiveSentence ? 'ipa-token' : undefined"
            aria-hidden="true"
          >/{{ token.ipa }}/</rt><rp>)</rp>
        </ruby>
        <span v-else>
          {{ token.text }}
        </span>
      </button>
      <span v-else class="sentence-text__punctuation">
        {{ token.text }}
      </span>
      <span v-if="token.kind !== 'punctuation'" aria-hidden="true"> </span>
    </template>
  </span>
</template>

<style scoped>
.sentence-text__ruby {
  ruby-position: over;
}

.sentence-text__rt {
  color: var(--yomu-ink-soft);
  font-family:
    "Charis SIL",
    "Doulos SIL",
    "Noto Sans",
    "Segoe UI Symbol",
    "Apple Symbols",
    "Arial Unicode MS",
    sans-serif;
  font-size: 0.58em;
  font-weight: 500;
  letter-spacing: 0;
}

.sentence-text__rt--placeholder {
  visibility: hidden;
}

.sentence-text__punctuation {
  margin-inline-start: -0.18em;
}

.sentence-text__token {
  border: 0;
  border-radius: 0.35rem;
  padding: 0.02em 0.08em;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.sentence-text__token:hover,
.sentence-text__token--selected {
  background: color-mix(in srgb, var(--yomu-active) 60%, transparent);
}

.sentence-text__token:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 2px;
}
</style>
