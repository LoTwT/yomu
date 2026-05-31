<script setup lang="ts">
import type { AiWordExpansionState, ReadExpansionTerm } from '@/features/extension/types'

defineProps<{
  term: ReadExpansionTerm
  aiState: AiWordExpansionState
  aiEnabled: boolean
  aiConfigured: boolean
  providerLabel: string
  compact?: boolean
}>()

const emit = defineEmits<{
  requestAi: [term: ReadExpansionTerm]
  openSettings: []
}>()

function rankLabel(rank: ReadExpansionTerm['rank']): string {
  if (rank === 'above-level') {
    return '超纲'
  }
  if (rank === 'key') {
    return '关键词'
  }
  return '高频'
}
</script>

<template>
  <article
    class="read-expansion-card"
    :class="{ 'read-expansion-card--compact': compact }"
    :aria-labelledby="`read-expansion-${term.id}`"
  >
    <header class="read-expansion-card__header">
      <div>
        <h4 :id="`read-expansion-${term.id}`" class="read-expansion-card__term">
          {{ term.term }}
        </h4>
        <p v-if="term.ipa" class="read-expansion-card__ipa">
          /{{ term.ipa }}/
        </p>
      </div>
      <span class="read-expansion-card__rank">{{ rankLabel(term.rank) }}</span>
    </header>

    <p class="read-expansion-card__gloss">
      {{ term.localGloss }}
    </p>
    <p class="read-expansion-card__meta">
      本地释义 · 零外发<span v-if="term.occurrences > 1"> · 出现 {{ term.occurrences }} 次</span>
    </p>

    <div v-if="aiEnabled" class="read-expansion-card__ai">
      <button
        v-if="!aiConfigured"
        type="button"
        class="read-expansion-card__button"
        @click="emit('openSettings')"
      >
        配置 AI key
      </button>
      <button
        v-else-if="aiState.status === 'idle' || aiState.status === 'failed'"
        type="button"
        class="read-expansion-card__button"
        @click="emit('requestAi', term)"
      >
        AI 增强
      </button>
      <p v-else-if="aiState.status === 'loading'" class="read-expansion-card__status" aria-live="polite">
        正在获取 AI 释义…
      </p>

      <p v-if="aiState.status === 'failed'" class="read-expansion-card__status" aria-live="polite">
        {{ aiState.message }}
      </p>

      <div v-if="aiState.status === 'ready'" class="read-expansion-card__ai-block">
        <p class="read-expansion-card__ai-marker">
          ✨ AI · {{ aiState.expansion.provider || providerLabel }}
        </p>
        <p class="read-expansion-card__ai-meaning">
          {{ aiState.expansion.meaning }}
        </p>
        <ul v-if="aiState.expansion.examples.length" class="read-expansion-card__examples">
          <li v-for="example in aiState.expansion.examples" :key="example">
            {{ example }}
          </li>
        </ul>
        <p v-if="aiState.expansion.background" class="read-expansion-card__background">
          {{ aiState.expansion.background }}
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.read-expansion-card {
  display: grid;
  gap: 0.65rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.9rem;
  padding: 0.9rem;
  background: color-mix(in srgb, var(--yomu-paper) 95%, white);
}

.read-expansion-card--compact {
  border: 0;
  padding: 0;
  background: transparent;
}

.read-expansion-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.8rem;
}

.read-expansion-card__term,
.read-expansion-card__ipa,
.read-expansion-card__gloss,
.read-expansion-card__meta,
.read-expansion-card__status,
.read-expansion-card__ai-marker,
.read-expansion-card__ai-meaning,
.read-expansion-card__background {
  margin: 0;
}

.read-expansion-card__term {
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: 1.25rem;
  line-height: 1.2;
}

.read-expansion-card__ipa {
  color: var(--yomu-ink-soft);
  font-family:
    "Charis SIL",
    "Doulos SIL",
    "Noto Sans",
    "Segoe UI Symbol",
    "Apple Symbols",
    "Arial Unicode MS",
    sans-serif;
  font-size: 0.88rem;
  letter-spacing: 0;
}

.read-expansion-card__rank {
  border: 1px solid color-mix(in srgb, var(--yomu-accent) 44%, var(--yomu-rule));
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  color: var(--yomu-accent);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.read-expansion-card__gloss {
  color: var(--yomu-ink-soft);
  line-height: 1.55;
}

.read-expansion-card__meta,
.read-expansion-card__status {
  color: var(--yomu-muted);
  font-size: 0.86rem;
  line-height: 1.55;
}

.read-expansion-card__ai {
  display: grid;
  gap: 0.55rem;
  border-block-start: 1px solid var(--yomu-rule);
  padding-block-start: 0.65rem;
}

.read-expansion-card__button {
  justify-self: start;
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.8rem;
  background: var(--yomu-paper);
  color: var(--yomu-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.read-expansion-card__ai-block {
  display: grid;
  gap: 0.45rem;
  max-block-size: 13rem;
  border-inline-start: 2px solid var(--yomu-translation-rule);
  padding-inline-start: 0.75rem;
  overflow: auto;
}

.read-expansion-card__ai-marker {
  color: var(--yomu-accent);
  font-size: 0.82rem;
  font-weight: 700;
}

.read-expansion-card__ai-meaning,
.read-expansion-card__background,
.read-expansion-card__examples {
  color: var(--yomu-ink-soft);
  line-height: 1.6;
}

.read-expansion-card__examples {
  margin: 0;
  padding-inline-start: 1.1rem;
}

.read-expansion-card__button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
