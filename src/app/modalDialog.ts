export interface ModalDialogSession {
  readonly usesFallback: boolean
  release: () => void
}

export interface OpenModalDialogOptions {
  fallbackBackdropClass: string
}

interface IsolatedElementState {
  element: HTMLElement
  hadInertAttribute: boolean
  inertProperty: boolean | undefined
  ariaHidden: string | null
}

interface InlineStylePropertyState {
  name: string
  priority: string
  value: string
}

interface ScrollLockState {
  count: number
  properties: Array<{
    element: HTMLElement
    values: InlineStylePropertyState[]
  }>
  releaseViewportListener: () => void
}

const documentScrollLocks = new WeakMap<Document, ScrollLockState>()
const modalScrollbarGutterProperty = '--modal-scrollbar-gutter'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Opens a native modal dialog and supplies a complete fallback for WebViews
 * that expose `<dialog>` but not `showModal()`.
 */
export function openModalDialog(
  dialog: HTMLDialogElement,
  options: OpenModalDialogOptions,
): ModalDialogSession {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal()
    const releaseFocusTrap = acquireDialogFocusTrap(dialog)
    const releaseScrollLock = acquireDocumentScrollLock(dialog.ownerDocument)
    let released = false
    return {
      usesFallback: false,
      release: () => {
        if (released) {
          return
        }
        released = true
        if (dialog.open && typeof dialog.close === 'function') {
          dialog.close()
        }
        releaseFocusTrap()
        releaseScrollLock()
      },
    }
  }

  const ownerDocument = dialog.ownerDocument
  const backdrop = ownerDocument.createElement('div')
  backdrop.className = options.fallbackBackdropClass
  backdrop.setAttribute('aria-hidden', 'true')
  dialog.before(backdrop)
  dialog.setAttribute('data-modal-fallback', '')
  dialog.setAttribute('open', '')

  const releaseScrollLock = acquireDocumentScrollLock(ownerDocument)
  const releaseFocusTrap = acquireDialogFocusTrap(dialog)
  const isolatedElements = isolateOutsideDialog(dialog, backdrop)

  function focusInsideDialog(): void {
    const focusTarget = readFocusableElements(dialog)[0] ?? dialog
    focusTarget.focus({ preventScroll: true })
  }

  function handleFocusIn(event: FocusEvent): void {
    if (!dialog.contains(event.target as Node | null)) {
      focusInsideDialog()
    }
  }

  ownerDocument.addEventListener('focusin', handleFocusIn)

  let released = false
  return {
    usesFallback: true,
    release: () => {
      if (released) {
        return
      }
      released = true
      ownerDocument.removeEventListener('focusin', handleFocusIn)
      releaseFocusTrap()
      isolatedElements.forEach(({
        element,
        hadInertAttribute,
        inertProperty,
        ariaHidden,
      }) => {
        if (inertProperty !== undefined) {
          element.inert = inertProperty
        }
        if (hadInertAttribute) {
          element.setAttribute('inert', '')
        }
        else {
          element.removeAttribute('inert')
        }
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden')
        }
        else {
          element.setAttribute('aria-hidden', ariaHidden)
        }
      })
      backdrop.remove()
      dialog.removeAttribute('data-modal-fallback')
      dialog.removeAttribute('open')
      releaseScrollLock()
    },
  }
}

function acquireDialogFocusTrap(dialog: HTMLDialogElement): () => void {
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.defaultPrevented) {
      return
    }

    const focusable = readSequentialFocusElements(dialog)
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus({ preventScroll: true })
      return
    }

    const activeIndex = focusable.indexOf(
      dialog.ownerDocument.activeElement as HTMLElement,
    )
    const destination = event.shiftKey ? focusable.at(-1)! : focusable[0]!
    const shouldWrap = event.shiftKey
      ? activeIndex <= 0
      : activeIndex === -1 || activeIndex === focusable.length - 1
    if (!shouldWrap) {
      return
    }

    event.preventDefault()
    destination.focus({ preventScroll: true })
  }

  dialog.addEventListener('keydown', handleKeydown)
  return () => dialog.removeEventListener('keydown', handleKeydown)
}

function acquireDocumentScrollLock(ownerDocument: Document): () => void {
  let state = documentScrollLocks.get(ownerDocument)
  if (!state) {
    const documentElement = ownerDocument.documentElement
    const ownerWindow = ownerDocument.defaultView
    const preLockGutter = ownerWindow
      ? Math.max(0, ownerWindow.innerWidth - documentElement.offsetWidth)
      : 0
    const elements = [ownerDocument.documentElement, ownerDocument.body]
      .filter((element): element is HTMLElement => element !== null)
    const propertyNames = [
      'overflow',
      'overscroll-behavior',
      'scrollbar-gutter',
    ] as const
    state = {
      count: 0,
      properties: elements.map(element => ({
        element,
        values: [
          ...propertyNames,
          ...(element === documentElement ? [modalScrollbarGutterProperty] : []),
        ].map(name => ({
          name,
          priority: element.style.getPropertyPriority(name),
          value: element.style.getPropertyValue(name),
        })),
      })),
      releaseViewportListener: () => {},
    }
    state.properties.forEach(({ element }) => {
      element.style.setProperty('overflow', 'hidden', 'important')
      element.style.setProperty('overscroll-behavior', 'none', 'important')
      element.style.setProperty(
        'scrollbar-gutter',
        element === documentElement && preLockGutter > 0 ? 'stable' : 'auto',
        'important',
      )
    })

    const updateScrollbarGutter = () => {
      const gutter = ownerWindow
        ? Math.max(0, ownerWindow.innerWidth - documentElement.offsetWidth)
        : 0
      documentElement.style.setProperty(
        modalScrollbarGutterProperty,
        `${gutter}px`,
        'important',
      )
    }
    updateScrollbarGutter()
    ownerWindow?.addEventListener('resize', updateScrollbarGutter)
    state.releaseViewportListener = () => {
      ownerWindow?.removeEventListener('resize', updateScrollbarGutter)
    }
    documentScrollLocks.set(ownerDocument, state)
  }
  state.count += 1

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const activeState = documentScrollLocks.get(ownerDocument)
    if (!activeState) {
      return
    }
    activeState.count -= 1
    if (activeState.count > 0) {
      return
    }
    activeState.releaseViewportListener()
    activeState.properties.forEach(({ element, values }) => {
      values.forEach(({ name, priority, value }) => {
        if (value) {
          element.style.setProperty(name, value, priority)
        }
        else {
          element.style.removeProperty(name)
        }
      })
    })
    documentScrollLocks.delete(ownerDocument)
  }
}

function isolateOutsideDialog(
  dialog: HTMLDialogElement,
  backdrop: HTMLElement,
): IsolatedElementState[] {
  const states: IsolatedElementState[] = []
  let pathElement: HTMLElement = dialog
  let parent = pathElement.parentElement

  while (parent) {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement)
        || child === pathElement
        || child === backdrop) {
        continue
      }
      states.push({
        element: child,
        hadInertAttribute: child.hasAttribute('inert'),
        inertProperty: 'inert' in child ? child.inert : undefined,
        ariaHidden: child.getAttribute('aria-hidden'),
      })
      if ('inert' in child) {
        child.inert = true
      }
      child.setAttribute('inert', '')
      child.setAttribute('aria-hidden', 'true')
    }
    pathElement = parent
    parent = parent.parentElement
  }

  return states
}

function readFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(element => !element.hasAttribute('disabled') && !element.inert)
}

function readSequentialFocusElements(dialog: HTMLDialogElement): HTMLElement[] {
  const focusable = readFocusableElements(dialog)
  return focusable.filter((element) => {
    const radio = readRadioInput(element)
    if (!radio?.name) {
      return true
    }

    const group = focusable
      .map(readRadioInput)
      .filter((candidate): candidate is HTMLInputElement =>
        candidate !== null
        && candidate.name === radio.name
        && candidate.form === radio.form
        && candidate.getRootNode() === radio.getRootNode())
    return (group.find(candidate => candidate.checked) ?? group[0]) === radio
  })
}

function readRadioInput(element: HTMLElement): HTMLInputElement | null {
  if (element.tagName !== 'INPUT') {
    return null
  }
  const input = element as HTMLInputElement
  return input.type === 'radio' ? input : null
}
