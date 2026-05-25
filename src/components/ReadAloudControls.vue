<script setup lang="ts">
import { computed, shallowRef } from 'vue'

import type { AudioStatus } from '@/features/player/useReadAloudSession'

const props = defineProps<{
  activeIndex: number
  total: number
  isPlaying: boolean
  audioStatus: AudioStatus
  playbackRate: number
}>()

const emit = defineEmits<{
  play: []
  pause: []
  previous: []
  next: []
  repeat: []
  retryAudio: []
  skipAudio: []
  setRate: [rate: number]
}>()

const rates = [0.85, 1, 1.15]
const isMoreOpen = shallowRef(false)
const progressPercent = computed(() => {
  if (props.total <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, ((props.activeIndex + 1) / props.total) * 100))
})

function setRate(rate: number) {
  emit('setRate', rate)
  isMoreOpen.value = false
}

function repeatSentence() {
  emit('repeat')
  isMoreOpen.value = false
}
</script>

<template>
  <section class="read-aloud-controls" aria-label="Read aloud controls" role="region">
    <div class="read-aloud-controls__meter" aria-hidden="true">
      <span :style="{ inlineSize: `${progressPercent}%` }" />
    </div>
    <p class="read-aloud-controls__status read-aloud-controls__sr" aria-live="polite">
      <span v-if="audioStatus === 'loading'">Loading audio...</span>
      <span v-else-if="audioStatus === 'failed'">This line's read-aloud didn't load.</span>
      <span v-else-if="isPlaying">Lead voice playing</span>
      <span v-else>Lead voice paused</span>
    </p>
    <div class="read-aloud-controls__row">
      <button type="button" aria-label="Previous sentence" @click="emit('previous')">
        ◁
      </button>
      <button
        type="button"
        class="read-aloud-controls__primary"
        :aria-label="isPlaying ? 'Pause lead voice' : 'Play lead voice'"
        @click="isPlaying ? emit('pause') : emit('play')"
      >
        {{ isPlaying ? '❚❚' : '▶' }}
      </button>
      <button type="button" aria-label="Next sentence" @click="emit('next')">
        ▷
      </button>
      <span class="read-aloud-controls__count" aria-hidden="true">{{ activeIndex + 1 }}/{{ total }}</span>
      <div class="read-aloud-controls__more-wrap">
        <button
          type="button"
          aria-label="More read-aloud options"
          :aria-expanded="isMoreOpen"
          aria-controls="read-aloud-more"
          @click="isMoreOpen = !isMoreOpen"
          @keydown.esc.stop.prevent="isMoreOpen = false"
        >
          ⋯
        </button>
        <div
          v-if="isMoreOpen"
          id="read-aloud-more"
          class="read-aloud-controls__more"
          @keydown.esc.stop.prevent="isMoreOpen = false"
        >
          <fieldset class="read-aloud-controls__rates" aria-label="Playback speed">
            <legend>Speed</legend>
            <button
              v-for="rate in rates"
              :key="rate"
              type="button"
              :aria-pressed="playbackRate === rate"
              @click="setRate(rate)"
            >
              {{ rate }}x
            </button>
          </fieldset>
          <button type="button" class="read-aloud-controls__repeat" @click="repeatSentence">
            Repeat sentence
          </button>
        </div>
      </div>
    </div>
    <div v-if="audioStatus === 'failed'" class="read-aloud-controls__fallback">
      <span aria-hidden="true">This line's read-aloud didn't load.</span>
      <button type="button" @click="emit('skipAudio')">
        Skip
      </button>
      <button type="button" @click="emit('retryAudio')">
        Try again
      </button>
    </div>
  </section>
</template>

<style scoped>
.read-aloud-controls {
  position: sticky;
  inset-block-end: 1rem;
  z-index: 10;
  max-inline-size: min(100% - 2rem, 42rem);
  border: 1px solid var(--yomu-rule);
  border-radius: 1rem;
  margin: -4rem auto 1rem;
  padding: 0.5rem;
  background: color-mix(in srgb, var(--yomu-paper) 90%, white);
  box-shadow: 0 16px 42px rgb(47 39 27 / 14%);
  backdrop-filter: blur(14px);
}

.read-aloud-controls__meter {
  overflow: hidden;
  block-size: 3px;
  border-radius: 999px;
  margin-block-end: 0.42rem;
  background: color-mix(in srgb, var(--yomu-rule) 68%, transparent);
}

.read-aloud-controls__meter span {
  display: block;
  block-size: 100%;
  border-radius: inherit;
  background: var(--yomu-accent);
  transition: inline-size 160ms ease;
}

.read-aloud-controls__row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
}

.read-aloud-controls__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.read-aloud-controls__count {
  min-inline-size: 2.15rem;
  color: var(--yomu-muted);
  font-size: 0.82rem;
  text-align: center;
}

.read-aloud-controls__more-wrap {
  position: relative;
}

.read-aloud-controls__fallback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  border-block-start: 1px solid var(--yomu-rule);
  margin-block-start: 0.55rem;
  padding-block-start: 0.55rem;
  color: var(--yomu-muted);
  font-size: 0.9rem;
}

.read-aloud-controls__more {
  position: absolute;
  inset-block-end: calc(100% + 0.45rem);
  inset-inline-end: 0;
  z-index: 2;
  display: grid;
  gap: 0.55rem;
  min-inline-size: min(18rem, calc(100vw - 2rem));
  padding: 0.7rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 0.85rem;
  background: var(--yomu-paper);
  box-shadow: 0 16px 42px rgb(47 39 27 / 16%);
}

.read-aloud-controls__rates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  margin: 0;
  padding: 0;
}

.read-aloud-controls__rates legend {
  margin-inline-end: 0.25rem;
  color: var(--yomu-muted);
  font-size: 0.82rem;
}

.read-aloud-controls button {
  min-block-size: 2.75rem;
  min-inline-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.75rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

.read-aloud-controls__primary {
  background: var(--yomu-accent) !important;
  color: var(--yomu-paper) !important;
  font-weight: 700;
}

.read-aloud-controls button[aria-pressed='true'] {
  border-color: var(--yomu-accent);
  color: var(--yomu-accent);
  font-weight: 700;
}

.read-aloud-controls button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .read-aloud-controls__meter span {
    transition: none;
  }
}
</style>
