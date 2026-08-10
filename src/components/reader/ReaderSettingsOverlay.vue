<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue'

import {
  useInteractionLayer,
  type InteractionLayerCloseReason,
  type ReleaseInteractionLayer,
} from '@/app/interactionLayer'
import {
  openModalDialog,
  type ModalDialogSession,
} from '@/app/modalDialog'
import type { ArticleRecord } from '@/data/entities'
import type {
  ReaderDisplayPreferencesPersistenceStatus,
  ReaderFontScale,
} from '@/features/preferences/useReaderDisplayPreferences'
import type { PreferencePersistence } from '@/platform/contracts'
import ReaderDisplaySettings from './ReaderDisplaySettings.vue'

export type ReaderSettingsCloseReason =
  | InteractionLayerCloseReason
  | 'cancel'
  | 'close-button'

const props = withDefaults(defineProps<{
  articleCapabilities?: ArticleRecord['capabilities']
  defaultExpandTranslation: boolean
  focusReturn?: HTMLElement | null
  fontScale: ReaderFontScale
  persistence: PreferencePersistence
  persistenceStatus?: ReaderDisplayPreferencesPersistenceStatus
  showIpa: boolean
}>(), {
  articleCapabilities: undefined,
  focusReturn: undefined,
  persistenceStatus: 'idle',
})

const emit = defineEmits<{
  close: [reason: ReaderSettingsCloseReason]
  'update:defaultExpandTranslation': [value: boolean]
  'update:fontScale': [value: ReaderFontScale]
  'update:showIpa': [value: boolean]
}>()

const interactionLayer = useInteractionLayer()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const persistenceDescription = computed(() => props.persistence === 'device'
  ? '字号与译文偏好会保存在此设备；IPA 只对本次阅读生效。'
  : '字号与译文偏好仅在本次会话中保留；IPA 也只对本次阅读生效。')
let releaseLayer: ReleaseInteractionLayer | null = null
let modalSession: ModalDialogSession | null = null
let closeRequested = false

onMounted(() => {
  const release = interactionLayer.registerLayer({
    focusReturn: readFocusReturn(),
    id: 'reader-settings',
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
  modalSession = openModalDialog(dialogElement, {
    fallbackBackdropClass: 'reader-settings-overlay__fallback-backdrop',
  })

  void nextTick(() => {
    const dialogElement = dialog.value
    const headingElement = heading.value
    if (closeRequested || !dialogElement?.open || !headingElement?.isConnected) {
      return
    }
    headingElement.focus({ preventScroll: true })
  })
})

onUnmounted(() => {
  closeRequested = true
  modalSession?.release()
  modalSession = null
  releaseLayer?.()
  releaseLayer = null
})

function requestClose(reason: ReaderSettingsCloseReason): void {
  if (closeRequested) {
    return
  }
  closeRequested = true

  const modal = modalSession
  modalSession = null
  const release = releaseLayer
  releaseLayer = null
  modal?.release()
  emit('close', reason)
  release?.()
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
</script>

<template>
  <dialog
    id="reader-settings"
    ref="dialog"
    class="reader-settings-overlay"
    aria-modal="true"
    aria-labelledby="reader-settings-heading"
    aria-describedby="reader-settings-description"
    tabindex="-1"
    @cancel.prevent="requestClose('cancel')"
    @close="requestClose('cancel')"
    @keydown="handleDialogKeydown"
  >
    <header class="reader-settings-overlay__header">
      <div class="reader-settings-overlay__heading-copy">
        <p class="reader-settings-overlay__eyebrow">
          阅读显示
        </p>
        <h2
          id="reader-settings-heading"
          ref="heading"
          class="reader-settings-overlay__title"
          tabindex="-1"
        >
          调整当前阅读
        </h2>
        <p id="reader-settings-description" class="reader-settings-overlay__description">
          {{ persistenceDescription }}
        </p>
      </div>
      <button
        class="reader-settings-overlay__close"
        type="button"
        aria-label="关闭阅读设置"
        @click="requestClose('close-button')"
      >
        <PhX aria-hidden="true" :size="20" />
      </button>
    </header>

    <div class="reader-settings-overlay__body">
      <ReaderDisplaySettings
        :article-capabilities="props.articleCapabilities"
        :default-expand-translation="props.defaultExpandTranslation"
        :font-scale="props.fontScale"
        :persistence="props.persistence"
        :persistence-status="props.persistenceStatus"
        :show-ipa="props.showIpa"
        @update:default-expand-translation="emit('update:defaultExpandTranslation', $event)"
        @update:font-scale="emit('update:fontScale', $event)"
        @update:show-ipa="emit('update:showIpa', $event)"
      />
    </div>
  </dialog>
</template>

<style scoped>
.reader-settings-overlay {
  position: fixed;
  inset: auto 0 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  inline-size: calc(100% + var(--modal-scrollbar-gutter, 0px));
  max-inline-size: none;
  max-block-size: min(85vh, 46rem);
  max-block-size: min(85dvh, 46rem);
  margin: 0;
  border: 1px solid var(--border-strong);
  border-block-end: 0;
  border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  padding: 0;
  overflow: hidden;
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
  animation: reader-settings-sheet-enter var(--duration-slow) var(--ease-out-soft);
  overscroll-behavior: contain;
}

.reader-settings-overlay:not([open]) {
  display: none;
}

.reader-settings-overlay[data-modal-fallback] {
  z-index: 101;
}

:global(.reader-settings-overlay__fallback-backdrop) {
  position: fixed;
  inset: 0;
  inset-inline-end: calc(0px - var(--modal-scrollbar-gutter, 0px));
  z-index: 100;
  background: color-mix(in srgb, var(--surface-canvas) 42%, transparent);
  backdrop-filter: blur(4px);
  animation: reader-settings-backdrop-enter var(--duration-normal) var(--ease-standard);
}

.reader-settings-overlay::backdrop {
  background: color-mix(in srgb, var(--surface-canvas) 42%, transparent);
  backdrop-filter: blur(4px);
  animation: reader-settings-backdrop-enter var(--duration-normal) var(--ease-standard);
}

.reader-settings-overlay__header {
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
  background: var(--surface-elevated);
}

.reader-settings-overlay__heading-copy {
  min-inline-size: 0;
}

.reader-settings-overlay__eyebrow,
.reader-settings-overlay__title,
.reader-settings-overlay__description {
  margin: 0;
}

.reader-settings-overlay__eyebrow {
  color: var(--text-accent);
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0.08em;
}

.reader-settings-overlay__title {
  margin-block-start: 0.18rem;
  font-family: var(--reading-font-heading);
  font-size: 1.5rem;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.025em;
}

.reader-settings-overlay__title:focus {
  outline: 0;
}

.reader-settings-overlay__description {
  margin-block-start: 0.4rem;
  color: var(--reading-fg-muted);
  font-size: 0.8rem;
  line-height: 1.55;
}

.reader-settings-overlay__close {
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
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.reader-settings-overlay__close:focus-visible {
  outline: 2px solid var(--reading-focus);
  outline-offset: 3px;
  box-shadow: var(--reading-focus-shadow);
}

.reader-settings-overlay__body {
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

@media (hover: hover) {
  .reader-settings-overlay__close:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
    color: var(--text-primary);
  }
}

@media (min-width: 768px) and (pointer: fine) {
  .reader-settings-overlay {
    inset: 0 0 0 auto;
    inset-inline-end: calc(0px - var(--modal-scrollbar-gutter, 0px));
    inline-size: clamp(22.5rem, 30vw, 25rem);
    block-size: 100vh;
    block-size: 100dvh;
    max-block-size: none;
    border-block: 0;
    border-inline-end: 0;
    border-radius: 0;
    animation-name: reader-settings-drawer-enter;
  }

  .reader-settings-overlay__header {
    padding-block-start: max(1.25rem, calc(1rem + env(safe-area-inset-top)));
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-settings-overlay,
  .reader-settings-overlay::backdrop {
    animation: none;
  }

  .reader-settings-overlay__close {
    transition: none;
  }
}

@media (forced-colors: active) {
  .reader-settings-overlay {
    border-color: CanvasText;
  }

  .reader-settings-overlay__close {
    border-color: ButtonText;
  }
}

@keyframes reader-settings-sheet-enter {
  from {
    transform: translateY(2rem);
  }
}

@keyframes reader-settings-drawer-enter {
  from {
    transform: translateX(2rem);
  }
}

@keyframes reader-settings-backdrop-enter {
  from {
    opacity: 0;
  }
}
</style>
