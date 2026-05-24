<script setup lang="ts">
import type { ArticleToken } from '@/features/article/types'

defineProps<{
  tokens: ArticleToken[]
  showPronunciation: boolean
}>()
</script>

<template>
  <span class="sentence-text">
    <template v-for="(token, index) in tokens" :key="`${token.text}-${index}`">
      <ruby
        v-if="showPronunciation && token.ipa"
        class="sentence-text__ruby"
        data-testid="ipa-token"
      >
        {{ token.text }}<rp>(</rp><rt aria-hidden="true">{{ token.ipa }}</rt><rp>)</rp>
      </ruby>
      <span v-else :class="{ 'sentence-text__punctuation': token.kind === 'punctuation' }">
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

.sentence-text__ruby rt {
  color: var(--yomu-muted);
  font-size: 0.58em;
  font-weight: 500;
  letter-spacing: 0;
}

.sentence-text__punctuation {
  margin-inline-start: -0.18em;
}
</style>
