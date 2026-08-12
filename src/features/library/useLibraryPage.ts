import {
  onMounted,
  onScopeDispose,
  shallowReadonly,
  shallowRef,
} from 'vue'

import { usePlatformServices } from '@/app/platformServices'
import { recoverPendingArticleDeletions } from './articleDeletion'
import { createLibraryViewModel, type LibraryViewModel } from './libraryViewModel'

export type LibraryLoadStatus = 'loading' | 'ready' | 'error'

export function useLibraryPage() {
  const services = usePlatformServices()
  const status = shallowRef<LibraryLoadStatus>('loading')
  const library = shallowRef<LibraryViewModel>({
    articles: [],
    continueReading: null,
  })
  const errorMessage = shallowRef('')
  const ignoredRecordCount = shallowRef(0)
  const persistenceAvailable = services.repositories.persistence === 'persistent'
    && services.capabilities.localPersistence.availability === 'available'
  let loadVersion = 0
  let currentLoadVersion: number | null = null
  let lifecycleRefreshPending = false
  let retiredJournalCleanupPromise: Promise<void> | null = null
  const unsubscribeLifecycle = services.lifecycle.subscribe((event) => {
    if (event.state === 'active') {
      void refreshFromLifecycle()
    }
  })

  async function reload(): Promise<boolean> {
    return loadLibrary(false)
  }

  async function refresh(): Promise<boolean> {
    return loadLibrary(true)
  }

  async function refreshFromLifecycle(): Promise<void> {
    if (currentLoadVersion !== null) {
      lifecycleRefreshPending = true
      return
    }
    if (status.value !== 'ready') {
      return
    }
    await loadLibrary(true)
  }

  async function loadLibrary(silent: boolean): Promise<boolean> {
    scheduleRetiredJournalCleanup()
    const preserveReadySnapshot = silent && status.value === 'ready'
    const version = ++loadVersion
    currentLoadVersion = version
    if (!preserveReadySnapshot) {
      status.value = 'loading'
    }
    errorMessage.value = ''
    try {
      const [articles, attempts, diagnostics] = await Promise.all([
        services.repositories.articles.list(),
        services.repositories.attempts.list(),
        services.repositories.diagnose(),
      ])
      if (version !== loadVersion) {
        return false
      }
      library.value = createLibraryViewModel(articles, attempts)
      ignoredRecordCount.value = diagnostics.issues
        .filter(issue => issue.code === 'invalid-record' || issue.code === 'read-failed')
        .length
      status.value = 'ready'
      return true
    }
    catch {
      if (version !== loadVersion || preserveReadySnapshot) {
        return false
      }
      status.value = 'error'
      errorMessage.value = '阅读库暂时无法读取。你可以重试；Yomu 不会清空现有内容。'
      return false
    }
    finally {
      if (currentLoadVersion === version) {
        currentLoadVersion = null
      }
      if (version === loadVersion && lifecycleRefreshPending) {
        lifecycleRefreshPending = false
        if (status.value === 'ready') {
          void loadLibrary(true)
        }
      }
    }
  }

  function scheduleRetiredJournalCleanup(): void {
    if (retiredJournalCleanupPromise) {
      return
    }
    retiredJournalCleanupPromise = recoverPendingArticleDeletions(
      services,
    ).then((recoveredArticleIds) => {
      if (recoveredArticleIds.length === 0) {
        return
      }
      if (currentLoadVersion !== null) {
        lifecycleRefreshPending = true
      }
      else if (status.value === 'ready') {
        void loadLibrary(true)
      }
    }).catch(() => {}).finally(() => {
      retiredJournalCleanupPromise = null
    })
  }

  onMounted(() => {
    void reload()
  })
  onScopeDispose(() => {
    loadVersion += 1
    currentLoadVersion = null
    lifecycleRefreshPending = false
    unsubscribeLifecycle()
  })

  return {
    status: shallowReadonly(status),
    library: shallowReadonly(library),
    errorMessage: shallowReadonly(errorMessage),
    ignoredRecordCount: shallowReadonly(ignoredRecordCount),
    persistenceAvailable,
    reload,
    refresh,
  }
}
