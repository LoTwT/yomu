<script setup lang="ts">
import { useId, useTemplateRef } from 'vue'

import {
  readingPlaybackRates,
  type ReadingPlaybackRate,
} from '@/features/reader/useReadingSession'
import type { TtsProviderId } from '@/features/tts/types'

const props = defineProps<{
  activeProvider: TtsProviderId
  cloudFallbackActive: boolean
  cloudConsentRequired: boolean
  playbackRate: ReadingPlaybackRate
  providerLabel: string
}>()

const emit = defineEmits<{
  acceptCloudConsent: []
  declineCloudConsent: []
  manageServices: []
  repeat: []
  retryCloud: []
  'update:playbackRate': [value: ReadingPlaybackRate]
}>()

const controlId = useId()
const consentAccept = useTemplateRef<HTMLButtonElement>('consentAccept')

defineExpose({
  focusConsentAction() {
    const action = consentAccept.value
    action?.focus({ preventScroll: true })
    action?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  },
})
</script>

<template>
  <section class="reader-speech-settings" aria-labelledby="reader-speech-settings-title">
    <div class="reader-speech-settings__heading">
      <h3 id="reader-speech-settings-title">朗读</h3>
      <p>当前方式：{{ props.providerLabel }}</p>
    </div>

    <div
      v-if="props.cloudConsentRequired"
      class="reader-speech-settings__consent"
      role="group"
      :aria-labelledby="`${controlId}-cloud-title`"
      :aria-describedby="`${controlId}-cloud-description`"
    >
      <strong :id="`${controlId}-cloud-title`">是否发送当前句到 MiMo？</strong>
      <p :id="`${controlId}-cloud-description`">
        同意后，连续朗读期间会滚动发送当前句与后两句用于合成和预取；仅本次阅读有效，切换文章、服务或离开页面后会重置。
      </p>
      <div class="reader-speech-settings__consent-actions">
        <button ref="consentAccept" type="button" @click="emit('acceptCloudConsent')">同意并朗读</button>
        <button type="button" @click="emit('declineCloudConsent')">暂不发送</button>
      </div>
    </div>

    <fieldset class="reader-speech-settings__rates">
      <legend>语速</legend>
      <label v-for="rate in readingPlaybackRates" :key="rate">
        <input
          type="radio"
          :name="`${controlId}-rate`"
          :value="rate"
          :checked="props.playbackRate === rate"
          @change="emit('update:playbackRate', rate)"
        >
        <span>{{ rate }}×</span>
      </label>
    </fieldset>

    <div class="reader-speech-settings__actions">
      <button type="button" @click="emit('repeat')">重读当前句</button>
      <button
        v-if="props.cloudFallbackActive"
        type="button"
        @click="emit('retryCloud')"
      >
        重试 MiMo
      </button>
      <button type="button" @click="emit('manageServices')">管理语音服务</button>
    </div>
    <p v-if="props.activeProvider === 'mimo'" class="reader-speech-settings__privacy">
      MiMo 使用你自己的 API Key；Yomu 不会把 Key 写入导出文件。云端额度与费用由服务商决定。
    </p>
  </section>
</template>

<style scoped>
.reader-speech-settings {
  display: grid;
  gap: 1rem;
  border-block-start: 1px solid var(--reading-rule);
  margin-block-start: 1.5rem;
  padding-block-start: 1.5rem;
  color: var(--reading-fg);
}

.reader-speech-settings__heading h3,
.reader-speech-settings__heading p,
.reader-speech-settings__consent p,
.reader-speech-settings__privacy {
  margin: 0;
}

.reader-speech-settings__heading h3,
.reader-speech-settings__rates legend {
  font-family: var(--reading-font-heading);
  font-size: 1.05rem;
  font-weight: 680;
}

.reader-speech-settings__heading p,
.reader-speech-settings__privacy,
.reader-speech-settings__consent p {
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
  line-height: 1.55;
}

.reader-speech-settings__consent {
  display: grid;
  gap: 0.65rem;
  border: 1px solid var(--reading-accent);
  border-radius: var(--radius-control);
  padding: 0.9rem;
  background: var(--accent-soft);
}

.reader-speech-settings__rates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  border: 0;
  padding: 0;
}

.reader-speech-settings__rates legend {
  inline-size: 100%;
  padding: 0;
}

.reader-speech-settings__rates label {
  position: relative;
  display: grid;
  place-items: center;
  min-inline-size: 4.5rem;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  cursor: pointer;
}

.reader-speech-settings__rates label:has(input:checked) {
  border-color: var(--reading-accent);
  background: var(--accent-soft);
}

.reader-speech-settings__rates input {
  position: absolute;
  opacity: 0;
}

.reader-speech-settings__rates label:focus-within,
.reader-speech-settings__actions button:focus-visible,
.reader-speech-settings__consent-actions button:focus-visible {
  outline: 2px solid var(--reading-focus);
  outline-offset: 3px;
}

.reader-speech-settings__actions,
.reader-speech-settings__consent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.reader-speech-settings__actions button,
.reader-speech-settings__consent-actions button {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding-inline: 0.9rem;
  background: var(--surface-panel);
  color: var(--text-primary);
  cursor: pointer;
}

@media (forced-colors: active) {
  .reader-speech-settings__rates label:has(input:checked) {
    border-color: Highlight;
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }

  .reader-speech-settings__rates input {
    position: static;
    inline-size: 1rem;
    block-size: 1rem;
    opacity: 1;
  }
}
</style>
