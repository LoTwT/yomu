<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'

import type {
  VocabularyContextAction,
  VocabularyListItem,
  ReviewVocabularyFocusRequest,
  VocabularySourceLocation,
} from '@/features/vocabulary/types'

const props = defineProps<{
  items: readonly VocabularyListItem[]
  status?: 'idle' | 'loading' | 'ready' | 'error'
  pendingContextId?: string | null
  errorMessage?: string
  focusRequest?: ReviewVocabularyFocusRequest | null
}>()

const emit = defineEmits<{
  removeContext: [action: VocabularyContextAction]
  openSource: [location: VocabularySourceLocation]
  retry: []
}>()

const heading = useTemplateRef<HTMLHeadingElement>('heading')
const sectionRoot = useTemplateRef<HTMLElement>('sectionRoot')
const removeButtons = useTemplateRef<HTMLButtonElement[]>('removeButtons')
const retryButton = useTemplateRef<HTMLButtonElement>('retryButton')

watch(
  () => props.focusRequest,
  async (request) => {
    if (!request) {
      return
    }
    await nextTick()
    if (request.target.kind === 'heading') {
      heading.value?.focus()
      return
    }
    if (request.target.kind === 'retry') {
      retryButton.value?.focus()
      return
    }
    const contextId = request.target.contextId
    removeButtons.value
      ?.find(button => button.dataset.contextId === contextId)
      ?.focus()
  },
)

watch(
  () => props.items,
  async () => {
    if (props.pendingContextId) {
      return
    }
    const activeElement = sectionRoot.value?.ownerDocument.activeElement
    const active = activeElement instanceof HTMLButtonElement
      ? activeElement
      : null
    const sourceContextId = active?.dataset.sourceContextId
    const contextId = active?.dataset.contextId ?? sourceContextId
    if (!active || !contextId) {
      return
    }
    const sourceIndex = removeButtons.value?.findIndex(button => button === active) ?? -1

    await nextTick()
    if (active.isConnected) {
      return
    }
    if (sourceContextId) {
      heading.value?.focus()
      return
    }
    const buttons = removeButtons.value ?? []
    const nextButton = buttons[closestRemainingIndex(sourceIndex, buttons.length)]
    if (nextButton) {
      nextButton.focus()
    }
    else {
      heading.value?.focus()
    }
  },
)

function closestRemainingIndex(sourceIndex: number, remainingCount: number): number {
  return Math.min(Math.max(sourceIndex, 0), Math.max(remainingCount - 1, 0))
}

function toContextAction(
  term: VocabularyListItem,
  context: VocabularyListItem['contexts'][number],
): VocabularyContextAction {
  return {
    termId: term.id,
    contextId: context.id,
    articleId: context.articleId,
    sentenceId: context.sentenceId,
  }
}
</script>

<template>
  <section
    ref="sectionRoot"
    class="review-vocabulary"
    aria-labelledby="review-vocabulary-heading"
  >
    <header class="review-vocabulary__header">
      <p class="review-vocabulary__eyebrow">
        本机收藏
      </p>
      <h2
        id="review-vocabulary-heading"
        ref="heading"
        class="review-vocabulary__heading"
        tabindex="-1"
      >
        本文收藏词
      </h2>
    </header>

    <p v-if="status === 'loading'" class="review-vocabulary__empty" role="status">
      正在读取本文收藏词…
    </p>

    <div v-else-if="status === 'error'" class="review-vocabulary__error" role="alert">
      <p class="review-vocabulary__error-copy">
        {{ errorMessage || '本文收藏词暂时无法读取。阅读回顾仍可使用。' }}
      </p>
      <button
        ref="retryButton"
        class="review-vocabulary__action"
        type="button"
        @click="emit('retry')"
      >
        重试收藏词
      </button>
    </div>

    <template v-else>
      <p v-if="errorMessage" class="review-vocabulary__error" role="alert">
        {{ errorMessage }}
      </p>

      <p v-if="items.length === 0" class="review-vocabulary__empty">
        这篇文章还没有收藏词。回顾仍可完整使用。
      </p>

      <ul v-else class="review-vocabulary__list">
        <li v-for="item in items" :key="item.id" class="review-vocabulary__term">
          <div class="review-vocabulary__term-heading">
            <h3 class="review-vocabulary__word" lang="en">
              {{ item.displayTerm }}
            </h3>
            <p class="review-vocabulary__meaning">
              {{ item.meaning || '暂无本地释义' }}
            </p>
          </div>
          <ul class="review-vocabulary__contexts">
            <li
              v-for="context in item.contexts"
              :key="context.id"
              class="review-vocabulary__context"
            >
              <blockquote class="review-vocabulary__sentence" lang="en">
                {{ context.sentenceText }}
              </blockquote>
              <div class="review-vocabulary__actions">
                <button
                  :data-source-context-id="context.id"
                  class="review-vocabulary__action"
                  type="button"
                  @click="emit('openSource', {
                    articleId: context.articleId,
                    sentenceId: context.sentenceId,
                  })"
                >
                  回到原句
                </button>
                <button
                  ref="removeButtons"
                  :data-context-id="context.id"
                  class="review-vocabulary__action review-vocabulary__action--danger"
                  type="button"
                  :disabled="pendingContextId === context.id"
                  @click="emit('removeContext', toContextAction(item, context))"
                >
                  {{ pendingContextId === context.id ? '正在撤销…' : '撤销收藏' }}
                </button>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.review-vocabulary {
  inline-size: min(100%, 42rem);
  margin-inline: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: clamp(1.25rem, 5vw, 2rem);
  background: var(--surface-elevated);
}

.review-vocabulary__header,
.review-vocabulary__term-heading {
  display: grid;
  gap: 0.35rem;
}

.review-vocabulary__eyebrow,
.review-vocabulary__heading,
.review-vocabulary__empty,
.review-vocabulary__error,
.review-vocabulary__word,
.review-vocabulary__meaning,
.review-vocabulary__sentence {
  margin: 0;
}

.review-vocabulary__eyebrow {
  color: var(--text-accent);
  font-size: 0.8rem;
  font-weight: 750;
}

.review-vocabulary__heading {
  font-family: var(--font-reading);
  font-size: 1.5rem;
}

.review-vocabulary__empty,
.review-vocabulary__error {
  margin-block-start: 1rem;
  color: var(--text-secondary);
  line-height: 1.65;
}

.review-vocabulary__error {
  color: var(--text-danger, var(--text-primary));
}

.review-vocabulary__error-copy {
  margin: 0;
}

.review-vocabulary__error .review-vocabulary__action {
  margin-block-start: 0.75rem;
}

.review-vocabulary__list,
.review-vocabulary__contexts {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.review-vocabulary__term {
  border-block-start: 1px solid var(--border-subtle);
  padding-block-start: 1rem;
}

.review-vocabulary__word {
  font-family: var(--font-reading);
  font-size: 1.2rem;
}

.review-vocabulary__meaning {
  color: var(--text-secondary);
  line-height: 1.55;
}

.review-vocabulary__context {
  border-radius: 0.6rem;
  padding: 0.85rem;
  background: var(--surface-canvas);
}

.review-vocabulary__sentence {
  font-family: var(--font-reading);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.review-vocabulary__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-start: 0.75rem;
}

.review-vocabulary__action {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 0.75rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.review-vocabulary__action--danger {
  color: var(--text-danger, var(--text-primary));
}

.review-vocabulary__action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.review-vocabulary__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

@media (hover: hover) {
  .review-vocabulary__action:hover {
    border-color: var(--accent-primary);
    background: var(--accent-soft);
  }
}
</style>
