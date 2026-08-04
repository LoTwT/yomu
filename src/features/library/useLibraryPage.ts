import { onMounted, shallowReadonly, shallowRef } from 'vue'

import { usePlatformServices } from '@/app/platformServices'
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

  async function reload(): Promise<void> {
    status.value = 'loading'
    errorMessage.value = ''
    try {
      const [articles, attempts, diagnostics] = await Promise.all([
        services.repositories.articles.list(),
        services.repositories.attempts.list(),
        services.repositories.diagnose(),
      ])
      library.value = createLibraryViewModel(articles, attempts)
      ignoredRecordCount.value = diagnostics.issues
        .filter(issue => issue.code === 'invalid-record' || issue.code === 'read-failed')
        .length
      status.value = 'ready'
    }
    catch {
      status.value = 'error'
      errorMessage.value = '阅读库暂时无法读取。你可以重试；Yomu 不会清空现有内容。'
    }
  }

  onMounted(reload)

  return {
    status: shallowReadonly(status),
    library: shallowReadonly(library),
    errorMessage: shallowReadonly(errorMessage),
    ignoredRecordCount: shallowReadonly(ignoredRecordCount),
    persistenceAvailable,
    reload,
  }
}
