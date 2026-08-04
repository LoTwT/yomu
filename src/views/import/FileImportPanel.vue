<script setup lang="ts">
import { PhFileText, PhUploadSimple } from '@phosphor-icons/vue'
import { shallowRef } from 'vue'

const props = defineProps<{
  busy: boolean
  available: boolean
  unavailableReason: string
  dropAvailable: boolean
  fileName: string
}>()

const emit = defineEmits<{
  chooseFile: []
  retry: []
  dropFiles: [payload: unknown]
}>()

const isDragging = shallowRef(false)
let dragDepth = 0

function canReceiveDrop(): boolean {
  return props.available && props.dropAvailable && !props.busy
}

function handleDragEnter(event: DragEvent): void {
  if (!canReceiveDrop()) {
    return
  }
  event.preventDefault()
  dragDepth += 1
  isDragging.value = true
}

function handleDragOver(event: DragEvent): void {
  if (!canReceiveDrop()) {
    return
  }
  event.preventDefault()
}

function handleDragLeave(event: DragEvent): void {
  if (!canReceiveDrop()) {
    return
  }
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  isDragging.value = dragDepth > 0
}

function handleDrop(event: DragEvent): void {
  if (!canReceiveDrop()) {
    return
  }
  event.preventDefault()
  dragDepth = 0
  isDragging.value = false
  emit('dropFiles', event)
}
</script>

<template>
  <section
    class="file-panel"
    :class="{ 'file-panel--dragging': isDragging }"
    data-testid="file-drop-zone"
    :aria-busy="props.busy"
    aria-labelledby="file-panel-heading"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="file-panel__hero">
      <span class="file-panel__icon" aria-hidden="true">
        <PhUploadSimple :size="28" />
      </span>
      <div class="file-panel__copy">
        <h2 id="file-panel-heading" class="file-panel__title">
          选择文本文件
        </h2>
        <p class="file-panel__description">
          支持 UTF-8 编码的 .txt 与 .md，单个文件最大 250 KB。
        </p>
      </div>
      <button
        class="file-panel__choose"
        type="button"
        :disabled="props.busy || !props.available"
        @click="emit('chooseFile')"
      >
        {{ props.busy ? '正在读取…' : props.fileName ? '选择其他文件' : '选择文件' }}
      </button>
      <p v-if="props.dropAvailable" class="file-panel__drop-hint">
        或在宽屏桌面上把一个文件拖放到此处
      </p>
      <p v-if="!props.available" class="file-panel__unavailable" role="status">
        {{ props.unavailableReason }}可以继续使用“粘贴文本”。
      </p>
    </div>

    <div v-if="props.fileName" class="file-panel__selection" aria-live="polite">
      <PhFileText class="file-panel__file-icon" :size="24" aria-hidden="true" />
      <div class="file-panel__file-copy">
        <span class="file-panel__file-label">当前文件</span>
        <strong class="file-panel__file-name">{{ props.fileName }}</strong>
      </div>
      <button
        class="file-panel__retry"
        type="button"
        :disabled="props.busy || !props.available"
        @click="emit('retry')"
      >
        重新生成预览
      </button>
    </div>

    <p class="file-panel__privacy">
      文件只在此设备上读取并生成预览，不会因为文件导入发送到第三方。
    </p>
  </section>
</template>

<style scoped>
.file-panel {
  display: grid;
  gap: 1rem;
}

.file-panel__hero {
  display: grid;
  justify-items: start;
  gap: 0.85rem;
  border: 1px dashed var(--border-strong);
  border-radius: 0.65rem;
  padding: 1.25rem;
  background: var(--surface-canvas);
  transition: border-color 140ms ease, background-color 140ms ease;
}

.file-panel--dragging .file-panel__hero {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
}

.file-panel__icon {
  display: inline-grid;
  place-items: center;
  inline-size: 3rem;
  block-size: 3rem;
  border-radius: 0.65rem;
  background: var(--accent-soft);
  color: var(--text-accent);
}

.file-panel__copy {
  display: grid;
  gap: 0.35rem;
}

.file-panel__title,
.file-panel__description,
.file-panel__drop-hint,
.file-panel__unavailable,
.file-panel__privacy {
  margin: 0;
}

.file-panel__title {
  font-size: 1.15rem;
}

.file-panel__description,
.file-panel__drop-hint,
.file-panel__privacy {
  color: var(--text-secondary);
  line-height: 1.55;
}

.file-panel__description,
.file-panel__privacy {
  font-size: 0.875rem;
}

.file-panel__drop-hint {
  display: none;
  font-size: 0.8rem;
}

.file-panel__unavailable {
  color: var(--status-warning-fg);
  font-size: 0.875rem;
  line-height: 1.55;
}

.file-panel__choose,
.file-panel__retry {
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.file-panel__choose {
  border: 0;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.file-panel__retry {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-accent);
}

.file-panel__choose:disabled,
.file-panel__retry:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.file-panel__selection {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.6rem;
  padding: 0.85rem;
  background: var(--surface-elevated);
}

.file-panel__file-icon {
  color: var(--text-accent);
}

.file-panel__file-copy {
  display: grid;
  min-inline-size: 0;
  gap: 0.15rem;
}

.file-panel__file-label {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.file-panel__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-panel__retry {
  grid-column: 1 / -1;
}

.file-panel__choose:focus-visible,
.file-panel__retry:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .file-panel__hero {
    transition: none;
  }
}

@media (min-width: 768px) {
  .file-panel__hero {
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
  }

  .file-panel__icon {
    grid-row: 1 / span 2;
  }

  .file-panel__drop-hint {
    grid-column: 2 / -1;
  }

  .file-panel__selection {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .file-panel__retry {
    grid-column: auto;
  }
}

@media (min-width: 1200px) and (hover: hover) and (pointer: fine) {
  .file-panel__hero {
    min-block-size: 13rem;
    align-content: center;
  }

  .file-panel__drop-hint {
    display: block;
  }
}

@media (forced-colors: active) {
  .file-panel__hero,
  .file-panel__icon {
    border: 1px solid CanvasText;
  }
}
</style>
