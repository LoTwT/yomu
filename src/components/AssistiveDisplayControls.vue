<script setup lang="ts">
import type { DisplayPreferences } from '@/features/preferences/types'

const model = defineModel<DisplayPreferences>({ required: true })

function updatePreference(key: keyof DisplayPreferences, value: boolean) {
  model.value = {
    ...model.value,
    [key]: value,
  }
}
</script>

<template>
  <fieldset class="assistive-display" aria-label="Assistive display">
    <legend class="assistive-display__legend">
      Assistive display
    </legend>
    <label class="assistive-display__option">
      <input
        type="checkbox"
        :checked="model.showTranslation"
        @change="updatePreference('showTranslation', ($event.target as HTMLInputElement).checked)"
      />
      Translation
    </label>
    <label class="assistive-display__option">
      <input
        type="checkbox"
        :checked="model.showPronunciation"
        @change="updatePreference('showPronunciation', ($event.target as HTMLInputElement).checked)"
      />
      IPA
    </label>
  </fieldset>
</template>

<style scoped>
.assistive-display {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  margin: 0;
  padding: 0.45rem 0.75rem;
  background: color-mix(in srgb, var(--yomu-paper) 84%, white);
}

.assistive-display__legend {
  padding-inline: 0.25rem;
  color: var(--yomu-muted);
  font-size: 0.78rem;
}

.assistive-display__option {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  gap: 0.35rem;
  color: var(--yomu-ink-soft);
  font-size: 0.9rem;
}

.assistive-display__option input {
  accent-color: var(--yomu-accent);
}
</style>
