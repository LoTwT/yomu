<script setup lang="ts">
import { useTemplateRef } from 'vue'

import type { VocabularyListItem } from '@/features/vocabulary/types'

defineProps<{
  items: readonly VocabularyListItem[]
  selectedTermId: string | null
}>()

const emit = defineEmits<{
  selectTerm: [termId: string]
}>()

const termButtons = useTemplateRef<HTMLButtonElement[]>('termButtons')

function focusTerm(termId: string): void {
  termButtons.value
    ?.find(button => button.dataset.termId === termId)
    ?.focus()
}

defineExpose({ focusTerm })
</script>

<template>
  <ul class="vocabulary-term-list" aria-label="收藏词列表">
    <li v-for="item in items" :key="item.id" class="vocabulary-term-list__item">
      <button
        ref="termButtons"
        :data-term-id="item.id"
        class="vocabulary-term-list__button"
        :class="{ 'vocabulary-term-list__button--selected': item.id === selectedTermId }"
        type="button"
        :aria-pressed="item.id === selectedTermId"
        @click="emit('selectTerm', item.id)"
      >
        <span class="vocabulary-term-list__heading" lang="en">
          {{ item.displayTerm }}
        </span>
        <span v-if="item.meaning" class="vocabulary-term-list__meaning">
          {{ item.meaning }}
        </span>
        <span class="vocabulary-term-list__meta">
          {{ item.contexts.length }} 条可用上下文
        </span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.vocabulary-term-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.vocabulary-term-list__item {
  min-inline-size: 0;
}

.vocabulary-term-list__button {
  display: grid;
  gap: 0.25rem;
  inline-size: 100%;
  min-block-size: 4.5rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.6rem;
  padding: 0.8rem 0.9rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.vocabulary-term-list__button--selected {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
}

.vocabulary-term-list__button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.vocabulary-term-list__heading {
  font-family: var(--font-reading);
  font-size: 1.15rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.vocabulary-term-list__meaning,
.vocabulary-term-list__meta {
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.vocabulary-term-list__meaning {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (hover: hover) {
  .vocabulary-term-list__button:hover {
    border-color: var(--accent-primary);
    background: var(--accent-soft);
  }
}
</style>
