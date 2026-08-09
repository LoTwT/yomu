import {
  inject,
  nextTick,
  shallowReadonly,
  shallowRef,
  type InjectionKey,
  type ShallowRef,
} from 'vue'

export type InteractionLayerCloseReason =
  | 'escape'
  | 'navigation'
  | 'superseded'
  | 'system-back'

export interface InteractionLayerRegistration {
  focusReturn?: HTMLElement | null
  id: string
  onRequestClose: (reason: InteractionLayerCloseReason) => void
}

export interface ReleaseInteractionLayerOptions {
  restoreFocus?: boolean
}

export type ReleaseInteractionLayer = (
  options?: ReleaseInteractionLayerOptions,
) => void

export interface InteractionLayerController {
  activeLayerId: Readonly<ShallowRef<string | null>>
  rememberFocusReturn: (target: HTMLElement | null) => void
  registerLayer: (
    registration: InteractionLayerRegistration,
  ) => ReleaseInteractionLayer | null
  requestCloseTop: (reason: InteractionLayerCloseReason) => boolean
}

interface ActiveInteractionLayer extends Omit<InteractionLayerRegistration, 'focusReturn'> {
  closeAttemptSerial: number
  focusReturn: HTMLElement | null
  isRequestingClose: boolean
  token: symbol
}

export const interactionLayerKey: InjectionKey<InteractionLayerController>
  = Symbol('yomu-interaction-layer')

export function createInteractionLayerController(): InteractionLayerController {
  const activeLayerId = shallowRef<string | null>(null)
  let activeLayer: ActiveInteractionLayer | null = null
  let rememberedFocusReturn: HTMLElement | null = null

  function rememberFocusReturn(target: HTMLElement | null): void {
    if (!activeLayer) {
      rememberedFocusReturn = target
    }
  }

  function registerLayer(
    registration: InteractionLayerRegistration,
  ): ReleaseInteractionLayer | null {
    const previousLayer = activeLayer
    const layer: ActiveInteractionLayer = {
      ...registration,
      closeAttemptSerial: 0,
      focusReturn: previousLayer?.focusReturn
        ?? registration.focusReturn
        ?? rememberedFocusReturn,
      isRequestingClose: false,
      token: Symbol(registration.id),
    }

    activeLayer = layer
    activeLayerId.value = layer.id
    rememberedFocusReturn = null
    const candidateCloseAttemptSerial = layer.closeAttemptSerial
    try {
      if (previousLayer) {
        requestLayerClose(previousLayer, 'superseded')
      }
    }
    catch (error) {
      if (layer.closeAttemptSerial === candidateCloseAttemptSerial) {
        try {
          requestLayerClose(layer, 'superseded')
        }
        catch {
          // Preserve the original owner failure while asking the rejected layer to leave.
        }
      }
      const rejectedLayerIsActive = activeLayer?.token === layer.token
      if (rejectedLayerIsActive || activeLayer === null) {
        activeLayer = previousLayer
        activeLayerId.value = previousLayer?.id ?? null
      }
      throw error
    }

    if (activeLayer?.token !== layer.token) {
      return null
    }

    return (options = {}) => {
      if (activeLayer?.token !== layer.token) {
        return
      }
      activeLayer = null
      activeLayerId.value = null
      if (options.restoreFocus !== false) {
        scheduleFocusReturn(layer.focusReturn)
      }
    }
  }

  function requestCloseTop(reason: InteractionLayerCloseReason): boolean {
    const layer = activeLayer
    if (!layer) {
      return false
    }

    const closeWasRequested = requestLayerClose(layer, reason)
    if (closeWasRequested && activeLayer?.token === layer.token) {
      activeLayer = null
      activeLayerId.value = null
      scheduleFocusReturn(layer.focusReturn)
    }
    return true
  }

  function requestLayerClose(
    layer: ActiveInteractionLayer,
    reason: InteractionLayerCloseReason,
  ): boolean {
    if (layer.isRequestingClose) {
      return false
    }
    layer.closeAttemptSerial += 1
    layer.isRequestingClose = true
    try {
      layer.onRequestClose(reason)
    }
    finally {
      layer.isRequestingClose = false
    }
    return true
  }

  function scheduleFocusReturn(target: HTMLElement | null): void {
    if (!target) {
      return
    }
    void nextTick(() => {
      if (activeLayer || !target.isConnected) {
        return
      }
      target.focus({ preventScroll: true })
    })
  }

  return {
    activeLayerId: shallowReadonly(activeLayerId),
    rememberFocusReturn,
    registerLayer,
    requestCloseTop,
  }
}

export function useInteractionLayer(): InteractionLayerController {
  const controller = inject(interactionLayerKey)
  if (!controller) {
    throw new Error('InteractionLayerController was not provided by the application shell.')
  }
  return controller
}
