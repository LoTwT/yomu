import { describe, expect, it, vi } from 'vitest'

import { createUnsavedImportBeforeUnloadHandler } from '@/features/import/useUnsavedImportGuard'

describe('unsaved import beforeunload guard', () => {
  it('does not interfere after the import is resolved', () => {
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      returnValue: 'unchanged',
    } as unknown as BeforeUnloadEvent
    const handleBeforeUnload = createUnsavedImportBeforeUnloadHandler(() => false)

    handleBeforeUnload(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(event.returnValue).toBe('unchanged')
  })

  it('requests the browser confirmation only while the import is dirty', () => {
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      returnValue: 'unchanged',
    } as unknown as BeforeUnloadEvent
    const handleBeforeUnload = createUnsavedImportBeforeUnloadHandler(() => true)

    handleBeforeUnload(event)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
  })
})
