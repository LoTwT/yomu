<script setup lang="ts">
import { computed } from 'vue'

import type { ReadingCompletionState } from '@/features/reader/useReadingSession'

export type ReaderCompletionState = ReadingCompletionState

const props = defineProps<{
  errorMessage?: string
  state: ReaderCompletionState
}>()

const emit = defineEmits<{
  complete: []
  openReview: []
}>()

const actionLabel = computed(() => {
  if (props.state === 'saving') {
    return '正在完成阅读…'
  }
  if (props.state === 'completed') {
    return '打开读后回顾'
  }
  if (props.state === 'error') {
    return '重试完成阅读'
  }
  return '完成阅读'
})

function handleAction(): void {
  if (props.state === 'completed') {
    emit('openReview')
    return
  }
  emit('complete')
}
</script>

<template>
  <section class="reader-completion" aria-labelledby="reader-completion-heading">
    <p class="reader-completion__eyebrow">
      阅读结束
    </p>
    <h2 id="reader-completion-heading" class="reader-completion__title">
      {{ props.state === 'completed' ? '本次阅读已保存' : '读完这篇文章了吗？' }}
    </h2>
    <p class="reader-completion__copy">
      {{ props.state === 'completed'
        ? '你可以打开独立回顾，查看本次实际阅读时间。'
        : '完成后会保存当前进度和实际阅读时间，并打开独立回顾。' }}
    </p>
    <p
      v-if="props.errorMessage"
      class="reader-completion__error"
      role="alert"
    >
      {{ props.errorMessage }}
    </p>
    <p v-else-if="props.state === 'saving'" class="reader-completion__status" role="status">
      正在停止朗读并保存最终进度，请稍候。
    </p>
    <button
      class="reader-completion__action"
      type="button"
      :disabled="props.state === 'saving'"
      @click="handleAction"
    >
      {{ actionLabel }}
    </button>
  </section>
</template>

<style scoped>
.reader-completion {
  inline-size: min(100%, 42rem);
  margin: 2.5rem auto 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 1rem;
  padding: clamp(1.25rem, 4vw, 2rem);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-panel);
}

.reader-completion__eyebrow {
  margin: 0 0 0.5rem;
  color: var(--text-accent);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.08em;
}

.reader-completion__title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-reading);
  font-size: clamp(1.35rem, 4vw, 1.8rem);
  line-height: 1.25;
}

.reader-completion__copy,
.reader-completion__error,
.reader-completion__status {
  margin-block: 0.75rem 0;
  color: var(--text-secondary);
  line-height: 1.65;
}

.reader-completion__error {
  color: var(--text-danger, var(--text-primary));
}

.reader-completion__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: 10rem;
  min-block-size: 2.75rem;
  margin-block-start: 1.25rem;
  border: 1px solid var(--accent-primary-active);
  border-radius: var(--radius-control);
  padding-inline: 1.25rem;
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}

.reader-completion__action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.reader-completion__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (max-width: 47.999rem) {
  .reader-completion__action {
    inline-size: 100%;
  }
}

@media (forced-colors: active) {
  .reader-completion__action {
    border-color: ButtonText;
  }
}
</style>
