<script setup lang="ts">
import {
  PhPause,
  PhPlay,
  PhSkipBack,
  PhSkipForward,
} from '@phosphor-icons/vue'

const props = defineProps<{
  currentIndex: number
  total: number
  isPlaying: boolean
  speechAvailable: boolean
}>()

const emit = defineEmits<{
  previous: []
  togglePlayback: []
  next: []
}>()
</script>

<template>
  <div class="reader-controls" role="group" aria-label="逐句阅读控制">
    <button
      class="reader-controls__button"
      type="button"
      aria-label="上一句"
      :disabled="props.currentIndex <= 0"
      @click="emit('previous')"
    >
      <PhSkipBack aria-hidden="true" :size="22" weight="fill" />
    </button>
    <button
      class="reader-controls__play"
      type="button"
      :aria-label="props.isPlaying ? '暂停朗读' : '朗读当前句'"
      :title="props.speechAvailable ? undefined : '此设备没有可用的本机朗读能力'"
      :disabled="!props.speechAvailable"
      @click="emit('togglePlayback')"
    >
      <PhPause v-if="props.isPlaying" aria-hidden="true" :size="24" weight="fill" />
      <PhPlay v-else aria-hidden="true" :size="24" weight="fill" />
    </button>
    <p class="reader-controls__position" aria-live="polite">
      第 {{ props.currentIndex + 1 }} / {{ props.total }} 句
    </p>
    <button
      class="reader-controls__button"
      type="button"
      aria-label="下一句"
      :disabled="props.currentIndex >= props.total - 1"
      @click="emit('next')"
    >
      <PhSkipForward aria-hidden="true" :size="22" weight="fill" />
    </button>
  </div>
</template>

<style scoped>
.reader-controls {
  display: grid;
  grid-template-columns: 2.75rem 3rem minmax(6rem, 1fr) 2.75rem;
  align-items: center;
  gap: 0.45rem;
  inline-size: min(calc(100% - 2rem), 45rem);
  min-block-size: 4rem;
  margin-inline: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 0.45rem;
  background: var(--surface-elevated);
  box-shadow: var(--shadow-panel);
}

.reader-controls__button,
.reader-controls__play {
  display: inline-grid;
  place-items: center;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.reader-controls__play {
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.reader-controls__button:disabled,
.reader-controls__play:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.reader-controls__position {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.reader-controls__button:focus-visible,
.reader-controls__play:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}
</style>
