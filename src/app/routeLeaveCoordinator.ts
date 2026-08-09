import {
  isNavigationFailure,
  NavigationFailureType,
  type RouteLocationNormalized,
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

export interface RouteLeaveCoordinator {
  allowsConcurrentNavigation: (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
  ) => boolean
  attachRouter: (router: Router) => void
  blocksConcurrentNavigation: () => boolean
  registerBlocker: (blocker: RouteLeaveBlocker) => () => void
  settleDecision: (allowNavigation: boolean) => Promise<void>
}

interface HistoryAnchor {
  location: string
  position: number | null
}

interface BlockerRegistration extends RouteLeaveBlocker {
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

const coordinators = new WeakMap<Router, RouteLeaveCoordinator>()

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
  const usesNativeHistoryPositions = isHistoryPosition(sourceHistory.state.position)
  let activeFence: PopFence | null = null
  let attachedRouter: Router | null = null
  let fallbackHistoryPosition = 0
  let fallbackHistoryUpperBound = 0
  let fallbackTraversalOrigin: number | null = null
  let historyChangeSerial = 0
  const historyChangeWaiters = new Set<() => void>()
  const navigationOwnership = new WeakMap<object, NavigationOwnership>()
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
      pendingSilentTraversal = null
      blockers.length = 0
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
      removeBeforeEach = router.beforeEach(async (to) => {
        const fence = activeFence
        if (!fence) {
          return true
        }
        if (fence.phase === 'navigation'
          && pendingSilentTraversal
          && claimFenceNavigation(fence, to)) {
          await restoreFence(fence)
          return true
        }
        if (fence.phase !== 'committed') {
          return true
        }
        const stable = await restoreFence(fence)
        if (stable && activeFence?.token === fence.token && fence.phase === 'committed') {
          clearFence(fence)
        }
        return true
      })
      removeAfterEach = router.afterEach((to, from, failure) => {
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
        pendingSilentTraversal = { targetPosition }
        sourceHistory.go(delta, true)
      }
      return
    }
    sourceHistory.go(delta, triggerListeners)
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
