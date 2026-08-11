<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'

import {
  useInteractionLayer,
  type InteractionLayerCloseReason,
  type ReleaseInteractionLayer,
} from '@/app/interactionLayer'
import {
  openModalDialog,
  type ModalDialogSession,
} from '@/app/modalDialog'
import { normalizeIpa } from '@/data/articleCapabilities'
import type { ArticleTokenRecord } from '@/data/entities'

export type ReaderWordCardActionState = 'loading' | 'idle' | 'saving'
export type ReaderWordCardCloseReason =
  | InteractionLayerCloseReason
  | 'cancel'
  | 'close-button'

const props = withDefaults(defineProps<{
  actionState?: ReaderWordCardActionState
  anchor?: HTMLElement | null
  errorMessage?: string
  focusReturn?: HTMLElement | null
  saved: boolean
  token: ArticleTokenRecord
}>(), {
  actionState: 'loading',
  anchor: undefined,
  errorMessage: '',
  focusReturn: undefined,
})

const emit = defineEmits<{
  close: [reason: ReaderWordCardCloseReason]
  remove: []
  save: []
}>()

const interactionLayer = useInteractionLayer()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const headingId = useId()
const descriptionId = useId()
const modalPresentation = shallowRef(true)
const normalizedIpa = computed(() => normalizeIpa(props.token.ipa))
const meaning = computed(() => props.token.meaning?.trim() ?? '')
const actionLabel = computed(() => {
  if (props.actionState === 'loading') {
    return '正在读取收藏状态…'
  }
  if (props.actionState === 'saving') {
    return props.saved ? '正在取消收藏…' : '正在收藏…'
  }
  return props.saved ? '取消收藏' : '收藏单词'
})
const statusMessage = computed(() => {
  if (props.actionState === 'loading') {
    return '正在读取收藏状态…'
  }
  if (props.actionState === 'saving') {
    return props.saved ? '正在取消收藏，请稍候。' : '正在收藏，请稍候。'
  }
  return ''
})
let releaseLayer: ReleaseInteractionLayer | null = null
let modalSession: ModalDialogSession | null = null
let releasePositionTracking: (() => void) | null = null
let releasePresentationTracking: (() => void) | null = null
let closeRequested = false
let presentationChanging = false
let presentationVersion = 0

onMounted(() => {
  const release = interactionLayer.registerLayer({
    focusReturn: readFocusReturn(),
    id: 'reader-word-card',
    onRequestClose: reason => requestClose(reason),
  })

  if (!release) {
    requestClose('superseded')
    return
  }
  releaseLayer = release

  const dialogElement = dialog.value
  if (!dialogElement) {
    requestClose('superseded')
    return
  }
  const presentation = trackPresentation(dialogElement)
  releasePresentationTracking = presentation.release
  replaceDialogPresentation(presentation.modal)
  releasePositionTracking = trackPosition(dialogElement.ownerDocument)
})

watch(
  () => props.anchor,
  () => void nextTick(positionDialog),
)

onUnmounted(() => {
  closeRequested = true
  presentationVersion += 1
  releasePresentationTracking?.()
  releasePresentationTracking = null
  releasePositionTracking?.()
  releasePositionTracking = null
  modalSession?.release()
  modalSession = null
  releaseLayer?.()
  releaseLayer = null
})

function handleSavedAction(): void {
  if (props.actionState !== 'idle') {
    return
  }
  if (props.saved) {
    emit('remove')
  }
  else {
    emit('save')
  }
}

function requestClose(reason: ReaderWordCardCloseReason): void {
  if (closeRequested) {
    return
  }
  closeRequested = true
  presentationVersion += 1

  releasePresentationTracking?.()
  releasePresentationTracking = null
  releasePositionTracking?.()
  releasePositionTracking = null
  const modal = modalSession
  modalSession = null
  const release = releaseLayer
  releaseLayer = null
  modal?.release()
  emit('close', reason)
  release?.()
}

function handleDialogClose(): void {
  const dialogElement = dialog.value
  if (closeRequested || presentationChanging || dialogElement?.open) {
    return
  }
  requestClose('cancel')
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (!modalSession?.usesFallback
    || event.key !== 'Escape'
    || event.isComposing
    || event.defaultPrevented) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  requestClose('cancel')
}

function readFocusReturn(): HTMLElement | null {
  if (props.focusReturn !== undefined) {
    return props.focusReturn
  }

  const ownerDocument = dialog.value?.ownerDocument
  const activeElement = ownerDocument?.activeElement
  if (activeElement === ownerDocument?.body || activeElement === ownerDocument?.documentElement) {
    return null
  }
  return activeElement && typeof (activeElement as HTMLElement).focus === 'function'
    ? activeElement as HTMLElement
    : null
}

function trackPosition(ownerDocument: Document): () => void {
  const ownerWindow = ownerDocument.defaultView
  if (!ownerWindow) {
    return () => {}
  }
  const update = () => positionDialog()
  ownerWindow.addEventListener('resize', update)
  ownerWindow.addEventListener('scroll', update, true)
  return () => {
    ownerWindow.removeEventListener('resize', update)
    ownerWindow.removeEventListener('scroll', update, true)
  }
}

function positionDialog(): void {
  const dialogElement = dialog.value
  const ownerWindow = dialogElement?.ownerDocument.defaultView
  if (!dialogElement || !ownerWindow || closeRequested) {
    return
  }

  const viewportWidth = ownerWindow.innerWidth
  const viewportHeight = ownerWindow.innerHeight
  const margin = 16
  const gap = 12
  const dialogRect = dialogElement.getBoundingClientRect()
  const dialogWidth = dialogRect.width || Math.min(352, Math.max(0, viewportWidth - margin * 2))
  const dialogHeight = dialogRect.height || Math.min(320, Math.max(0, viewportHeight - margin * 2))
  const anchorRect = props.anchor?.isConnected
    ? props.anchor.getBoundingClientRect()
    : null

  const centeredInlineStart = (viewportWidth - dialogWidth) / 2
  const desiredInlineStart = anchorRect
    ? anchorRect.left + anchorRect.width / 2 - dialogWidth / 2
    : centeredInlineStart
  const inlineStart = clamp(
    desiredInlineStart,
    margin,
    Math.max(margin, viewportWidth - dialogWidth - margin),
  )

  const centeredBlockStart = (viewportHeight - dialogHeight) / 2
  const belowAnchor = anchorRect ? anchorRect.bottom + gap : centeredBlockStart
  const aboveAnchor = anchorRect ? anchorRect.top - dialogHeight - gap : centeredBlockStart
  const blockStart = anchorRect && belowAnchor + dialogHeight <= viewportHeight - margin
    ? belowAnchor
    : clamp(
        aboveAnchor,
        margin,
        Math.max(margin, viewportHeight - dialogHeight - margin),
      )

  dialogElement.style.setProperty('--reader-word-card-inline-start', `${Math.round(inlineStart)}px`)
  dialogElement.style.setProperty('--reader-word-card-block-start', `${Math.round(blockStart)}px`)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function trackPresentation(dialogElement: HTMLDialogElement): {
  modal: boolean
  release: () => void
} {
  const ownerWindow = dialogElement.ownerDocument.defaultView
  const mediaQueryList = ownerWindow
    ?.matchMedia?.('(min-width: 768px) and (pointer: fine)')
  if (!mediaQueryList) {
    return { modal: true, release: () => {} }
  }

  const handleChange = (): void => {
    replaceDialogPresentation(!mediaQueryList.matches)
  }
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', handleChange)
    return {
      modal: !mediaQueryList.matches,
      release: () => mediaQueryList.removeEventListener('change', handleChange),
    }
  }

  mediaQueryList.addListener(handleChange)
  return {
    modal: !mediaQueryList.matches,
    release: () => mediaQueryList.removeListener(handleChange),
  }
}

function replaceDialogPresentation(nextModalPresentation: boolean): void {
  const dialogElement = dialog.value
  if (!dialogElement || closeRequested
    || (modalSession && modalPresentation.value === nextModalPresentation)) {
    return
  }

  const activeElement = dialogElement.ownerDocument.activeElement
  const preservedFocus = activeElement
    && dialogElement.contains(activeElement)
    && typeof (activeElement as HTMLElement).focus === 'function'
    ? activeElement as HTMLElement
    : null
  const previousSession = modalSession
  modalSession = null
  presentationChanging = previousSession !== null
  try {
    previousSession?.release()
    modalPresentation.value = nextModalPresentation
    if (nextModalPresentation) {
      dialogElement.setAttribute('aria-modal', 'true')
      modalSession = openModalDialog(dialogElement, {
        fallbackBackdropClass: 'reader-word-card-overlay__fallback-backdrop',
      })
    }
    else {
      dialogElement.removeAttribute('aria-modal')
      modalSession = openNonModalDialog(dialogElement)
    }
  }
  finally {
    presentationChanging = false
  }

  const sessionVersion = ++presentationVersion
  void nextTick(() => {
    const currentDialog = dialog.value
    if (closeRequested
      || sessionVersion !== presentationVersion
      || !modalSession
      || !currentDialog?.open) {
      return
    }
    positionDialog()
    const focusTarget = preservedFocus?.isConnected
      ? preservedFocus
      : heading.value
    focusTarget?.focus({ preventScroll: true })
  })
}

function openNonModalDialog(dialogElement: HTMLDialogElement): ModalDialogSession {
  const usesFallback = typeof dialogElement.show !== 'function'
  if (usesFallback) {
    dialogElement.setAttribute('open', '')
  }
  else {
    dialogElement.show()
  }

  let released = false
  return {
    usesFallback,
    release: () => {
      if (released) {
        return
      }
      released = true
      if (dialogElement.open && typeof dialogElement.close === 'function') {
        dialogElement.close()
      }
      else {
        dialogElement.removeAttribute('open')
      }
    },
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="reader-word-card-overlay"
    :aria-modal="modalPresentation ? 'true' : undefined"
    :aria-labelledby="headingId"
    :aria-describedby="descriptionId"
    tabindex="-1"
    @cancel.prevent="requestClose('cancel')"
    @close="handleDialogClose"
    @keydown="handleDialogKeydown"
  >
    <header class="reader-word-card-overlay__header">
      <div class="reader-word-card-overlay__heading-copy">
        <p class="reader-word-card-overlay__eyebrow">
          本地词卡
        </p>
        <h2
          :id="headingId"
          ref="heading"
          class="reader-word-card-overlay__word"
          lang="en"
          tabindex="-1"
        >
          {{ props.token.text }}
        </h2>
        <p v-if="normalizedIpa" class="reader-word-card-overlay__ipa" lang="en">
          {{ normalizedIpa }}
        </p>
      </div>
      <button
        class="reader-word-card-overlay__close"
        type="button"
        aria-label="关闭词卡"
        @click="requestClose('close-button')"
      >
        <PhX aria-hidden="true" :size="20" />
      </button>
    </header>

    <div class="reader-word-card-overlay__body">
      <section :id="descriptionId" aria-labelledby="reader-word-card-meaning-heading">
        <h3 id="reader-word-card-meaning-heading" class="reader-word-card-overlay__section-title">
          基础释义
        </h3>
        <p v-if="meaning" class="reader-word-card-overlay__meaning">
          {{ meaning }}
        </p>
        <p v-else class="reader-word-card-overlay__meaning reader-word-card-overlay__meaning--empty">
          暂无本地释义，仍可收藏这个词和当前原句。
        </p>
      </section>

      <p v-if="props.errorMessage" class="reader-word-card-overlay__error" role="alert">
        {{ props.errorMessage }}
      </p>
      <p
        v-if="statusMessage"
        class="reader-word-card-overlay__status"
        role="status"
        aria-live="polite"
      >
        {{ statusMessage }}
      </p>

      <button
        class="reader-word-card-overlay__saved-action"
        type="button"
        :disabled="props.actionState !== 'idle'"
        :aria-pressed="props.actionState === 'loading' ? undefined : props.saved"
        @click="handleSavedAction"
      >
        {{ actionLabel }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.reader-word-card-overlay {
  position: fixed;
  inset: auto 0 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  box-sizing: border-box;
  inline-size: calc(100% + var(--modal-scrollbar-gutter, 0px));
  max-inline-size: none;
  max-block-size: min(78vh, 34rem);
  max-block-size: min(78dvh, 34rem);
  margin: 0;
  border: 1px solid var(--border-strong);
  border-block-end: 0;
  border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  padding: 0;
  overflow: hidden;
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
  z-index: 30;
  animation: reader-word-card-sheet-enter var(--duration-slow) var(--ease-out-soft);
  overscroll-behavior: contain;
}

.reader-word-card-overlay:not([open]) {
  display: none;
}

.reader-word-card-overlay[data-modal-fallback] {
  z-index: 101;
}

:global(.reader-word-card-overlay__fallback-backdrop) {
  position: fixed;
  inset: 0;
  inset-inline-end: calc(0px - var(--modal-scrollbar-gutter, 0px));
  z-index: 100;
  background: color-mix(in srgb, var(--surface-canvas) 42%, transparent);
  backdrop-filter: blur(4px);
  animation: reader-word-card-backdrop-enter var(--duration-normal) var(--ease-standard);
}

.reader-word-card-overlay::backdrop {
  background: color-mix(in srgb, var(--surface-canvas) 42%, transparent);
  backdrop-filter: blur(4px);
  animation: reader-word-card-backdrop-enter var(--duration-normal) var(--ease-standard);
}

.reader-word-card-overlay__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 1rem;
  border-block-end: 1px solid var(--reading-rule);
  padding:
    1.1rem
    max(1rem, env(safe-area-inset-right))
    1rem
    max(1rem, env(safe-area-inset-left));
}

.reader-word-card-overlay__heading-copy {
  min-inline-size: 0;
}

.reader-word-card-overlay__eyebrow,
.reader-word-card-overlay__word,
.reader-word-card-overlay__ipa,
.reader-word-card-overlay__section-title,
.reader-word-card-overlay__meaning,
.reader-word-card-overlay__error,
.reader-word-card-overlay__status {
  margin: 0;
}

.reader-word-card-overlay__eyebrow {
  color: var(--text-accent);
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0.08em;
}

.reader-word-card-overlay__word {
  margin-block-start: 0.18rem;
  font-family: var(--reading-font-heading);
  font-size: clamp(1.75rem, 8vw, 2.5rem);
  font-weight: 650;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.reader-word-card-overlay__word:focus {
  outline: 0;
}

.reader-word-card-overlay__ipa {
  margin-block-start: 0.35rem;
  color: var(--reading-fg-muted);
  font-family: var(--reading-font-mono);
  font-size: 0.9rem;
}

.reader-word-card-overlay__close {
  display: inline-grid;
  place-items: center;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding: 0;
  background: var(--surface-panel);
  color: var(--text-secondary);
  cursor: pointer;
}

.reader-word-card-overlay__body {
  min-block-size: 0;
  overflow-y: auto;
  padding:
    1.25rem
    max(1rem, env(safe-area-inset-right))
    max(1.5rem, calc(1rem + env(safe-area-inset-bottom)))
    max(1rem, env(safe-area-inset-left));
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}

.reader-word-card-overlay__section-title {
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.06em;
}

.reader-word-card-overlay__meaning {
  margin-block-start: 0.55rem;
  font-size: 1rem;
  line-height: 1.7;
}

.reader-word-card-overlay__meaning--empty,
.reader-word-card-overlay__status {
  color: var(--text-secondary);
}

.reader-word-card-overlay__error,
.reader-word-card-overlay__status {
  margin-block-start: 1rem;
  line-height: 1.55;
}

.reader-word-card-overlay__error {
  color: var(--text-danger, var(--text-primary));
}

.reader-word-card-overlay__saved-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  min-inline-size: 9rem;
  margin-block-start: 1.25rem;
  border: 1px solid var(--accent-primary-active);
  border-radius: var(--radius-control);
  padding-inline: 1rem;
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}

.reader-word-card-overlay__saved-action[aria-pressed="true"] {
  border-color: var(--border-strong);
  background: var(--surface-panel);
  color: var(--text-primary);
}

.reader-word-card-overlay__saved-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.reader-word-card-overlay__close:focus-visible,
.reader-word-card-overlay__saved-action:focus-visible {
  outline: 3px solid var(--reading-focus);
  outline-offset: 3px;
}

@media (hover: hover) {
  .reader-word-card-overlay__close:hover,
  .reader-word-card-overlay__saved-action[aria-pressed="true"]:hover {
    background: var(--accent-soft);
    color: var(--text-accent);
  }
}

@media (min-width: 768px) and (pointer: fine) {
  .reader-word-card-overlay {
    inset:
      var(--reader-word-card-block-start, 1rem)
      auto
      auto
      var(--reader-word-card-inline-start, 1rem);
    inline-size: min(22rem, calc(100vw - 2rem));
    max-block-size: min(32rem, calc(100vh - 2rem));
    max-block-size: min(32rem, calc(100dvh - 2rem));
    border-block-end: 1px solid var(--border-strong);
    border-radius: var(--radius-xl);
    animation-name: reader-word-card-popover-enter;
  }

  .reader-word-card-overlay__header {
    padding: 1rem;
  }

  .reader-word-card-overlay__body {
    padding: 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-word-card-overlay,
  .reader-word-card-overlay::backdrop,
  :global(.reader-word-card-overlay__fallback-backdrop) {
    animation: none;
  }
}

@media (forced-colors: active) {
  .reader-word-card-overlay,
  .reader-word-card-overlay__close,
  .reader-word-card-overlay__saved-action {
    border-color: ButtonText;
  }
}

@keyframes reader-word-card-sheet-enter {
  from {
    transform: translateY(2rem);
  }
}

@keyframes reader-word-card-popover-enter {
  from {
    transform: translateY(0.5rem);
    opacity: 0;
  }
}

@keyframes reader-word-card-backdrop-enter {
  from {
    opacity: 0;
  }
}
</style>
