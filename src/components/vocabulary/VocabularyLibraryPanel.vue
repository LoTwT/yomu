<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import { RouterLink } from 'vue-router'

import type {
  VocabularyContextAction,
  VocabularyLibraryFocusRequest,
  VocabularyListItem,
  VocabularySourceLocation,
  VocabularyTermAction,
} from '@/features/vocabulary/types'
import VocabularySearch from './VocabularySearch.vue'
import VocabularyTermDetails from './VocabularyTermDetails.vue'
import VocabularyTermList from './VocabularyTermList.vue'

const props = defineProps<{
  status: 'loading' | 'ready' | 'error'
  items: readonly VocabularyListItem[]
  totalCount: number
  query: string
  selectedItem: VocabularyListItem | null
  errorMessage?: string
  actionErrorMessage?: string
  pendingContextId?: string | null
  pendingTermId?: string | null
  focusRequest?: VocabularyLibraryFocusRequest | null
}>()

const emit = defineEmits<{
  updateQuery: [query: string]
  selectTerm: [termId: string]
  removeContext: [action: VocabularyContextAction]
  deleteTerm: [action: VocabularyTermAction]
  openSource: [location: VocabularySourceLocation]
  retry: []
}>()

interface TermListFocusHandle {
  focusTerm: (termId: string) => void
}

interface TermDetailsFocusHandle {
  focusContext: (contextId: string) => void
  focusDeleteTerm: () => void
  focusHeading: () => void
}

const libraryRoot = useTemplateRef<HTMLElement>('libraryRoot')
const termList = useTemplateRef<TermListFocusHandle>('termList')
const termDetails = useTemplateRef<TermDetailsFocusHandle>('termDetails')
const emptyHeading = useTemplateRef<HTMLHeadingElement>('emptyHeading')
const noResultsHeading = useTemplateRef<HTMLHeadingElement>('noResultsHeading')
const retryButton = useTemplateRef<HTMLButtonElement>('retryButton')

watch(
  () => props.focusRequest,
  async (request) => {
    if (!request) {
      return
    }
    await nextTick()
    switch (request.target.kind) {
      case 'context':
        termDetails.value?.focusContext(request.target.contextId)
        break
      case 'term-heading':
        termDetails.value?.focusHeading()
        break
      case 'term-delete':
        termDetails.value?.focusDeleteTerm()
        break
      case 'term':
        termList.value?.focusTerm(request.target.termId)
        break
      case 'empty':
        emptyHeading.value?.focus()
        break
      case 'no-results':
        noResultsHeading.value?.focus()
        break
      case 'retry':
        retryButton.value?.focus()
        break
    }
  },
)

watch(
  () => props.items,
  async () => {
    if (props.pendingContextId || props.pendingTermId) {
      return
    }
    const activeElement = libraryRoot.value?.ownerDocument.activeElement
    const active = activeElement instanceof HTMLElement
      ? activeElement
      : null
    if (!active || !libraryRoot.value?.contains(active)) {
      return
    }

    const sourceContextId = active.dataset.sourceContextId
    const contextId = active.dataset.contextId ?? sourceContextId
    const termId = active.dataset.termId
      ?? active.closest<HTMLElement>('[data-detail-term-id]')?.dataset.detailTermId
    const termButtons = [...libraryRoot.value.querySelectorAll<HTMLElement>(
      '.vocabulary-term-list__button[data-term-id]',
    )]
    const contextButtons = [...libraryRoot.value.querySelectorAll<HTMLElement>('[data-context-id]')]
    const termIndex = termId
      ? termButtons.findIndex(button => button.dataset.termId === termId)
      : props.items.findIndex(item => item.id === props.selectedItem?.id)
    const contextIndex = contextId
      ? contextButtons.findIndex(button => button.dataset.contextId === contextId)
      : -1
    const focusedTermId = termId ?? props.selectedItem?.id
    const tracksVocabularyItem = Boolean(
      contextId
      || termId
      || active.matches('.vocabulary-details__delete-term'),
    )
    if (!tracksVocabularyItem) {
      return
    }

    await nextTick()
    if (active.isConnected) {
      return
    }

    const focusedTerm = props.items.find(item => item.id === focusedTermId)
    if (contextId && focusedTerm) {
      if (sourceContextId) {
        termDetails.value?.focusHeading()
        return
      }
      const nextContext = focusedTerm.contexts[
        closestRemainingIndex(contextIndex, focusedTerm.contexts.length)
      ]
      if (nextContext) {
        termDetails.value?.focusContext(nextContext.id)
      }
      else {
        termDetails.value?.focusHeading()
      }
      return
    }

    const nextTerm = props.items[closestRemainingIndex(termIndex, props.items.length)]
    if (nextTerm) {
      termList.value?.focusTerm(nextTerm.id)
      return
    }
    if (props.totalCount === 0) {
      emptyHeading.value?.focus()
    }
    else {
      noResultsHeading.value?.focus()
    }
  },
)

function closestRemainingIndex(sourceIndex: number, remainingCount: number): number {
  return Math.min(Math.max(sourceIndex, 0), Math.max(remainingCount - 1, 0))
}
</script>

<template>
  <section
    ref="libraryRoot"
    class="vocabulary-library"
    aria-labelledby="vocabulary-library-heading"
  >
    <h2 id="vocabulary-library-heading" class="vocabulary-library__heading">
      本机收藏词
    </h2>

    <p v-if="props.status === 'loading'" class="vocabulary-library__state" role="status">
      正在读取此设备上的收藏词…
    </p>

    <div v-else-if="props.status === 'error'" class="vocabulary-library__state" role="alert">
      <p>{{ props.errorMessage || '收藏词暂时无法读取最新记录，请稍后重试。' }}</p>
      <button
        ref="retryButton"
        class="vocabulary-library__retry"
        type="button"
        @click="emit('retry')"
      >
        重试
      </button>
    </div>

    <template v-else>
      <VocabularySearch
        :model-value="props.query"
        :result-count="props.items.length"
        :total-count="props.totalCount"
        @update:model-value="emit('updateQuery', $event)"
      />

      <p v-if="props.actionErrorMessage" class="vocabulary-library__action-error" role="alert">
        {{ props.actionErrorMessage }}
      </p>

      <div v-if="props.totalCount === 0" class="vocabulary-library__state vocabulary-library__state--empty">
        <h3
          ref="emptyHeading"
          class="vocabulary-library__state-title"
          tabindex="-1"
        >
          还没有收藏词
        </h3>
        <p>阅读时打开词卡并选择收藏，单词与原句会显示在这里。</p>
        <RouterLink class="vocabulary-library__library-link" :to="{ name: 'library' }">
          去我的阅读
        </RouterLink>
      </div>

      <div
        v-else-if="props.items.length === 0"
        class="vocabulary-library__state vocabulary-library__state--empty"
        role="status"
      >
        <h3
          ref="noResultsHeading"
          class="vocabulary-library__state-title"
          tabindex="-1"
        >
          没有找到匹配的词
        </h3>
        <p>换一个规范词或展示词试试。</p>
      </div>

      <div v-else class="vocabulary-library__content">
        <VocabularyTermList
          ref="termList"
          :items="props.items"
          :selected-term-id="props.selectedItem?.id ?? null"
          @select-term="emit('selectTerm', $event)"
        />
        <VocabularyTermDetails
          v-if="props.selectedItem"
          ref="termDetails"
          :item="props.selectedItem"
          :pending-context-id="props.pendingContextId"
          :pending-term-id="props.pendingTermId"
          @remove-context="emit('removeContext', $event)"
          @delete-term="emit('deleteTerm', $event)"
          @open-source="emit('openSource', $event)"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.vocabulary-library {
  display: grid;
  gap: 1rem;
}

.vocabulary-library__heading {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.vocabulary-library__state {
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  line-height: 1.65;
}

.vocabulary-library__state p {
  margin: 0;
}

.vocabulary-library__state--empty {
  text-align: center;
}

.vocabulary-library__state-title {
  margin: 0 0 0.5rem;
  color: var(--text-primary);
  font-size: 1.1rem;
}

.vocabulary-library__retry,
.vocabulary-library__library-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  margin-block-start: 0.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: var(--surface-canvas);
  color: var(--text-accent);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.vocabulary-library__retry:focus-visible,
.vocabulary-library__library-link:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.vocabulary-library__action-error {
  margin: 0;
  border-inline-start: 3px solid var(--status-warning-border);
  padding-inline-start: 0.75rem;
  color: var(--text-danger, var(--text-primary));
  line-height: 1.6;
}

.vocabulary-library__content {
  display: grid;
  gap: 1rem;
}

@media (min-width: 768px) {
  .vocabulary-library__content {
    grid-template-columns: minmax(13rem, 0.75fr) minmax(0, 1.6fr);
    align-items: start;
  }
}
</style>
