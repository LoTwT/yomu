<script setup lang="ts">
import { useTemplateRef } from 'vue'

import type { AiWordExpansionState, ReadExpansionTerm } from '@/features/extension/types'
import type { ReadExpansionSettings } from '@/features/extension/settings'

import ReadExpansionCard from './ReadExpansionCard.vue'
import ReadExpansionConsent from './ReadExpansionConsent.vue'
import ReadExpansionSettingsPanel from './ReadExpansionSettingsPanel.vue'

const settings = defineModel<ReadExpansionSettings>('settings', { required: true })

defineProps<{
  terms: ReadExpansionTerm[]
  aiStates: Record<string, AiWordExpansionState>
  aiConfigured: boolean
  providerLabel: string
  showConsentPrompt: boolean
}>()

const emit = defineEmits<{
  requestAi: [term: ReadExpansionTerm]
  acceptAi: []
  declineAi: []
}>()

const settingsRegion = useTemplateRef<HTMLElement>('settingsRegion')

function stateFor(term: ReadExpansionTerm, states: Record<string, AiWordExpansionState>): AiWordExpansionState {
  return states[term.id] ?? { status: 'idle' }
}

function focusSettings() {
  const region = settingsRegion.value
  if (!region) {
    return
  }

  region.scrollIntoView({
    block: 'nearest',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
  window.requestAnimationFrame(() => {
    region.focus({ preventScroll: true })
  })
}
</script>

<template>
  <section class="read-expansion-panel" aria-labelledby="read-expansion-title">
    <div class="read-expansion-panel__header">
      <p class="read-expansion-panel__eyebrow">
        拓展
      </p>
      <h3 id="read-expansion-title" class="read-expansion-panel__title">
        读后拓展
      </h3>
      <p class="read-expansion-panel__copy">
        默认本地抽词,不发送文章内容。需要更丰富释义时,可开启 AI 增强并使用你自己的 key。
      </p>
    </div>

    <div
      ref="settingsRegion"
      class="read-expansion-panel__settings-anchor"
      tabindex="-1"
      aria-label="读后拓展 AI 设置"
    >
      <ReadExpansionSettingsPanel v-model="settings" />
    </div>

    <ReadExpansionConsent
      v-if="showConsentPrompt"
      :provider-label="providerLabel"
      @accept="emit('acceptAi')"
      @decline="emit('declineAi')"
    />

    <p v-if="!terms.length" class="read-expansion-panel__empty">
      这篇没抽到生词。
    </p>
    <div v-else class="read-expansion-panel__grid">
      <ReadExpansionCard
        v-for="term in terms"
        :key="term.id"
        :term="term"
        :ai-state="stateFor(term, aiStates)"
        :ai-enabled="settings.ai.enabled"
        :ai-configured="aiConfigured"
        :provider-label="providerLabel"
        @request-ai="emit('requestAi', $event)"
        @open-settings="focusSettings"
      />
    </div>
  </section>
</template>

<style scoped>
.read-expansion-panel {
  display: grid;
  gap: 1rem;
  margin-block-start: 1.5rem;
}

.read-expansion-panel__header {
  display: grid;
  gap: 0.4rem;
}

.read-expansion-panel__eyebrow,
.read-expansion-panel__copy,
.read-expansion-panel__empty {
  margin: 0;
  color: var(--yomu-muted);
  line-height: 1.7;
}

.read-expansion-panel__eyebrow {
  font-size: 0.82rem;
}

.read-expansion-panel__title {
  margin: 0;
  color: var(--yomu-ink);
  font-size: 1.1rem;
}

.read-expansion-panel__grid {
  display: grid;
  gap: 0.75rem;
}

.read-expansion-panel__settings-anchor:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}
</style>
