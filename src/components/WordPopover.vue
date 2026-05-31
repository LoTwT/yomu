<script setup lang="ts">
import type { ArticleToken } from '@/features/article/types'
import type { AiWordExpansionState, ReadExpansionTerm } from '@/features/extension/types'

import ReadExpansionCard from './ReadExpansionCard.vue'

defineProps<{
  token: ArticleToken | null
  saved: boolean
  expansionTerm: ReadExpansionTerm | null
  aiState: AiWordExpansionState
  aiEnabled: boolean
  aiConfigured: boolean
  providerLabel: string
}>()

const emit = defineEmits<{
  save: [token: ArticleToken]
  close: []
  requestAi: [term: ReadExpansionTerm]
  openSettings: []
}>()
</script>

<template>
  <aside
    v-if="token"
    class="word-popover"
    role="dialog"
    aria-live="polite"
    aria-label="Word meaning"
    data-testid="word-popover"
  >
    <ReadExpansionCard
      v-if="expansionTerm"
      :term="expansionTerm"
      :ai-state="aiState"
      :ai-enabled="aiEnabled"
      :ai-configured="aiConfigured"
      :provider-label="providerLabel"
      compact
      @request-ai="emit('requestAi', $event)"
      @open-settings="emit('openSettings')"
    />
    <div v-else>
      <p class="word-popover__word">
        {{ token.text }}
      </p>
      <p v-if="token.ipa" class="word-popover__ipa">
        /{{ token.ipa }}/
      </p>
      <p class="word-popover__meaning">
        {{ token.meaning ?? 'No glossary note yet.' }}
      </p>
    </div>
    <div class="word-popover__actions">
      <button type="button" @click="emit('save', token)">
        {{ saved ? 'Saved' : 'Save word' }}
      </button>
      <button type="button" @click="emit('close')">
        Close
      </button>
    </div>
  </aside>
</template>

<style scoped>
.word-popover {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.9rem;
  margin-block-start: 0.85rem;
  padding: 0.85rem;
  background: color-mix(in srgb, var(--yomu-paper) 94%, white);
  box-shadow: 0 14px 32px rgb(47 39 27 / 12%);
}

.word-popover :deep(.read-expansion-card) {
  flex: 1 1 16rem;
}

.word-popover__word,
.word-popover__ipa,
.word-popover__meaning {
  margin: 0;
}

.word-popover__word {
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: 1.25rem;
  font-weight: 700;
}

.word-popover__ipa,
.word-popover__meaning {
  color: var(--yomu-muted);
  line-height: 1.5;
}

.word-popover__actions {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 0.5rem;
}

.word-popover__actions button {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.85rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.word-popover__actions button:first-child {
  border-color: var(--yomu-accent);
  color: var(--yomu-accent);
  font-weight: 700;
}

.word-popover__actions button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
