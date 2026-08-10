<script setup lang="ts">
import { computed, useId } from 'vue'

import type { ArticleRecord } from '@/data/entities'
import type {
  ReaderDisplayPreferencesPersistenceStatus,
  ReaderFontScale,
} from '@/features/preferences/useReaderDisplayPreferences'
import type { PreferencePersistence } from '@/platform/contracts'

const props = withDefaults(defineProps<{
  articleCapabilities?: ArticleRecord['capabilities']
  defaultExpandTranslation: boolean
  fontScale: ReaderFontScale
  persistence: PreferencePersistence
  persistenceStatus?: ReaderDisplayPreferencesPersistenceStatus
  showIpa: boolean
}>(), {
  articleCapabilities: undefined,
  persistenceStatus: 'idle',
})

const emit = defineEmits<{
  'update:defaultExpandTranslation': [value: boolean]
  'update:fontScale': [value: ReaderFontScale]
  'update:showIpa': [value: boolean]
}>()

const controlId = useId()
const fontScaleOptions: ReadonlyArray<{
  label: string
  value: ReaderFontScale
}> = [
  { label: '较小', value: 0.9 },
  { label: '标准', value: 1 },
  { label: '较大', value: 1.15 },
  { label: '特大', value: 1.3 },
]

const translationAvailable = computed(() =>
  props.articleCapabilities === undefined
  || props.articleCapabilities.sentenceTranslation !== 'none')
const ipaAvailable = computed(() =>
  props.articleCapabilities !== undefined
  && props.articleCapabilities.sentenceIpa !== 'none')
const persistenceMessage = computed(() => {
  switch (props.persistenceStatus) {
    case 'saving':
      return '正在保存字号与译文偏好…'
    case 'saved':
      return props.persistence === 'device'
        ? '字号与译文偏好已保存到此设备'
        : '字号与译文偏好仅在本次会话中保留'
    case 'error':
      return '字号与译文偏好保存失败，请重试'
    default:
      return ''
  }
})

function updateDefaultExpandTranslation(event: Event): void {
  emit(
    'update:defaultExpandTranslation',
    (event.currentTarget as HTMLInputElement).checked,
  )
}

function updateShowIpa(event: Event): void {
  emit('update:showIpa', (event.currentTarget as HTMLInputElement).checked)
}
</script>

<template>
  <div class="reader-display-settings">
    <fieldset class="reader-display-settings__group">
      <legend class="reader-display-settings__legend">
        正文字号
      </legend>
      <p :id="`${controlId}-font-scale-help`" class="reader-display-settings__help">
        调整英文正文大小，行距会随字号一起保持舒适。
      </p>
      <div class="reader-display-settings__scale-options">
        <label
          v-for="option in fontScaleOptions"
          :key="option.value"
          class="reader-display-settings__scale-option"
          :class="{
            'reader-display-settings__scale-option--selected': props.fontScale === option.value,
          }"
        >
          <input
            class="reader-display-settings__scale-input"
            type="radio"
            :name="`${controlId}-font-scale`"
            :value="option.value"
            :checked="props.fontScale === option.value"
            :aria-describedby="`${controlId}-font-scale-help`"
            @change="emit('update:fontScale', option.value)"
          />
          <span class="reader-display-settings__scale-label">{{ option.label }}</span>
          <span class="reader-display-settings__scale-value">{{ Math.round(option.value * 100) }}%</span>
        </label>
      </div>
    </fieldset>

    <fieldset
      v-if="translationAvailable || ipaAvailable"
      class="reader-display-settings__group reader-display-settings__group--assistance"
    >
      <legend class="reader-display-settings__legend">
        阅读辅助
      </legend>

      <label v-if="translationAvailable" class="reader-display-settings__toggle">
        <span class="reader-display-settings__toggle-copy">
          <span class="reader-display-settings__toggle-title">打开文章时展开译文</span>
          <span class="reader-display-settings__help">只影响初始状态，阅读时仍可逐句展开或收起。</span>
        </span>
        <input
          class="reader-display-settings__checkbox"
          type="checkbox"
          :checked="props.defaultExpandTranslation"
          @change="updateDefaultExpandTranslation"
        />
      </label>

      <label v-if="ipaAvailable" class="reader-display-settings__toggle">
        <span class="reader-display-settings__toggle-copy">
          <span class="reader-display-settings__toggle-title">本次阅读显示 IPA</span>
          <span class="reader-display-settings__help">仅对当前阅读会话生效，不保存到设备。</span>
        </span>
        <input
          class="reader-display-settings__checkbox"
          type="checkbox"
          :checked="props.showIpa"
          @change="updateShowIpa"
        />
      </label>
    </fieldset>

    <p
      v-if="persistenceMessage"
      class="reader-display-settings__status"
      :class="{
        'reader-display-settings__status--error': props.persistenceStatus === 'error',
      }"
      :role="props.persistenceStatus === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >
      {{ persistenceMessage }}
    </p>
  </div>
</template>

<style scoped>
.reader-display-settings {
  display: grid;
  gap: 1.5rem;
  color: var(--reading-fg);
}

.reader-display-settings__group {
  min-inline-size: 0;
  margin: 0;
  border: 0;
  padding: 0;
}

.reader-display-settings__group--assistance {
  border-block-start: 1px solid var(--reading-rule);
  padding-block-start: 1.5rem;
}

.reader-display-settings__legend {
  padding: 0;
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.05rem;
  font-weight: 680;
  line-height: 1.35;
}

.reader-display-settings__help {
  display: block;
  margin: 0.35rem 0 0;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
  line-height: 1.55;
}

.reader-display-settings__scale-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin-block-start: 0.85rem;
}

.reader-display-settings__scale-option {
  position: relative;
  display: grid;
  place-items: center;
  align-content: center;
  min-block-size: 3.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding: 0.45rem 0.25rem;
  background: var(--surface-panel);
  color: var(--text-secondary);
  text-align: center;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.reader-display-settings__scale-option--selected {
  border-color: var(--reading-accent);
  background: var(--accent-soft);
  color: var(--reading-fg);
}

.reader-display-settings__scale-option:focus-within {
  outline: 2px solid var(--reading-focus);
  outline-offset: 3px;
  box-shadow: var(--reading-focus-shadow);
}

.reader-display-settings__scale-input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.reader-display-settings__scale-label,
.reader-display-settings__scale-value {
  display: block;
}

.reader-display-settings__scale-label {
  font-size: 0.85rem;
  font-weight: 680;
}

.reader-display-settings__scale-value {
  margin-block-start: 0.08rem;
  color: var(--text-muted);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.reader-display-settings__toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  min-block-size: 4.5rem;
  cursor: pointer;
}

.reader-display-settings__toggle + .reader-display-settings__toggle {
  border-block-start: 1px solid var(--border-subtle);
}

.reader-display-settings__toggle-copy {
  min-inline-size: 0;
}

.reader-display-settings__toggle-title {
  display: block;
  color: var(--text-primary);
  font-size: 0.92rem;
  font-weight: 650;
  line-height: 1.45;
}

.reader-display-settings__checkbox {
  inline-size: 1.35rem;
  block-size: 1.35rem;
  margin: 0.7rem;
  accent-color: var(--reading-accent);
  cursor: pointer;
}

.reader-display-settings__checkbox:focus-visible {
  outline: 2px solid var(--reading-focus);
  outline-offset: 3px;
  box-shadow: var(--reading-focus-shadow);
}

.reader-display-settings__status {
  min-block-size: 1.4rem;
  margin: -0.5rem 0 0;
  color: var(--status-success-fg);
  font-size: 0.78rem;
  line-height: 1.4;
}

.reader-display-settings__status--error {
  color: var(--status-danger-fg);
}

@media (max-width: 359px) {
  .reader-display-settings__scale-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (hover: hover) {
  .reader-display-settings__scale-option:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .reader-display-settings__scale-option--selected:hover {
    border-color: var(--reading-accent);
    background: var(--accent-soft);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-display-settings__scale-option {
    transition: none;
  }
}

@media (forced-colors: active) {
  .reader-display-settings__scale-option--selected {
    border-color: Highlight;
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }

  .reader-display-settings__scale-input {
    position: static;
    inline-size: 1rem;
    block-size: 1rem;
    overflow: visible;
    clip-path: none;
    white-space: normal;
  }
}
</style>
