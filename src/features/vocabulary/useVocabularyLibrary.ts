import {
  computed,
  onScopeDispose,
  shallowReadonly,
  shallowRef,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import { normalizeVocabularyTerm } from './normalizeVocabularyTerm'
import type { VocabularyListItem } from './types'
import {
  listVocabulary,
  type VocabularySnapshot,
} from './vocabularyQueries'

export type VocabularyLibraryStatus = 'loading' | 'ready' | 'error'

export function toVocabularyListItems(
  snapshot: VocabularySnapshot,
): readonly VocabularyListItem[] {
  return snapshot.entries.map(({ term, contexts, unavailableContextCount }) => ({
    id: term.id,
    normalizedTerm: term.normalizedTerm,
    displayTerm: term.displayTerm,
    meaning: term.meaning,
    savedAt: term.savedAt,
    updatedAt: term.updatedAt,
    unavailableContextCount,
    contexts: contexts.map(({ context, article }) => ({
      id: context.id,
      articleId: article.id,
      articleTitle: article.title,
      articleSourceLabel: article.source.label,
      sentenceId: context.sentenceId,
      sentenceText: context.sentenceText,
      displayTerm: context.displayTerm,
      savedAt: context.savedAt,
    })),
  }))
}

export function vocabularyItemsForArticle(
  items: readonly VocabularyListItem[],
  articleId: string,
): readonly VocabularyListItem[] {
  return items.flatMap((item): VocabularyListItem[] => {
    const contexts = item.contexts.filter(context => context.articleId === articleId)
    return contexts.length > 0 ? [{ ...item, contexts }] : []
  })
}

export function useVocabularyLibrary() {
  const { lifecycle, repositories } = usePlatformServices()
  const status = shallowRef<VocabularyLibraryStatus>('loading')
  const items = shallowRef<readonly VocabularyListItem[]>([])
  const query = shallowRef('')
  const selectedTermId = shallowRef<string | null>(null)
  const errorMessage = shallowRef('')
  let loadVersion = 0
  let currentLoadVersion: number | null = null
  let lifecycleRefreshPending = false

  const visibleItems = computed(() => {
    const normalizedQuery = normalizeVocabularyTerm(query.value)
    if (!normalizedQuery) {
      return items.value
    }
    return items.value.filter(item =>
      item.normalizedTerm.includes(normalizedQuery)
      || normalizeVocabularyTerm(item.displayTerm).includes(normalizedQuery))
  })
  const selectedItem = computed(() =>
    visibleItems.value.find(item => item.id === selectedTermId.value)
    ?? visibleItems.value[0]
    ?? null)
  const unsubscribeLifecycle = lifecycle.subscribe((event) => {
    if (event.state === 'active') {
      void refreshFromLifecycle()
    }
  })

  onScopeDispose(() => {
    loadVersion += 1
    currentLoadVersion = null
    lifecycleRefreshPending = false
    unsubscribeLifecycle()
  })

  void reload()

  async function reload(): Promise<void> {
    await loadVocabulary(false)
  }

  async function refreshFromLifecycle(): Promise<void> {
    if (currentLoadVersion !== null) {
      lifecycleRefreshPending = true
      return
    }
    if (status.value !== 'ready') {
      return
    }
    await loadVocabulary(true)
  }

  async function loadVocabulary(silent: boolean): Promise<void> {
    const preserveReadySnapshot = silent && status.value === 'ready'
    const version = ++loadVersion
    currentLoadVersion = version
    if (!preserveReadySnapshot) {
      status.value = 'loading'
    }
    errorMessage.value = ''
    try {
      const snapshot = await listVocabulary(repositories)
      if (version !== loadVersion) {
        return
      }
      items.value = toVocabularyListItems(snapshot)
      const selectionStillExists = items.value.some(item => item.id === selectedTermId.value)
      if (!selectionStillExists) {
        selectedTermId.value = items.value[0]?.id ?? null
      }
      status.value = 'ready'
    }
    catch {
      if (version !== loadVersion) {
        return
      }
      if (preserveReadySnapshot) {
        return
      }
      status.value = 'error'
      errorMessage.value = '收藏词暂时无法读取最新记录，请稍后重试。'
    }
    finally {
      if (currentLoadVersion === version) {
        currentLoadVersion = null
      }
      if (version === loadVersion && lifecycleRefreshPending) {
        lifecycleRefreshPending = false
        if (status.value === 'ready') {
          void loadVocabulary(true)
        }
      }
    }
  }

  function selectTerm(termId: string): void {
    if (visibleItems.value.some(item => item.id === termId)) {
      selectedTermId.value = termId
    }
  }

  return {
    status: shallowReadonly(status),
    items: shallowReadonly(items),
    visibleItems,
    query,
    selectedTermId: shallowReadonly(selectedTermId),
    selectedItem,
    errorMessage: shallowReadonly(errorMessage),
    reload,
    selectTerm,
  }
}
