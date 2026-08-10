import { afterEach, describe, expect, it } from 'vitest'

import { openModalDialog } from '@/app/modalDialog'

afterEach(() => {
  document.body.replaceChildren()
  for (const element of [document.documentElement, document.body]) {
    element.style.removeProperty('overflow')
    element.style.removeProperty('overscroll-behavior')
    element.style.removeProperty('scrollbar-gutter')
  }
})

describe('modal dialog fallback', () => {
  it('uses the native modal path when the host provides it', () => {
    const dialog = document.createElement('dialog')
    const outside = document.createElement('button')
    const heading = document.createElement('h2')
    const closeButton = document.createElement('button')
    const firstRadio = document.createElement('input')
    const selectedRadio = document.createElement('input')
    heading.tabIndex = -1
    firstRadio.type = 'radio'
    firstRadio.name = 'font-scale'
    selectedRadio.type = 'radio'
    selectedRadio.name = 'font-scale'
    selectedRadio.checked = true
    dialog.append(heading, closeButton, firstRadio, selectedRadio)
    document.body.append(outside, dialog)
    let showCount = 0
    let closeCount = 0
    Object.defineProperties(dialog, {
      showModal: {
        configurable: true,
        value: () => {
          showCount += 1
          dialog.setAttribute('open', '')
        },
      },
      close: {
        configurable: true,
        value: () => {
          closeCount += 1
          dialog.removeAttribute('open')
        },
      },
    })

    const session = openModalDialog(dialog, {
      fallbackBackdropClass: 'test-backdrop',
    })

    expect(session.usesFallback).toBe(false)
    expect(showCount).toBe(1)
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('hidden')
    expect(document.body.style.getPropertyValue('overflow')).toBe('hidden')
    expect(outside.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('.test-backdrop')).toBeNull()

    heading.focus()
    heading.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
      shiftKey: true,
    }))
    expect(document.activeElement).toBe(selectedRadio)

    selectedRadio.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    }))
    expect(document.activeElement).toBe(closeButton)

    session.release()
    expect(closeCount).toBe(1)
    expect(dialog.open).toBe(false)
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('')
    expect(document.body.style.getPropertyValue('overflow')).toBe('')
  })

  it('keeps a shared document locked until every modal session releases', () => {
    document.documentElement.style.setProperty('overflow', 'auto', 'important')
    document.body.style.setProperty('overscroll-behavior', 'contain')
    const dialogs = [document.createElement('dialog'), document.createElement('dialog')]
    dialogs.forEach((dialog) => {
      Object.defineProperties(dialog, {
        showModal: {
          configurable: true,
          value: () => dialog.setAttribute('open', ''),
        },
        close: {
          configurable: true,
          value: () => dialog.removeAttribute('open'),
        },
      })
      document.body.append(dialog)
    })

    const first = openModalDialog(dialogs[0]!, {
      fallbackBackdropClass: 'test-backdrop',
    })
    const second = openModalDialog(dialogs[1]!, {
      fallbackBackdropClass: 'test-backdrop',
    })
    first.release()
    first.release()

    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('hidden')
    expect(document.body.style.getPropertyValue('overscroll-behavior')).toBe('none')

    second.release()

    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('auto')
    expect(document.body.style.getPropertyValue('overscroll-behavior')).toBe('contain')
    document.documentElement.style.removeProperty('overflow')
    document.body.style.removeProperty('overscroll-behavior')
  })

  it('isolates the background, traps focus, and restores prior state', () => {
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    outside.setAttribute('aria-hidden', 'false')
    const host = document.createElement('section')
    const dialog = document.createElement('dialog')
    const first = document.createElement('button')
    const last = document.createElement('button')
    first.textContent = 'First'
    last.textContent = 'Last'
    dialog.append(first, last)
    host.append(dialog)
    document.body.append(outside, host)
    Object.defineProperty(dialog, 'showModal', {
      configurable: true,
      value: undefined,
    })

    const session = openModalDialog(dialog, {
      fallbackBackdropClass: 'test-backdrop',
    })

    expect(session.usesFallback).toBe(true)
    expect(dialog.open).toBe(true)
    expect(dialog.hasAttribute('data-modal-fallback')).toBe(true)
    expect(document.querySelector('.test-backdrop')).not.toBeNull()
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('hidden')
    expect(document.body.style.getPropertyValue('overflow')).toBe('hidden')
    expect(outside.hasAttribute('inert')).toBe(true)
    expect(outside.getAttribute('aria-hidden')).toBe('true')

    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    }))
    expect(document.activeElement).toBe(first)

    first.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
      shiftKey: true,
    }))
    expect(document.activeElement).toBe(last)

    outside.focus()
    expect(document.activeElement).toBe(first)

    session.release()

    expect(dialog.open).toBe(false)
    expect(dialog.hasAttribute('data-modal-fallback')).toBe(false)
    expect(document.querySelector('.test-backdrop')).toBeNull()
    expect(outside.hasAttribute('inert')).toBe(false)
    expect(outside.getAttribute('aria-hidden')).toBe('false')
    expect(document.documentElement.style.getPropertyValue('overflow')).toBe('')
    expect(document.body.style.getPropertyValue('overflow')).toBe('')
  })
})
