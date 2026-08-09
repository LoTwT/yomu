import {
  onMounted,
  onUnmounted,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'

import { useInteractionLayer } from '@/app/interactionLayer'
import { getRouteLeaveCoordinator } from '@/app/routeLeaveCoordinator'

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
  const interactionLayer = useInteractionLayer()
  const router = useRouter()
  const routeLeaveCoordinator = getRouteLeaveCoordinator(router)
  const guardedRecord = router.currentRoute.value.matched.at(-1)
  let guardedOrigin = router.currentRoute.value.fullPath
  const isConfirming = shallowRef(false)
  const beforeUnloadTarget = options.beforeUnloadTarget === undefined
    ? resolveBeforeUnloadTarget()
    : options.beforeUnloadTarget
  const handleBeforeUnload = createUnsavedImportBeforeUnloadHandler(() => toValue(isDirty))
  let pendingDecision: Promise<boolean> | null = null
  let resolveDecision: ((allowNavigation: boolean) => void) | null = null
  let settlementSerial = 0
  watch(router.currentRoute, (route) => {
    if (guardedRecord && route.matched.includes(guardedRecord)) {
      guardedOrigin = route.fullPath
    }
  }, { flush: 'sync' })
  const unregisterRouteBlocker = routeLeaveCoordinator.registerBlocker({
    hasPendingDecision: () => pendingDecision !== null,
    onSecondaryPop: () => {
      interactionLayer.requestCloseTop('navigation')
    },
    origin: () => guardedOrigin,
    shouldBlock: () => toValue(isDirty),
  })

  onBeforeRouteLeave((to, from) => {
    if (routeLeaveCoordinator.allowsConcurrentNavigation(to, from)) {
      return true
    }
    if (routeLeaveCoordinator.blocksConcurrentNavigation()) {
      return false
    }
    if (!toValue(isDirty)) {
      return true
    }
    if (pendingDecision) {
      const currentDecision = pendingDecision
      interactionLayer.requestCloseTop('navigation')
      return currentDecision
    }
    if (interactionLayer.requestCloseTop('navigation')) {
      return false
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
    unregisterRouteBlocker()
    void settle(false)
  })

  function keepEditing(): void {
    void settle(false)
  }

  function discardAndLeave(): void {
    void settle(true)
  }

  async function settle(allowNavigation: boolean): Promise<void> {
    const serial = ++settlementSerial
    const resolve = resolveDecision
    isConfirming.value = false
    await routeLeaveCoordinator.settleDecision(allowNavigation)
    if (serial !== settlementSerial || resolve !== resolveDecision) {
      return
    }
    resolveDecision = null
    pendingDecision = null
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
