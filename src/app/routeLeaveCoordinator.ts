import { nextTick } from 'vue'
import {
  isNavigationFailure,
  NavigationFailureType,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type Router,
  type RouterHistory,
} from 'vue-router'

type HistoryListener = Parameters<RouterHistory['listen']>[0]
type HistoryNavigationInformation = Parameters<HistoryListener>[2]

export interface RouteLeaveBlocker {
  hasPendingDecision: () => boolean
  onSecondaryPop: () => void
  origin: () => string
  shouldBlock: () => boolean
}

export interface RouteHistoryLayerRegistration {
  id: string
  onActivate: () => void
  onDeactivate: () => void
  origin: () => string
}

export interface RouteHistoryLayerController {
  activate: () => boolean
  deactivate: () => Promise<void>
  dispose: () => void
}

export interface RouteLeaveCoordinator {
  allowsConcurrentNavigation: (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
  ) => boolean
  attachRouter: (router: Router) => void
  blocksConcurrentNavigation: () => boolean
  registerBlocker: (blocker: RouteLeaveBlocker) => () => void
  registerHistoryLayer: (
    registration: RouteHistoryLayerRegistration,
  ) => RouteHistoryLayerController
  settleDecision: (allowNavigation: boolean) => Promise<void>
}

interface HistoryAnchor {
  location: string
  position: number | null
}

interface BlockerRegistration extends RouteLeaveBlocker {
  token: symbol
}

interface RouteHistoryLayerMarker {
  basePosition: number | null
  id: string
  nonce: number
  origin: string
  version: 1
}

interface RouteHistoryLayerRegistrationState extends RouteHistoryLayerRegistration {
  closePromise: Promise<void> | null
  disposed: boolean
  marker: RouteHistoryLayerMarker | null
  notifyOnDeactivate: boolean
  phase: 'closed' | 'closing' | 'open'
  resolveClose: (() => void) | null
  token: symbol
}

interface PopFence {
  cumulativeDelta: number
  desired: HistoryAnchor
  firstDestination: HistoryAnchor
  forwarded: boolean
  generation: number
  origin: HistoryAnchor
  ownerToken: symbol
  phase: 'committed' | 'decision' | 'navigation' | 'rollback'
  permittedDestination: string | null
  repairRequested: boolean
  rootNavigation: object | null
  restorePromise: Promise<boolean> | null
  secondaryCloseRequested: boolean
  token: symbol
}

interface SilentTraversal {
  targetPosition: number
}

interface NavigationOwnership {
  fenceToken: symbol
  generation: number
}

interface PendingHistoryLayerArrival {
  delta: number
  marker: RouteHistoryLayerMarker
  navigation: object | null
  origin: HistoryAnchor
  replacementRequested: boolean
  token: symbol
}

const coordinators = new WeakMap<Router, RouteLeaveCoordinator>()
const routeHistoryLayerStateKey = '__yomuRouteHistoryLayer'

/**
 * Serializes native history movement around an async leave decision. The first
 * pop remains Vue Router's own navigation; later pops are either restored while
 * the decision is open or rebased to the guarded route once navigation resumes.
 */
export function createCoordinatedRouterHistory(sourceHistory: RouterHistory): {
  coordinator: RouteLeaveCoordinator
  history: RouterHistory
} {
  const listeners = new Set<HistoryListener>()
  const blockers: BlockerRegistration[] = []
  const historyLayers: RouteHistoryLayerRegistrationState[] = []
  const usesNativeHistoryPositions = isHistoryPosition(sourceHistory.state.position)
  let activeFence: PopFence | null = null
  let attachedRouter: Router | null = null
  let fallbackHistoryPosition = 0
  let fallbackHistoryUpperBound = 0
  let fallbackTraversalOrigin: number | null = null
  let historyChangeSerial = 0
  let historyLayerNonce = 0
  const historyChangeWaiters = new Set<() => void>()
  const navigationOwnership = new WeakMap<object, NavigationOwnership>()
  let pendingHistoryLayerArrival: PendingHistoryLayerArrival | null = null
  let pendingSilentTraversal: SilentTraversal | null = null
  let removeBeforeEach: (() => void) | null = null
  let removeAfterEach: (() => void) | null = null
  let removeRouterError: (() => void) | null = null

  const removeSourceListener = sourceHistory.listen((to, from, information) => {
    information = normalizeHistoryInformation(information)
    const silentTraversal = pendingSilentTraversal
    if (silentTraversal
      && readNativeHistoryPosition() === silentTraversal.targetPosition) {
      pendingSilentTraversal = null
      returnClosingHistoryLayerToBase()
      signalHistoryChange()
      return
    }
    if (silentTraversal) {
      // Classic History traversal commands have no completion handle and can
      // be superseded by a later user traversal (notably in WebKit). An event
      // at any other position proves this command is no longer the next
      // observable repair, so recompute from the position that actually won.
      pendingSilentTraversal = null
      signalHistoryChange()
    }
    if (handleHistoryLayerTraversal(to, from, information)) {
      signalHistoryChange()
      return
    }

    if (activeFence?.phase === 'committed') {
      suppressPop(activeFence, information, false)
      signalHistoryChange()
      return
    }

    try {
      if (activeFence?.phase === 'rollback'
        && popDepartedFromAnchor(activeFence.desired, from, information)) {
        activeFence = null
      }
      const blocker = activeFence
        ? blockers.find(candidate => candidate.token === activeFence?.ownerToken)
        : blockers.at(-1)
      const protectsOrigin = blocker?.shouldBlock() === true
        && blocker.origin() === (activeFence?.origin.location ?? from)

      if (activeFence?.phase === 'navigation' && protectsOrigin) {
        // The browser has already moved again while the first target is pending.
        // Rebase its delta so Vue Router can cancel the old navigation and repair
        // all the way back to the route it still renders if this one fails.
        forwardRebasedPop(activeFence, to, information)
        return
      }

      if (activeFence && protectsOrigin) {
        suppressPop(activeFence, information, blocker?.hasPendingDecision() === true)
        return
      }

      if (blocker?.shouldBlock() === true && blocker.origin() === from) {
        const destination = readAnchor(to)
        const origin: HistoryAnchor = {
          location: from,
          position: destination.position === null
            ? null
            : destination.position - information.delta,
        }

        if (blocker.hasPendingDecision()) {
          const fence = createFence(origin, origin, false, blocker.token, 0)
          activeFence = fence
          suppressPop(fence, information, true)
          return
        }

        activeFence = createFence(
          origin,
          destination,
          true,
          blocker.token,
          information.delta,
        )
      }

      listeners.forEach(listener => listener(to, from, information))
    }
    finally {
      signalHistoryChange()
    }
  })

  const history: RouterHistory = {
    get base() {
      return sourceHistory.base
    },
    get location() {
      return sourceHistory.location
    },
    get state() {
      return sourceHistory.state
    },
    createHref: location => sourceHistory.createHref(location),
    destroy() {
      removeBeforeEach?.()
      removeAfterEach?.()
      removeRouterError?.()
      removeSourceListener()
      listeners.clear()
      activeFence = null
      pendingHistoryLayerArrival = null
      pendingSilentTraversal = null
      blockers.length = 0
      historyLayers.splice(0).forEach((layer) => {
        layer.disposed = true
        finishHistoryLayerClose(layer, false)
      })
      signalHistoryChange()
      sourceHistory.destroy()
    },
    go: moveHistory,
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push(to, data) {
      sourceHistory.push(to, data)
      if (!usesNativeHistoryPositions) {
        fallbackHistoryPosition += 1
        fallbackHistoryUpperBound = fallbackHistoryPosition
      }
      recordFenceHistoryMutation(to)
    },
    replace(to, data) {
      sourceHistory.replace(to, data)
      recordFenceHistoryMutation(to)
    },
  }

  const coordinator: RouteLeaveCoordinator = {
    allowsConcurrentNavigation(to, from) {
      const fence = activeFence
      if (!fence
        || (fence.phase !== 'decision' && fence.phase !== 'navigation')
        || fence.origin.location !== from.fullPath
        || !claimFenceNavigation(fence, to)) {
        return false
      }
      return fence.phase === 'navigation'
    },
    attachRouter(router) {
      if (attachedRouter && attachedRouter !== router) {
        throw new Error('RouteLeaveCoordinator is already attached to another router.')
      }
      if (attachedRouter) {
        return
      }
      attachedRouter = router
      removeBeforeEach = router.beforeEach(async (to, from) => {
        const historyLayerRedirect = claimPendingHistoryLayerNavigation(to, from)
        const closingLayer = historyLayers.find(layer => layer.phase === 'closing')
        if (closingLayer?.closePromise) {
          await closingLayer.closePromise
        }
        const fence = activeFence
        if (!fence) {
          return historyLayerRedirect ?? true
        }
        if (fence.phase === 'navigation'
          && pendingSilentTraversal
          && claimFenceNavigation(fence, to)) {
          await restoreFence(fence)
          return historyLayerRedirect ?? true
        }
        if (fence.phase !== 'committed') {
          return historyLayerRedirect ?? true
        }
        const stable = await restoreFence(fence)
        if (stable && activeFence?.token === fence.token && fence.phase === 'committed') {
          clearFence(fence)
        }
        return historyLayerRedirect ?? true
      })
      removeAfterEach = router.afterEach((to, from, failure) => {
        settlePendingHistoryLayerNavigation(to, failure === undefined)
        const fence = activeFence
        if (!fence) {
          return
        }
        if (isStaleFenceNavigation(fence, to)) {
          void restoreFence(fence)
          return
        }
        if (!isCurrentFenceNavigation(fence, to)
          && (from.fullPath !== fence.origin.location || !claimFenceNavigation(fence, to))) {
          return
        }
        if (failure === undefined) {
          fence.desired = {
            ...fence.desired,
            location: to.fullPath,
          }
          settleCommittedFence(fence)
          return
        }
        fence.phase = 'rollback'
        fence.desired = fence.origin
        releaseFenceWhenStable(
          fence,
          isNavigationFailure(failure, NavigationFailureType.cancelled)
          || isRedirectedFenceNavigation(fence, to),
        )
      })
      removeRouterError = router.onError((_error, to, from) => {
        settlePendingHistoryLayerNavigation(to, false)
        const fence = activeFence
        if (!fence) {
          return
        }
        if (isStaleFenceNavigation(fence, to)) {
          void restoreFence(fence)
          return
        }
        if (!isCurrentFenceNavigation(fence, to)
          && (from.fullPath !== fence.origin.location || !claimFenceNavigation(fence, to))) {
          return
        }
        fence.phase = 'rollback'
        fence.desired = fence.origin
        releaseFenceWhenStable(fence, isRedirectedFenceNavigation(fence, to))
      })
    },
    blocksConcurrentNavigation() {
      return activeFence?.phase === 'navigation'
    },
    registerBlocker(blocker) {
      const registration: BlockerRegistration = {
        ...blocker,
        token: Symbol('route-leave-blocker'),
      }
      blockers.push(registration)
      return () => {
        const index = blockers.findIndex(candidate => candidate.token === registration.token)
        if (index >= 0) {
          blockers.splice(index, 1)
        }
        if (activeFence?.ownerToken === registration.token) {
          if (activeFence.phase !== 'committed') {
            activeFence = null
            signalHistoryChange()
          }
        }
      }
    },
    registerHistoryLayer(registration) {
      if (!registration.id.trim()) {
        throw new Error('Route history layer id must not be empty.')
      }
      const layer: RouteHistoryLayerRegistrationState = {
        ...registration,
        closePromise: null,
        disposed: false,
        marker: null,
        notifyOnDeactivate: true,
        phase: 'closed',
        resolveClose: null,
        token: Symbol(`route-history-layer:${registration.id}`),
      }
      historyLayers.push(layer)
      adoptCurrentHistoryLayer(layer)

      return {
        activate: () => activateHistoryLayer(layer),
        deactivate: () => deactivateHistoryLayer(layer),
        dispose: () => disposeHistoryLayer(layer),
      }
    },
    async settleDecision(allowNavigation) {
      const fence = activeFence
      if (!fence) {
        return
      }
      await restoreFence(fence)
      if (activeFence?.token !== fence.token) {
        return
      }
      if (allowNavigation) {
        fence.phase = 'navigation'
        fence.desired = fence.firstDestination
        fence.permittedDestination ??= fence.firstDestination.location
        return
      }
      fence.phase = 'rollback'
      fence.desired = fence.origin
    },
  }

  function activateHistoryLayer(layer: RouteHistoryLayerRegistrationState): boolean {
    if (layer.disposed || layer.phase === 'closing') {
      return false
    }
    if (layer.phase === 'open') {
      return true
    }
    if (historyLayers.some(candidate => candidate !== layer && candidate.phase !== 'closed')) {
      return false
    }

    const origin = layer.origin()
    if (sourceHistory.location !== origin) {
      return false
    }
    const currentMarker = readCurrentHistoryLayerMarker()
    if (currentMarker && historyLayerMarkerBelongsTo(layer, currentMarker)) {
      layer.marker = currentMarker
      layer.phase = 'open'
      layer.onActivate()
      return true
    }

    const marker: RouteHistoryLayerMarker = {
      basePosition: readHistoryPosition(),
      id: layer.id,
      nonce: ++historyLayerNonce,
      origin,
      version: 1,
    }
    layer.marker = marker
    history.push(origin, {
      [routeHistoryLayerStateKey]: { ...marker },
    })
    layer.phase = 'open'
    layer.onActivate()
    return true
  }

  function deactivateHistoryLayer(
    layer: RouteHistoryLayerRegistrationState,
  ): Promise<void> {
    if (layer.phase === 'closed') {
      if (layer.marker && !canReopenHistoryLayerFromCurrentBase(layer, layer.marker)) {
        layer.marker = null
      }
      return Promise.resolve()
    }
    if (layer.closePromise) {
      return layer.closePromise
    }

    layer.phase = 'closing'
    layer.closePromise = new Promise<void>((resolve) => {
      layer.resolveClose = resolve
    })
    const closePromise = layer.closePromise
    const marker = layer.marker
    const currentMarker = readCurrentHistoryLayerMarker()
    if (!marker
      || !currentMarker
      || !historyLayerMarkersMatch(marker, currentMarker)
      || sourceHistory.location !== marker.origin) {
      if (marker
        && canReopenHistoryLayerFromCurrentBase(layer, marker)
        && pendingTraversalTargetsHistoryLayerMarker(marker)) {
        return closePromise
      }
      if (marker && !canReopenHistoryLayerFromCurrentBase(layer, marker)) {
        layer.marker = null
      }
      finishHistoryLayerClose(layer, true)
      return closePromise
    }

    const currentPosition = readHistoryPosition()
    const delta = marker.basePosition !== null && currentPosition !== null
      ? marker.basePosition - currentPosition
      : -1
    if (delta === 0) {
      finishHistoryLayerClose(layer, true)
    }
    else {
      moveHistory(delta, true)
    }
    return closePromise
  }

  function disposeHistoryLayer(layer: RouteHistoryLayerRegistrationState): void {
    if (layer.disposed) {
      return
    }
    layer.notifyOnDeactivate = false
    const marker = layer.marker
    const currentMarker = readCurrentHistoryLayerMarker()
    if (layer.phase !== 'closed'
      && marker
      && currentMarker
      && historyLayerMarkersMatch(marker, currentMarker)
      && sourceHistory.location === marker.origin) {
      void deactivateHistoryLayer(layer).finally(() => removeHistoryLayer(layer))
      return
    }
    finishHistoryLayerClose(layer, false)
    removeHistoryLayer(layer)
  }

  function removeHistoryLayer(layer: RouteHistoryLayerRegistrationState): void {
    layer.disposed = true
    const index = historyLayers.findIndex(candidate => candidate.token === layer.token)
    if (index >= 0) {
      historyLayers.splice(index, 1)
    }
  }

  function finishHistoryLayerClose(
    layer: RouteHistoryLayerRegistrationState,
    notify: boolean,
  ): void {
    const wasClosed = layer.phase === 'closed'
    layer.phase = 'closed'
    const resolveClose = layer.resolveClose
    layer.resolveClose = null
    layer.closePromise = null
    resolveClose?.()
    if (!wasClosed && notify && layer.notifyOnDeactivate && !layer.disposed) {
      layer.onDeactivate()
    }
  }

  function adoptCurrentHistoryLayer(layer: RouteHistoryLayerRegistrationState): void {
    if (layer.disposed || layer.phase !== 'closed') {
      return
    }
    const marker = readCurrentHistoryLayerMarker()
    if (!marker
      || sourceHistory.location !== layer.origin()
      || !historyLayerMarkerBelongsTo(layer, marker)
      || historyLayers.some(candidate => candidate !== layer && candidate.phase !== 'closed')) {
      return
    }
    historyLayerNonce = Math.max(historyLayerNonce, marker.nonce)
    if (!usesNativeHistoryPositions && marker.basePosition !== null) {
      fallbackHistoryPosition = marker.basePosition + 1
      fallbackHistoryUpperBound = Math.max(
        fallbackHistoryUpperBound,
        fallbackHistoryPosition,
      )
    }
    layer.marker = marker
    layer.phase = 'open'
    clearPendingHistoryLayerArrival(marker)
    layer.onActivate()
  }

  function handleHistoryLayerTraversal(
    to: string,
    from: string,
    information: HistoryNavigationInformation,
  ): boolean {
    const closingLayer = historyLayers.find(layer => layer.phase === 'closing')
    if (closingLayer?.marker
      && to === closingLayer.marker.origin
      && isAtHistoryLayerBase(closingLayer.marker)) {
      finishHistoryLayerClose(closingLayer, true)
      if (closingLayer.disposed) {
        removeHistoryLayer(closingLayer)
      }
      return true
    }

    const marker = readCurrentHistoryLayerMarker()
    if (!marker) {
      return false
    }
    const layer = historyLayers.find(candidate =>
      !candidate.disposed
      && candidate.phase === 'closed'
      && (candidate.marker === null || historyLayerMarkersMatch(candidate.marker, marker))
      && historyLayerMarkerBelongsTo(candidate, marker),
    )
    const isForwardToMarker = to === marker.origin && information.delta > 0
    if (layer && isForwardToMarker) {
      layer.marker = marker
      layer.phase = 'open'
      clearPendingHistoryLayerArrival(marker)
      layer.onActivate()
      return true
    }
    if (!layer && isForwardToMarker) {
      const markerPosition = readHistoryPosition()
      pendingHistoryLayerArrival = {
        delta: information.delta,
        marker,
        navigation: null,
        origin: {
          location: from,
          position: markerPosition === null
            ? null
            : markerPosition - information.delta,
        },
        replacementRequested: false,
        token: Symbol('pending-route-history-layer-arrival'),
      }
      return false
    }
    stripCurrentHistoryLayerMarker(to, marker)
    return false
  }

  function claimPendingHistoryLayerNavigation(
    destination: RouteLocationNormalized,
    origin: RouteLocationNormalized,
  ): RouteLocationRaw | null {
    const pending = pendingHistoryLayerArrival
    if (!pending || origin.fullPath !== pending.origin.location) {
      return null
    }
    if (pending.navigation) {
      if (!navigationDescendsFrom(destination, pending.navigation)
        && currentHistoryLayerMarkerMatches(pending.marker)) {
        pending.navigation = destination
        pending.replacementRequested = true
        return historyLayerReplacementLocation(pending, destination)
      }
      return historyLayerRedirectReplacement(pending, destination)
    }

    let candidate:
      | RouteLocationNormalized
      | NonNullable<RouteLocationNormalized['redirectedFrom']>
      | undefined = destination
    const visited = new Set<object>()
    while (candidate && !visited.has(candidate)) {
      if (candidate.fullPath === pending.marker.origin) {
        pending.navigation = candidate
        return historyLayerRedirectReplacement(pending, destination)
      }
      visited.add(candidate)
      candidate = candidate.redirectedFrom
    }
    return null
  }

  function historyLayerRedirectReplacement(
    pending: PendingHistoryLayerArrival,
    destination: RouteLocationNormalized,
  ): RouteLocationRaw | null {
    if (pending.replacementRequested
      || !pending.navigation
      || destination === pending.navigation
      || !navigationDescendsFrom(destination, pending.navigation)) {
      return null
    }
    pending.replacementRequested = true
    return historyLayerReplacementLocation(pending, destination)
  }

  function historyLayerReplacementLocation(
    pending: PendingHistoryLayerArrival,
    destination: RouteLocationNormalized,
  ): RouteLocationRaw {
    return {
      hash: destination.hash,
      path: destination.path,
      query: destination.query,
      replace: true,
      state: {
        [routeHistoryLayerStateKey]: { ...pending.marker },
      },
    }
  }

  function settlePendingHistoryLayerNavigation(
    destination: RouteLocationNormalized,
    succeeded: boolean,
  ): void {
    const pending = pendingHistoryLayerArrival
    if (!pending) {
      return
    }
    if (!pending.navigation) {
      if (!succeeded
        && navigationChainIncludesLocation(destination, pending.marker.origin)) {
        pendingHistoryLayerArrival = null
        if (destination.redirectedFrom
          && currentHistoryLayerMarkerMatches(pending.marker)
          && !pendingTraversalTargetsHistoryAnchor(pending.origin)) {
          restorePendingHistoryLayerOrigin(pending)
        }
      }
      return
    }
    if (!navigationDescendsFrom(destination, pending.navigation)) {
      return
    }
    if (!succeeded) {
      pendingHistoryLayerArrival = null
      if (pending.replacementRequested
        && currentHistoryLayerMarkerMatches(pending.marker)
        && !pendingTraversalTargetsHistoryAnchor(pending.origin)) {
        restorePendingHistoryLayerOrigin(pending)
      }
      return
    }

    const token = pending.token
    void nextTick(() => {
      let current = pendingHistoryLayerArrival
      if (!current || current.token !== token) {
        return
      }
      historyLayers.forEach((layer) => {
        adoptCurrentHistoryLayer(layer)
      })
      current = pendingHistoryLayerArrival
      if (!current || current.token !== token) {
        return
      }
      pendingHistoryLayerArrival = null
      const marker = readCurrentHistoryLayerMarker()
      if (!marker || !historyLayerMarkersMatch(marker, current.marker)) {
        return
      }
      const owner = historyLayers.some(layer =>
        !layer.disposed
        && layer.phase === 'open'
        && layer.marker !== null
        && historyLayerMarkersMatch(layer.marker, marker)
        && historyLayerMarkerBelongsTo(layer, marker),
      )
      if (!owner) {
        stripCurrentHistoryLayerMarker(sourceHistory.location, marker)
      }
    })
  }

  function restorePendingHistoryLayerOrigin(
    pending: PendingHistoryLayerArrival,
  ): void {
    const currentPosition = readHistoryPosition()
    const delta = pending.origin.position !== null && currentPosition !== null
      ? pending.origin.position - currentPosition
      : -pending.delta
    if (delta !== 0) {
      moveHistory(delta, true)
    }
  }

  function currentHistoryLayerMarkerMatches(
    expected: RouteHistoryLayerMarker,
  ): boolean {
    const current = readCurrentHistoryLayerMarker()
    return current !== null
      && sourceHistory.location === expected.origin
      && historyLayerMarkersMatch(current, expected)
  }

  function pendingTraversalTargetsHistoryAnchor(anchor: HistoryAnchor): boolean {
    return anchor.position !== null
      && pendingSilentTraversal?.targetPosition === anchor.position
  }

  function navigationChainIncludesLocation(
    destination: RouteLocationNormalized,
    location: string,
  ): boolean {
    let candidate:
      | RouteLocationNormalized
      | NonNullable<RouteLocationNormalized['redirectedFrom']>
      | undefined = destination
    const visited = new Set<object>()
    while (candidate && !visited.has(candidate)) {
      if (candidate.fullPath === location) {
        return true
      }
      visited.add(candidate)
      candidate = candidate.redirectedFrom
    }
    return false
  }

  function navigationDescendsFrom(
    destination: RouteLocationNormalized,
    expected: object,
  ): boolean {
    let candidate:
      | RouteLocationNormalized
      | NonNullable<RouteLocationNormalized['redirectedFrom']>
      | undefined = destination
    const visited = new Set<object>()
    while (candidate && !visited.has(candidate)) {
      if (candidate === expected) {
        return true
      }
      visited.add(candidate)
      candidate = candidate.redirectedFrom
    }
    return false
  }

  function clearPendingHistoryLayerArrival(marker: RouteHistoryLayerMarker): void {
    if (pendingHistoryLayerArrival
      && historyLayerMarkersMatch(pendingHistoryLayerArrival.marker, marker)) {
      pendingHistoryLayerArrival = null
    }
  }

  function stripCurrentHistoryLayerMarker(
    location: string,
    marker: RouteHistoryLayerMarker,
  ): void {
    const state = sourceHistory.state
    if (!isRecord(state)) {
      return
    }
    const currentMarker = readCurrentHistoryLayerMarker()
    if (!currentMarker || !historyLayerMarkersMatch(currentMarker, marker)) {
      return
    }
    if (!usesNativeHistoryPositions) {
      try {
        if (Reflect.deleteProperty(state, routeHistoryLayerStateKey)) {
          return
        }
      }
      catch {
        // Fall through to the RouterHistory replacement for immutable states.
      }
    }
    // Vue Router merges replacement data over the existing Web History state,
    // so omitting this key would retain the stale marker across a reload.
    const nextState = {
      ...state,
      [routeHistoryLayerStateKey]: null,
    }
    sourceHistory.replace(location, nextState)
  }

  function isAtHistoryLayerBase(marker: RouteHistoryLayerMarker): boolean {
    const position = readHistoryPosition()
    return marker.basePosition === null
      || position === null
      || position === marker.basePosition
  }

  function canReopenHistoryLayerFromCurrentBase(
    layer: RouteHistoryLayerRegistrationState,
    marker: RouteHistoryLayerMarker,
  ): boolean {
    return sourceHistory.location === marker.origin
      && historyLayerMarkerBelongsTo(layer, marker)
      && isAtHistoryLayerBase(marker)
  }

  function pendingTraversalTargetsHistoryLayerMarker(
    marker: RouteHistoryLayerMarker,
  ): boolean {
    return marker.basePosition !== null
      && pendingSilentTraversal?.targetPosition === marker.basePosition + 1
  }

  function returnClosingHistoryLayerToBase(): void {
    const marker = readCurrentHistoryLayerMarker()
    if (!marker) {
      return
    }
    const layer = historyLayers.find(candidate =>
      candidate.phase === 'closing'
      && candidate.marker !== null
      && historyLayerMarkersMatch(candidate.marker, marker),
    )
    if (!layer) {
      return
    }
    const currentPosition = readHistoryPosition()
    const delta = marker.basePosition !== null && currentPosition !== null
      ? marker.basePosition - currentPosition
      : -1
    if (delta === 0) {
      finishHistoryLayerClose(layer, true)
      return
    }
    moveHistory(delta, true)
  }

  function readCurrentHistoryLayerMarker(): RouteHistoryLayerMarker | null {
    const state = sourceHistory.state
    if (!isRecord(state)) {
      return null
    }
    const candidate = state[routeHistoryLayerStateKey]
    if (!isRecord(candidate)
      || candidate.version !== 1
      || typeof candidate.id !== 'string'
      || !candidate.id
      || typeof candidate.origin !== 'string'
      || !candidate.origin
      || !Number.isSafeInteger(candidate.nonce)
      || (candidate.basePosition !== null && !isHistoryPosition(candidate.basePosition))) {
      return null
    }
    const marker: RouteHistoryLayerMarker = {
      basePosition: candidate.basePosition as number | null,
      id: candidate.id,
      nonce: candidate.nonce as number,
      origin: candidate.origin,
      version: 1,
    }
    const currentPosition = readHistoryPosition()
    if (usesNativeHistoryPositions
      && marker.basePosition !== null
      && currentPosition !== null
      && currentPosition !== marker.basePosition + 1) {
      return null
    }
    return marker
  }

  function historyLayerMarkerBelongsTo(
    layer: RouteHistoryLayerRegistrationState,
    marker: RouteHistoryLayerMarker,
  ): boolean {
    return layer.id === marker.id && layer.origin() === marker.origin
  }

  function historyLayerMarkersMatch(
    left: RouteHistoryLayerMarker,
    right: RouteHistoryLayerMarker,
  ): boolean {
    return left.version === right.version
      && left.id === right.id
      && left.origin === right.origin
      && left.nonce === right.nonce
      && left.basePosition === right.basePosition
  }

  function clearFence(fence: PopFence): void {
    if (activeFence?.token === fence.token) {
      activeFence = null
      signalHistoryChange()
    }
  }

  function settleCommittedFence(fence: PopFence): void {
    fence.phase = 'committed'
    void restoreFence(fence).then((stable) => {
      if (stable && fence.phase === 'committed') {
        clearFence(fence)
      }
    })
  }

  function fenceOwnsNavigation(
    fence: PopFence,
    destination: RouteLocationNormalized,
  ): boolean {
    const expectedDestinations = new Set([
      fence.firstDestination.location,
      fence.permittedDestination,
    ])
    if (expectedDestinations.has(destination.fullPath)) {
      return true
    }

    return isRedirectedFenceNavigation(fence, destination)
  }

  function claimFenceNavigation(
    fence: PopFence,
    destination: RouteLocationNormalized,
  ): boolean {
    const existing = navigationOwnership.get(destination)
    if (existing) {
      return ownershipMatchesFence(existing, fence)
    }

    let redirectedFrom = destination.redirectedFrom
    const redirectChain: object[] = []
    const visited = new Set<object>()
    while (redirectedFrom && !visited.has(redirectedFrom)) {
      redirectChain.push(redirectedFrom)
      const redirectOwnership = navigationOwnership.get(redirectedFrom)
      if (redirectOwnership) {
        if (!ownershipMatchesFence(redirectOwnership, fence)) {
          return false
        }
        navigationOwnership.set(destination, redirectOwnership)
        return true
      }
      visited.add(redirectedFrom)
      redirectedFrom = redirectedFrom.redirectedFrom
    }

    if (!fenceOwnsNavigation(fence, destination)) {
      return false
    }
    if (fence.rootNavigation) {
      return false
    }
    const ownership = currentFenceOwnership(fence)
    fence.rootNavigation = redirectChain.at(-1) ?? destination
    redirectChain.forEach(redirect => navigationOwnership.set(redirect, ownership))
    navigationOwnership.set(destination, ownership)
    return true
  }

  function isCurrentFenceNavigation(
    fence: PopFence,
    destination: RouteLocationNormalized,
  ): boolean {
    const ownership = navigationOwnership.get(destination)
    return ownership !== undefined && ownershipMatchesFence(ownership, fence)
  }

  function isStaleFenceNavigation(
    fence: PopFence,
    destination: RouteLocationNormalized,
  ): boolean {
    const ownership = navigationOwnership.get(destination)
    return ownership?.fenceToken === fence.token
      && ownership.generation !== fence.generation
  }

  function currentFenceOwnership(fence: PopFence): NavigationOwnership {
    return {
      fenceToken: fence.token,
      generation: fence.generation,
    }
  }

  function ownershipMatchesFence(
    ownership: NavigationOwnership,
    fence: PopFence,
  ): boolean {
    return ownership.fenceToken === fence.token
      && ownership.generation === fence.generation
  }

  function isRedirectedFenceNavigation(
    fence: PopFence,
    destination: RouteLocationNormalized,
  ): boolean {
    const expectedDestinations = new Set([
      fence.firstDestination.location,
      fence.permittedDestination,
    ])
    let redirectedFrom = destination.redirectedFrom
    const visited = new Set<object>()
    while (redirectedFrom && !visited.has(redirectedFrom)) {
      if (expectedDestinations.has(redirectedFrom.fullPath)) {
        return true
      }
      visited.add(redirectedFrom)
      redirectedFrom = redirectedFrom.redirectedFrom
    }
    return false
  }

  function createFence(
    origin: HistoryAnchor,
    firstDestination: HistoryAnchor,
    forwarded: boolean,
    ownerToken: symbol,
    cumulativeDelta: number,
  ): PopFence {
    return {
      cumulativeDelta,
      desired: firstDestination,
      firstDestination,
      forwarded,
      generation: 1,
      origin,
      ownerToken,
      phase: 'decision',
      permittedDestination: null,
      repairRequested: false,
      rootNavigation: null,
      restorePromise: null,
      secondaryCloseRequested: false,
      token: Symbol('route-pop-fence'),
    }
  }

  function isAtAnchor(anchor: HistoryAnchor): boolean {
    if (sourceHistory.location !== anchor.location) {
      return false
    }
    const position = readHistoryPosition()
    return anchor.position === null || position === null || position === anchor.position
  }

  function forwardRebasedPop(
    fence: PopFence,
    destinationLocation: string,
    information: HistoryNavigationInformation,
  ): void {
    const destination = readAnchor(destinationLocation)
    const cumulativeDelta = fence.origin.position !== null
      && destination.position !== null
      ? destination.position - fence.origin.position
      : fence.cumulativeDelta + information.delta
    fence.cumulativeDelta = cumulativeDelta
    fence.generation += 1
    fence.rootNavigation = null
    fence.desired = destination
    fence.firstDestination = destination
    fence.permittedDestination = destinationLocation
    listeners.forEach(listener => listener(
      destinationLocation,
      fence.origin.location,
      { ...information, delta: cumulativeDelta },
    ))
  }

  function readAnchor(location: string): HistoryAnchor {
    return {
      location,
      position: readHistoryPosition(),
    }
  }

  function recordFenceHistoryMutation(location: string): void {
    const fence = activeFence
    if (fence?.phase === 'navigation') {
      fence.desired = readAnchor(location)
    }
  }

  function popDepartedFromAnchor(
    anchor: HistoryAnchor,
    from: string,
    information: HistoryNavigationInformation,
  ): boolean {
    if (anchor.location !== from) {
      return false
    }
    const destinationPosition = readHistoryPosition()
    return anchor.position === null
      || destinationPosition === null
      || destinationPosition - information.delta === anchor.position
  }

  function readHistoryPosition(): number | null {
    return readNativeHistoryPosition() ?? fallbackHistoryPosition
  }

  function readNativeHistoryPosition(): number | null {
    if (!usesNativeHistoryPositions) {
      return null
    }
    const position = sourceHistory.state.position
    return isHistoryPosition(position) ? position : null
  }

  function normalizeHistoryInformation(
    information: HistoryNavigationInformation,
  ): HistoryNavigationInformation {
    if (usesNativeHistoryPositions) {
      return information
    }
    const origin = fallbackTraversalOrigin ?? fallbackHistoryPosition
    if (fallbackTraversalOrigin === null) {
      fallbackHistoryPosition = clampHistoryPosition(
        fallbackHistoryPosition + information.delta,
      )
    }
    const actualDelta = fallbackHistoryPosition - origin
    return actualDelta === information.delta
      ? information
      : { ...information, delta: actualDelta }
  }

  function releaseFenceWhenStable(fence: PopFence, repair: boolean): void {
    void restoreFence(fence, repair).then((stable) => {
      if (stable && fence.phase === 'rollback') {
        clearFence(fence)
      }
    })
  }

  function requestSecondaryCloseWhenStable(fence: PopFence): void {
    fence.secondaryCloseRequested = true
    void restoreFence(fence).then((stable) => {
      if (!stable
        || activeFence?.token !== fence.token
        || !fence.secondaryCloseRequested) {
        return
      }
      fence.secondaryCloseRequested = false
      if (!fence.forwarded) {
        clearFence(fence)
      }
      blockers.find(candidate => candidate.token === fence.ownerToken)?.onSecondaryPop()
    })
  }

  async function restoreFence(fence: PopFence, repair = true): Promise<boolean> {
    fence.repairRequested ||= repair
    if (fence.restorePromise) {
      return fence.restorePromise
    }
    fence.restorePromise = restoreFenceUntilStable(fence).finally(() => {
      fence.restorePromise = null
    })
    return fence.restorePromise
  }

  async function restoreFenceUntilStable(fence: PopFence): Promise<boolean> {
    let fallbackRepairCommanded = false

    while (activeFence?.token === fence.token) {
      const observedSerial = historyChangeSerial
      const currentPosition = readHistoryPosition()
      if (isAtAnchor(fence.desired) && pendingSilentTraversal === null) {
        return true
      }
      if (fence.repairRequested && pendingSilentTraversal === null) {
        const positionDelta = fence.desired.position !== null && currentPosition !== null
          ? fence.desired.position - currentPosition
          : null
        const delta = positionDelta ?? (fallbackRepairCommanded ? 0 : -fence.cumulativeDelta)
        // Secondary-pop suppression and cancelled Router navigations own a
        // corrective traversal. Ordinary aborts/errors are rolled back by
        // Vue Router itself and call this function with repair=false.
        if (delta !== 0) {
          fallbackRepairCommanded = positionDelta === null
          moveHistory(delta, false)
        }
      }
      if (historyChangeSerial === observedSerial) {
        await waitForHistoryChange(observedSerial)
      }
    }
    return false
  }

  function suppressPop(
    fence: PopFence,
    information: HistoryNavigationInformation,
    closePendingDecision: boolean,
  ): void {
    if (fence.desired.position === null || readHistoryPosition() === null) {
      moveHistory(-information.delta, false)
    }
    if (closePendingDecision) {
      requestSecondaryCloseWhenStable(fence)
    }
    else {
      void restoreFence(fence)
    }
  }

  function moveHistory(delta: number, triggerListeners = true): void {
    const currentPosition = readNativeHistoryPosition()
    if (currentPosition === null) {
      const origin = fallbackHistoryPosition
      fallbackHistoryPosition = clampHistoryPosition(origin + delta)
      fallbackTraversalOrigin = origin
      try {
        sourceHistory.go(delta, triggerListeners)
      }
      finally {
        fallbackTraversalOrigin = null
      }
      if (!triggerListeners) {
        signalHistoryChange()
      }
      return
    }
    if (!triggerListeners && currentPosition !== null) {
      const targetPosition = currentPosition + delta
      if (pendingSilentTraversal?.targetPosition !== targetPosition) {
        const traversal = { targetPosition }
        pendingSilentTraversal = traversal
        sourceHistory.go(delta, true)
        retryDroppedHistoryLayerTraversal(traversal)
      }
      return
    }
    sourceHistory.go(delta, triggerListeners)
  }

  function retryDroppedHistoryLayerTraversal(traversal: SilentTraversal): void {
    const layer = historyLayers.find(candidate =>
      candidate.phase !== 'closed'
      && candidate.marker !== null
      && candidate.marker.basePosition !== null
      && candidate.marker.basePosition + 1 === traversal.targetPosition
      && sourceHistory.location === candidate.marker.origin
      && historyLayerMarkerBelongsTo(candidate, candidate.marker),
    )
    if (!layer) {
      return
    }

    // Chromium can coalesce a rapid pair of Back commands after the first one
    // has already scheduled our marker repair. Classic History exposes no
    // completion promise, so retry only this safe, app-created terminal marker
    // when the browser produces neither the target pop nor a superseding pop.
    setTimeout(() => {
      if (pendingSilentTraversal !== traversal
        || layer.disposed
        || layer.phase === 'closed'
        || layer.marker === null
        || !historyLayerMarkerBelongsTo(layer, layer.marker)) {
        return
      }
      if (readNativeHistoryPosition() === traversal.targetPosition) {
        pendingSilentTraversal = null
        signalHistoryChange()
        return
      }
      pendingSilentTraversal = null
      signalHistoryChange()
    }, 32)
  }

  function clampHistoryPosition(position: number): number {
    return Math.max(0, Math.min(position, fallbackHistoryUpperBound))
  }

  function signalHistoryChange(): void {
    historyChangeSerial += 1
    const waiters = [...historyChangeWaiters]
    historyChangeWaiters.clear()
    waiters.forEach(resolve => resolve())
  }

  function waitForHistoryChange(observedSerial: number): Promise<void> {
    if (historyChangeSerial !== observedSerial) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      historyChangeWaiters.add(resolve)
    })
  }

  return { coordinator, history }
}

function isHistoryPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getRouteLeaveCoordinator(router: Router): RouteLeaveCoordinator {
  const coordinator = coordinators.get(router)
  if (!coordinator) {
    throw new Error('The router was not created with Yomu route-leave coordination.')
  }
  return coordinator
}

export function registerRouteLeaveCoordinator(
  router: Router,
  coordinator: RouteLeaveCoordinator,
): void {
  coordinators.set(router, coordinator)
}
