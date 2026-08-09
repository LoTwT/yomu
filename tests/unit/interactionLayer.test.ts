/** @vitest-environment jsdom */

import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createInteractionLayerController } from '@/app/interactionLayer'

afterEach(() => {
  document.body.replaceChildren()
})

describe('interaction layer controller', () => {
  it('keeps one owner, ignores stale releases, and restores the original focus', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const controller = createInteractionLayerController()
    const firstClose = vi.fn()
    const secondClose = vi.fn()

    const releaseFirst = controller.registerLayer({
      focusReturn: opener,
      id: 'first-layer',
      onRequestClose: firstClose,
    })
    const releaseSecond = controller.registerLayer({
      id: 'second-layer',
      onRequestClose: secondClose,
    })

    expect(firstClose).toHaveBeenCalledWith('superseded')
    expect(controller.activeLayerId.value).toBe('second-layer')

    releaseFirst?.()
    expect(controller.activeLayerId.value).toBe('second-layer')
    expect(controller.requestCloseTop('system-back')).toBe(true)
    expect(secondClose).toHaveBeenCalledWith('system-back')
    expect(controller.activeLayerId.value).toBeNull()

    await nextTick()
    expect(document.activeElement).toBe(opener)
    expect(controller.requestCloseTop('escape')).toBe(false)

    releaseSecond?.()
  })

  it('keeps the current owner when a close callback fails', () => {
    const controller = createInteractionLayerController()
    const closeError = new Error('Layer refused to close.')
    const release = controller.registerLayer({
      id: 'failing-layer',
      onRequestClose: () => {
        throw closeError
      },
    })

    expect(() => controller.requestCloseTop('navigation')).toThrow(closeError)
    expect(controller.activeLayerId.value).toBe('failing-layer')
    expect(() => controller.requestCloseTop('system-back')).toThrow(closeError)
    expect(controller.activeLayerId.value).toBe('failing-layer')

    release?.({ restoreFocus: false })
    expect(controller.activeLayerId.value).toBeNull()
  })

  it('does not replace the owner when superseding it fails', () => {
    const controller = createInteractionLayerController()
    const closeError = new Error('Existing layer refused to close.')
    const rejectNewLayer = vi.fn()
    const release = controller.registerLayer({
      id: 'existing-layer',
      onRequestClose: () => {
        throw closeError
      },
    })

    expect(() => controller.registerLayer({
      id: 'new-layer',
      onRequestClose: rejectNewLayer,
    })).toThrow(closeError)
    expect(controller.activeLayerId.value).toBe('existing-layer')
    expect(rejectNewLayer).toHaveBeenCalledWith('superseded')

    release?.({ restoreFocus: false })
  })

  it('restores the previous owner when it reentrantly closes the candidate before failing', () => {
    const controller = createInteractionLayerController()
    const closeError = new Error('Existing layer failed after closing the candidate.')
    const rejectNewLayer = vi.fn()
    const release = controller.registerLayer({
      id: 'existing-layer',
      onRequestClose: () => {
        controller.requestCloseTop('system-back')
        throw closeError
      },
    })

    expect(() => controller.registerLayer({
      id: 'new-layer',
      onRequestClose: rejectNewLayer,
    })).toThrow(closeError)
    expect(rejectNewLayer).toHaveBeenCalledTimes(1)
    expect(rejectNewLayer).toHaveBeenCalledWith('system-back')
    expect(controller.activeLayerId.value).toBe('existing-layer')

    release?.({ restoreFocus: false })
  })

  it('does not request a second candidate close when the reentrant close fails', () => {
    const controller = createInteractionLayerController()
    const closeError = new Error('Candidate layer refused to close.')
    const rejectNewLayer = vi.fn(() => {
      throw closeError
    })
    const release = controller.registerLayer({
      id: 'existing-layer',
      onRequestClose: () => {
        controller.requestCloseTop('system-back')
      },
    })

    expect(() => controller.registerLayer({
      id: 'new-layer',
      onRequestClose: rejectNewLayer,
    })).toThrow(closeError)
    expect(rejectNewLayer).toHaveBeenCalledTimes(1)
    expect(rejectNewLayer).toHaveBeenCalledWith('system-back')
    expect(controller.activeLayerId.value).toBe('existing-layer')

    release?.({ restoreFocus: false })
  })

  it('does not expose the restored owner to a rejected candidate close', () => {
    const controller = createInteractionLayerController()
    const closeError = new Error('The existing layer rejected its replacement.')
    const closeExisting = vi.fn()
      .mockImplementationOnce(() => {
        throw closeError
      })
    let ownerBeforeNestedClose: string | null = null
    let ownerAfterNestedClose: string | null = null

    const releaseExisting = controller.registerLayer({
      id: 'existing-layer',
      onRequestClose: closeExisting,
    })

    const closeCandidate = vi.fn(() => {
      ownerBeforeNestedClose = controller.activeLayerId.value
      expect(controller.requestCloseTop('system-back')).toBe(true)
      ownerAfterNestedClose = controller.activeLayerId.value
    })

    expect(() => controller.registerLayer({
      id: 'candidate-layer',
      onRequestClose: closeCandidate,
    })).toThrow(closeError)

    expect(closeExisting).toHaveBeenCalledOnce()
    expect(closeCandidate).toHaveBeenCalledOnce()
    expect(closeCandidate).toHaveBeenCalledWith('superseded')
    expect(ownerBeforeNestedClose).toBe('candidate-layer')
    expect(ownerAfterNestedClose).toBe('candidate-layer')
    expect(controller.activeLayerId.value).toBe('existing-layer')

    releaseExisting?.({ restoreFocus: false })
  })

  it('rejects a candidate that is superseded during registration', () => {
    const controller = createInteractionLayerController()
    const candidateClose = vi.fn()
    let releaseReplacement: ReturnType<typeof controller.registerLayer> = null
    const releaseExisting = controller.registerLayer({
      id: 'existing-layer',
      onRequestClose: () => {
        releaseReplacement = controller.registerLayer({
          id: 'replacement-layer',
          onRequestClose: vi.fn(),
        })
      },
    })

    const releaseCandidate = controller.registerLayer({
      id: 'candidate-layer',
      onRequestClose: candidateClose,
    })

    expect(releaseCandidate).toBeNull()
    expect(candidateClose).toHaveBeenCalledOnce()
    expect(candidateClose).toHaveBeenCalledWith('superseded')
    expect(controller.activeLayerId.value).toBe('replacement-layer')

    releaseExisting?.({ restoreFocus: false })
    releaseReplacement?.({ restoreFocus: false })
  })

  it('does not clear an owner from a nested close request on the same layer', () => {
    const controller = createInteractionLayerController()
    let activeDuringClose: string | null = null
    controller.registerLayer({
      id: 'reentrant-layer',
      onRequestClose: () => {
        expect(controller.requestCloseTop('system-back')).toBe(true)
        activeDuringClose = controller.activeLayerId.value
      },
    })

    expect(controller.requestCloseTop('navigation')).toBe(true)
    expect(activeDuringClose).toBe('reentrant-layer')
    expect(controller.activeLayerId.value).toBeNull()
  })
})
