<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue'

import type {
  VocabularyContextAction,
  VocabularyListItem,
  VocabularySourceLocation,
  VocabularyTermAction,
} from '@/features/vocabulary/types'

const props = defineProps<{
  item: VocabularyListItem
  pendingContextId?: string | null
  pendingTermId?: string | null
}>()

const emit = defineEmits<{
  removeContext: [action: VocabularyContextAction]
  deleteTerm: [action: VocabularyTermAction]
  openSource: [location: VocabularySourceLocation]
}>()

const savedAtLabel = computed(() => formatDate(props.item.savedAt))
const unavailableCount = computed(() => props.item.unavailableContextCount)
const headingId = useId()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const deleteTermButton = useTemplateRef<HTMLButtonElement>('deleteTermButton')
const contextRemoveButtons = useTemplateRef<HTMLButtonElement[]>('contextRemoveButtons')

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
}

function emitRemoveContext(context: VocabularyListItem['contexts'][number]): void {
  emit('removeContext', {
    termId: props.item.id,
    contextId: context.id,
    articleId: context.articleId,
    sentenceId: context.sentenceId,
  })
}

function focusContext(contextId: string): void {
  contextRemoveButtons.value
    ?.find(button => button.dataset.contextId === contextId)
    ?.focus()
}

function focusHeading(): void {
  heading.value?.focus()
}

function focusDeleteTerm(): void {
  deleteTermButton.value?.focus()
}

defineExpose({ focusContext, focusDeleteTerm, focusHeading })
</script>

<template>
  <article
    class="vocabulary-details"
    :aria-labelledby="headingId"
    :data-detail-term-id="item.id"
  >
    <header class="vocabulary-details__header">
      <div>
        <p class="vocabulary-details__eyebrow">
          收藏于 {{ savedAtLabel }}
        </p>
        <h2
          :id="headingId"
          ref="heading"
          class="vocabulary-details__title"
          lang="en"
          tabindex="-1"
        >
          {{ item.displayTerm }}
        </h2>
        <p
          v-if="item.normalizedTerm !== item.displayTerm.toLocaleLowerCase('en-US')"
          class="vocabulary-details__normalized"
          lang="en"
        >
          规范词：{{ item.normalizedTerm }}
        </p>
      </div>
      <button
        ref="deleteTermButton"
        :data-term-id="item.id"
        class="vocabulary-details__delete-term"
        type="button"
        :disabled="pendingTermId === item.id"
        @click="emit('deleteTerm', { termId: item.id })"
      >
        {{ pendingTermId === item.id ? '正在取消…' : '取消收藏整个词条' }}
      </button>
    </header>

    <p class="vocabulary-details__meaning">
      {{ item.meaning || '暂无本地释义' }}
    </p>

    <p v-if="unavailableCount > 0" class="vocabulary-details__orphaned" role="status">
      {{ unavailableCount }} 条来源上下文当前不可用；Yomu 不会在这里展示无法核对的正文。
    </p>

    <section class="vocabulary-details__contexts" aria-labelledby="vocabulary-contexts-heading">
      <h3 id="vocabulary-contexts-heading" class="vocabulary-details__contexts-title">
        来源上下文
      </h3>
      <p v-if="item.contexts.length === 0" class="vocabulary-details__empty">
        这个词目前没有可打开的原句。
      </p>
      <ul v-else class="vocabulary-details__context-list">
        <li
          v-for="context in item.contexts"
          :key="context.id"
          class="vocabulary-details__context"
        >
          <blockquote class="vocabulary-details__sentence" lang="en">
            {{ context.sentenceText }}
          </blockquote>
          <p class="vocabulary-details__source">
            {{ context.articleTitle }} · {{ context.articleSourceLabel }}
          </p>
          <div class="vocabulary-details__context-actions">
            <button
              :data-source-context-id="context.id"
              :data-term-id="item.id"
              class="vocabulary-details__context-action"
              type="button"
              @click="emit('openSource', {
                articleId: context.articleId,
                sentenceId: context.sentenceId,
              })"
            >
              回到原句
            </button>
            <button
              ref="contextRemoveButtons"
              :data-context-id="context.id"
              :data-term-id="item.id"
              class="vocabulary-details__context-action vocabulary-details__context-action--danger"
              type="button"
              :disabled="pendingContextId === context.id"
              @click="emitRemoveContext(context)"
            >
              {{ pendingContextId === context.id ? '正在删除…' : '删除此上下文' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.vocabulary-details {
  min-inline-size: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: clamp(1rem, 4vw, 1.5rem);
  background: var(--surface-elevated);
}

.vocabulary-details__header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
}

.vocabulary-details__eyebrow,
.vocabulary-details__normalized,
.vocabulary-details__meaning,
.vocabulary-details__orphaned,
.vocabulary-details__empty,
.vocabulary-details__source,
.vocabulary-details__sentence {
  margin: 0;
}

.vocabulary-details__eyebrow,
.vocabulary-details__normalized,
.vocabulary-details__source {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.vocabulary-details__title {
  margin: 0.25rem 0 0;
  font-family: var(--font-reading);
  font-size: clamp(1.7rem, 7vw, 2.4rem);
  overflow-wrap: anywhere;
}

.vocabulary-details__normalized {
  margin-block-start: 0.25rem;
}

.vocabulary-details__meaning {
  margin-block-start: 1rem;
  color: var(--text-primary);
  line-height: 1.65;
}

.vocabulary-details__orphaned {
  margin-block-start: 1rem;
  border-inline-start: 3px solid var(--status-warning-border);
  padding-inline-start: 0.75rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.6;
}

.vocabulary-details__delete-term,
.vocabulary-details__context-action {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 0.8rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.vocabulary-details__delete-term,
.vocabulary-details__context-action--danger {
  color: var(--text-danger, var(--text-primary));
}

.vocabulary-details__delete-term:disabled,
.vocabulary-details__context-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.vocabulary-details__delete-term:focus-visible,
.vocabulary-details__context-action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.vocabulary-details__contexts {
  margin-block-start: 1.5rem;
  border-block-start: 1px solid var(--border-subtle);
  padding-block-start: 1.25rem;
}

.vocabulary-details__contexts-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.vocabulary-details__empty {
  color: var(--text-secondary);
}

.vocabulary-details__context-list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.vocabulary-details__context {
  border: 1px solid var(--border-subtle);
  border-radius: 0.6rem;
  padding: 0.9rem;
  background: var(--surface-canvas);
}

.vocabulary-details__sentence {
  color: var(--text-primary);
  font-family: var(--font-reading);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.vocabulary-details__source {
  margin-block-start: 0.5rem;
}

.vocabulary-details__context-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-start: 0.75rem;
}

@media (hover: hover) {
  .vocabulary-details__delete-term:hover,
  .vocabulary-details__context-action:hover {
    border-color: var(--accent-primary);
    background: var(--accent-soft);
  }
}
</style>
