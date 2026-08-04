<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'

const emit = defineEmits<{
  keepEditing: []
  discard: []
}>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')

onMounted(() => {
  if (typeof dialog.value?.showModal === 'function') {
    dialog.value.showModal()
  }
  else {
    dialog.value?.setAttribute('open', '')
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="unsaved-dialog"
    aria-labelledby="unsaved-dialog-heading"
    aria-describedby="unsaved-dialog-description"
    @cancel.prevent="emit('keepEditing')"
  >
    <h2 id="unsaved-dialog-heading" class="unsaved-dialog__title">
      放弃未保存的导入？
    </h2>
    <p id="unsaved-dialog-description" class="unsaved-dialog__description">
      当前正文或预览还没有保存。离开后，这些修改将丢失。
    </p>
    <div class="unsaved-dialog__actions">
      <button class="unsaved-dialog__keep" type="button" @click="emit('keepEditing')">
        继续编辑
      </button>
      <button class="unsaved-dialog__discard" type="button" @click="emit('discard')">
        放弃并离开
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.unsaved-dialog {
  inline-size: min(calc(100% - 2rem), 30rem);
  max-inline-size: 30rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
}

.unsaved-dialog::backdrop {
  background: color-mix(in srgb, var(--surface-canvas) 35%, transparent);
  backdrop-filter: blur(3px);
}

.unsaved-dialog__title,
.unsaved-dialog__description {
  margin: 0;
}

.unsaved-dialog__title {
  font-size: 1.35rem;
}

.unsaved-dialog__description {
  margin-block-start: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.65;
}

.unsaved-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.65rem;
  margin-block-start: 1.25rem;
}

.unsaved-dialog__keep,
.unsaved-dialog__discard {
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.unsaved-dialog__keep {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-accent);
}

.unsaved-dialog__discard {
  border: 0;
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.unsaved-dialog__keep:focus-visible,
.unsaved-dialog__discard:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}
</style>
