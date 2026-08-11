<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue'
import { isNavigationFailure, useRouter } from 'vue-router'

import { usePlatformServices } from '@/app/platformServices'
import VocabularyLibraryPanel from '@/components/vocabulary/VocabularyLibraryPanel.vue'
import type {
  VocabularyContextAction,
  VocabularyLibraryFocusRequest,
  VocabularyLibraryFocusTarget,
  VocabularySourceLocation,
  VocabularyTermAction,
} from '@/features/vocabulary/types'
import { useVocabularyLibrary } from '@/features/vocabulary/useVocabularyLibrary'
import {
  deleteVocabularyTerm,
  removeVocabularyContext,
} from '@/features/vocabulary/vocabularyCommands'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const router = useRouter()
const { repositories } = usePlatformServices()
const {
  status,
  items,
  visibleItems,
  query,
  selectedItem,
  errorMessage,
  reload,
  selectTerm,
} = useVocabularyLibrary()
const pendingContextId = shallowRef<string | null>(null)
const pendingTermId = shallowRef<string | null>(null)
const actionErrorMessage = shallowRef('')
const focusRequest = shallowRef<VocabularyLibraryFocusRequest | null>(null)
let actionOperation: object | null = null
let viewUnmounted = false
let focusRequestId = 0

onUnmounted(() => {
  viewUnmounted = true
})

function handleRemoveContext(action: VocabularyContextAction): void {
  if (actionOperation) {
    return
  }
  const operation = {}
  const sourceTermIndex = visibleItems.value.findIndex(item => item.id === action.termId)
  const sourceContextIndex = visibleItems.value[sourceTermIndex]?.contexts
    .findIndex(context => context.id === action.contextId) ?? -1
  actionOperation = operation
  pendingContextId.value = action.contextId
  actionErrorMessage.value = ''
  void removeVocabularyContext(repositories, { contextId: action.contextId })
    .then(async () => {
      if (!viewUnmounted) {
        await reload()
        if (actionOperation === operation) {
          if (status.value === 'error') {
            requestFocus({ kind: 'retry' })
          }
          else if (status.value === 'ready') {
            focusAfterContextRemoval(action.termId, sourceContextIndex, sourceTermIndex)
          }
        }
      }
    })
    .catch(() => {
      if (!viewUnmounted && actionOperation === operation) {
        actionErrorMessage.value = '暂时无法删除这条收藏上下文，请稍后重试。'
        requestFocus({ kind: 'context', contextId: action.contextId })
      }
    })
    .finally(() => {
      if (actionOperation === operation) {
        actionOperation = null
        pendingContextId.value = null
      }
    })
}

function handleDeleteTerm(action: VocabularyTermAction): void {
  if (actionOperation) {
    return
  }
  const operation = {}
  const sourceTermIndex = visibleItems.value.findIndex(item => item.id === action.termId)
  actionOperation = operation
  pendingTermId.value = action.termId
  actionErrorMessage.value = ''
  void deleteVocabularyTerm(repositories, { termId: action.termId })
    .then(async () => {
      if (!viewUnmounted) {
        await reload()
        if (actionOperation === operation) {
          if (status.value === 'error') {
            requestFocus({ kind: 'retry' })
          }
          else if (status.value === 'ready') {
            focusAfterTermRemoval(sourceTermIndex)
          }
        }
      }
    })
    .catch(() => {
      if (!viewUnmounted && actionOperation === operation) {
        actionErrorMessage.value = '暂时无法取消收藏这个词条，请稍后重试。'
        requestFocus({ kind: 'term-delete' })
      }
    })
    .finally(() => {
      if (actionOperation === operation) {
        actionOperation = null
        pendingTermId.value = null
      }
    })
}

function focusAfterContextRemoval(
  termId: string,
  sourceContextIndex: number,
  sourceTermIndex: number,
): void {
  const updatedTerm = visibleItems.value.find(item => item.id === termId)
  if (updatedTerm) {
    const contextIndex = closestRemainingIndex(sourceContextIndex, updatedTerm.contexts.length)
    const context = updatedTerm.contexts[contextIndex]
    requestFocus(context
      ? { kind: 'context', contextId: context.id }
      : { kind: 'term-heading' })
    return
  }
  focusAfterTermRemoval(sourceTermIndex)
}

function focusAfterTermRemoval(sourceTermIndex: number): void {
  const termIndex = closestRemainingIndex(sourceTermIndex, visibleItems.value.length)
  const term = visibleItems.value[termIndex]
  if (term) {
    selectTerm(term.id)
    requestFocus({ kind: 'term', termId: term.id })
    return
  }
  requestFocus({ kind: items.value.length === 0 ? 'empty' : 'no-results' })
}

function closestRemainingIndex(sourceIndex: number, remainingCount: number): number {
  return Math.min(Math.max(sourceIndex, 0), Math.max(remainingCount - 1, 0))
}

function requestFocus(target: VocabularyLibraryFocusTarget): void {
  focusRequest.value = { id: ++focusRequestId, target }
}

function handleRetry(): void {
  if (actionOperation) {
    return
  }
  const operation = {}
  actionOperation = operation
  actionErrorMessage.value = ''
  void reload().then(() => {
    if (viewUnmounted || actionOperation !== operation) {
      return
    }
    if (status.value === 'error') {
      requestFocus({ kind: 'retry' })
      return
    }
    if (status.value !== 'ready') {
      return
    }
    const selected = selectedItem.value
    requestFocus(selected
      ? { kind: 'term', termId: selected.id }
      : { kind: items.value.length === 0 ? 'empty' : 'no-results' })
  }).finally(() => {
    if (actionOperation === operation) {
      actionOperation = null
    }
  })
}

function handleOpenSource(location: VocabularySourceLocation): void {
  actionErrorMessage.value = ''
  void router.push({
    name: 'reader',
    params: { articleId: location.articleId },
    query: { sentence: location.sentenceId },
  }).then((failure) => {
    if (failure && isNavigationFailure(failure) && !viewUnmounted) {
      actionErrorMessage.value = '暂时无法打开这条来源原句，请重试。'
    }
  }).catch(() => {
    if (!viewUnmounted) {
      actionErrorMessage.value = '暂时无法打开这条来源原句，请重试。'
    }
  })
}

usePageHeadingFocus()
</script>

<template>
  <div class="vocabulary-view">
    <h1 ref="pageHeading" class="vocabulary-view__title" data-page-heading tabindex="-1">
      收藏词
    </h1>
    <VocabularyLibraryPanel
      :status="status"
      :items="visibleItems"
      :total-count="items.length"
      :query="query"
      :selected-item="selectedItem"
      :error-message="errorMessage"
      :action-error-message="actionErrorMessage"
      :pending-context-id="pendingContextId"
      :pending-term-id="pendingTermId"
      :focus-request="focusRequest"
      @update-query="query = $event"
      @select-term="selectTerm"
      @remove-context="handleRemoveContext"
      @delete-term="handleDeleteTerm"
      @open-source="handleOpenSource"
      @retry="handleRetry"
    />
  </div>
</template>

<style scoped>
.vocabulary-view {
  max-inline-size: 64rem;
  margin-inline: auto;
}

.vocabulary-view__title {
  margin: 0 0 1.5rem;
  color: var(--text-primary);
  font-size: clamp(1.8rem, 5vw, 2.5rem);
  letter-spacing: -0.035em;
}

.vocabulary-view__title:focus {
  outline: 0;
}
</style>
