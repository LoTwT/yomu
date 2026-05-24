<script setup lang="ts">
defineProps<{
  activeIndex: number
  total: number
  isPlaying: boolean
  playbackRate: number
}>()

const emit = defineEmits<{
  play: []
  pause: []
  previous: []
  next: []
  repeat: []
  setRate: [rate: number]
}>()

const rates = [0.85, 1, 1.15]
</script>

<template>
  <section class="read-aloud-controls" aria-label="Read aloud controls" role="region">
    <p class="read-aloud-controls__status" aria-live="polite">
      <span v-if="isPlaying">Lead voice playing</span>
      <span v-else>Lead voice paused</span>
    </p>
    <p class="read-aloud-controls__progress" aria-hidden="true">
      Sentence {{ activeIndex + 1 }} of {{ total }}
    </p>
    <div class="read-aloud-controls__row">
      <button type="button" @click="emit('previous')">
        Previous
      </button>
      <button
        type="button"
        class="read-aloud-controls__primary"
        @click="isPlaying ? emit('pause') : emit('play')"
      >
        {{ isPlaying ? 'Pause' : 'Play' }}
      </button>
      <button type="button" @click="emit('next')">
        Next
      </button>
      <button type="button" @click="emit('repeat')">
        Repeat sentence
      </button>
    </div>
    <fieldset class="read-aloud-controls__rates" aria-label="Playback speed">
      <legend>Speed</legend>
      <button
        v-for="rate in rates"
        :key="rate"
        type="button"
        :aria-pressed="playbackRate === rate"
        @click="emit('setRate', rate)"
      >
        {{ rate }}x
      </button>
    </fieldset>
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
  margin: -6.5rem auto 1rem;
  padding: 0.85rem;
  background: color-mix(in srgb, var(--yomu-paper) 90%, white);
  box-shadow: 0 16px 42px rgb(47 39 27 / 14%);
  backdrop-filter: blur(14px);
}

.read-aloud-controls__status,
.read-aloud-controls__progress {
  margin: 0 0 0.6rem;
  color: var(--yomu-muted);
  font-size: 0.88rem;
}

.read-aloud-controls__progress {
  margin-block-start: -0.3rem;
}

.read-aloud-controls__row,
.read-aloud-controls__rates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.read-aloud-controls__rates {
  border: 0;
  margin: 0.65rem 0 0;
  padding: 0;
}

.read-aloud-controls__rates legend {
  margin-inline-end: 0.25rem;
  color: var(--yomu-muted);
  font-size: 0.82rem;
}

.read-aloud-controls button {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.8rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

.read-aloud-controls__primary {
  background: var(--yomu-accent) !important;
  color: var(--yomu-paper) !important;
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
</style>
