<script setup lang="ts">
import { computed, shallowRef } from 'vue'

import type { AudioStatus } from '@/features/player/useReadAloudSession'
import type { TtsProviderId } from '@/features/tts/types'

const props = defineProps<{
  activeIndex: number
  total: number
  isPlaying: boolean
  audioStatus: AudioStatus
  activeProvider: TtsProviderId
  playbackRate: number
  providerLabel: string
  canPlay: boolean
  disabledReason: string | null
  showCloudConsent: boolean
}>()

const emit = defineEmits<{
  play: []
  pause: []
  previous: []
  next: []
  repeat: []
  retryAudio: []
  skipAudio: []
  openSettings: []
  acceptCloudReadAloud: []
  continueReadOnly: []
  useWebSpeech: []
  setRate: [rate: number]
}>()

const rates = [0.85, 1, 1.15]
const isMoreOpen = shallowRef(false)
const sentencePositionLabel = computed(() => props.total > 0
  ? `第 ${props.activeIndex + 1}/${props.total} 句`
  : '未选择句子')
const progressPercent = computed(() => {
  if (props.total <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, ((props.activeIndex + 1) / props.total) * 100))
})
const liveStatusText = computed(() => {
  if (props.audioStatus === 'loading') {
    return `${sentencePositionLabel.value},准备朗读中`
  }
  if (props.audioStatus === 'failed') {
    return `${sentencePositionLabel.value},这一句朗读没有加载成功`
  }
  if (props.isPlaying) {
    return `${sentencePositionLabel.value},${props.providerLabel}进行中`
  }

  return `${sentencePositionLabel.value},朗读已暂停`
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
  <section class="read-aloud-controls" aria-label="逐句领读控制" role="region">
    <div class="read-aloud-controls__meter" aria-hidden="true">
      <span :style="{ inlineSize: `${progressPercent}%` }" />
    </div>
    <p class="read-aloud-controls__status read-aloud-controls__sr" aria-live="polite">
      {{ liveStatusText }}
    </p>
    <div class="read-aloud-controls__provider-row">
      <span class="read-aloud-controls__provider">{{ providerLabel }}</span>
      <button type="button" class="read-aloud-controls__settings" @click="emit('openSettings')">
        语音设置
      </button>
    </div>
    <div v-if="showCloudConsent" class="read-aloud-controls__cloud-consent">
      <p>
        MiMo 云朗读会在你按下播放时发送当前句和接下来的少量句子,并按所选语音服务条款处理。
      </p>
      <button type="button" @click="emit('acceptCloudReadAloud')">
        开始云朗读
      </button>
      <button type="button" @click="emit('continueReadOnly')">
        继续阅读
      </button>
    </div>
    <div class="read-aloud-controls__row">
      <button type="button" aria-label="上一句" @click="emit('previous')">
        ◁
      </button>
      <button
        type="button"
        class="read-aloud-controls__primary"
        :disabled="!canPlay"
        :aria-label="isPlaying ? '暂停朗读' : '播放朗读'"
        @click="isPlaying ? emit('pause') : emit('play')"
      >
        {{ isPlaying ? '❚❚' : '▶' }}
      </button>
      <button type="button" aria-label="下一句" @click="emit('next')">
        ▷
      </button>
      <span class="read-aloud-controls__count" aria-hidden="true">{{ activeIndex + 1 }}/{{ total }}</span>
      <div class="read-aloud-controls__more-wrap">
        <button
          type="button"
          aria-label="更多朗读选项"
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
          <fieldset class="read-aloud-controls__rates" aria-label="朗读速度">
            <legend>速度</legend>
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
            重复本句
          </button>
        </div>
      </div>
    </div>
    <div v-if="disabledReason" class="read-aloud-controls__fallback">
      <span>{{ disabledReason }}</span>
      <button type="button" @click="emit('openSettings')">
        打开语音设置
      </button>
    </div>
    <div v-if="audioStatus === 'failed'" class="read-aloud-controls__fallback">
      <span aria-hidden="true">这一句朗读没有加载成功。</span>
      <button type="button" @click="emit('skipAudio')">
        跳过
      </button>
      <button type="button" @click="emit('retryAudio')">
        重试
      </button>
      <button
        v-if="activeProvider === 'mimo'"
        type="button"
        @click="emit('useWebSpeech')"
      >
        改用浏览器朗读
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

.read-aloud-controls__provider-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  margin-block-end: 0.45rem;
  padding-inline: 0.25rem;
}

.read-aloud-controls__provider {
  color: var(--yomu-muted);
  font-size: 0.82rem;
}

.read-aloud-controls__settings {
  min-block-size: 2rem !important;
  min-inline-size: 0 !important;
  border: 0 !important;
  padding-inline: 0 !important;
  background: transparent !important;
  color: var(--yomu-accent) !important;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--yomu-accent) 45%, transparent);
  text-underline-offset: 0.18em;
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

.read-aloud-controls__cloud-consent {
  display: grid;
  gap: 0.55rem;
  border-block-start: 1px solid var(--yomu-rule);
  border-block-end: 1px solid var(--yomu-rule);
  margin-block: 0.55rem;
  padding-block: 0.65rem;
  color: var(--yomu-muted);
  font-size: 0.9rem;
}

.read-aloud-controls__cloud-consent p {
  margin: 0;
  line-height: 1.55;
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

.read-aloud-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
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
