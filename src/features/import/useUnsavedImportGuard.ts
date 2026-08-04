import {
  onMounted,
  onUnmounted,
  shallowReadonly,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

interface BeforeUnloadTarget {
  addEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void
  removeEventListener: (type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void) => void
}

export interface UnsavedImportGuardOptions {
  beforeUnloadTarget?: BeforeUnloadTarget | null
}

export function createUnsavedImportBeforeUnloadHandler(
  isDirty: () => boolean,
): (event: BeforeUnloadEvent) => void {
  return (event) => {
    if (!isDirty()) {
      return
    }
    event.preventDefault()
    event.returnValue = ''
  }
}

export function useUnsavedImportGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  options: UnsavedImportGuardOptions = {},
) {
  const isConfirming = shallowRef(false)
  const beforeUnloadTarget = options.beforeUnloadTarget === undefined
    ? resolveBeforeUnloadTarget()
    : options.beforeUnloadTarget
  const handleBeforeUnload = createUnsavedImportBeforeUnloadHandler(() => toValue(isDirty))
  let pendingDecision: Promise<boolean> | null = null
  let resolveDecision: ((allowNavigation: boolean) => void) | null = null

  onBeforeRouteLeave(() => {
    if (!toValue(isDirty)) {
      return true
    }
    if (pendingDecision) {
      return pendingDecision
    }
    isConfirming.value = true
    pendingDecision = new Promise<boolean>((resolve) => {
      resolveDecision = resolve
    })
    return pendingDecision
  })

  onMounted(() => beforeUnloadTarget?.addEventListener('beforeunload', handleBeforeUnload))
  onUnmounted(() => {
    beforeUnloadTarget?.removeEventListener('beforeunload', handleBeforeUnload)
    settle(false)
  })

  function keepEditing(): void {
    settle(false)
  }

  function discardAndLeave(): void {
    settle(true)
  }

  function settle(allowNavigation: boolean): void {
    const resolve = resolveDecision
    resolveDecision = null
    pendingDecision = null
    isConfirming.value = false
    resolve?.(allowNavigation)
  }

  return {
    isConfirming: shallowReadonly(isConfirming),
    keepEditing,
    discardAndLeave,
  }
}

function resolveBeforeUnloadTarget(): BeforeUnloadTarget | null {
  const target = globalThis as typeof globalThis & Partial<BeforeUnloadTarget>
  return typeof target.addEventListener === 'function'
    && typeof target.removeEventListener === 'function'
    ? target as BeforeUnloadTarget
    : null
}
