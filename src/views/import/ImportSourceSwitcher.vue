<script setup lang="ts">
import { computed } from 'vue'

export type ImportSource = 'paste' | 'file' | 'url'

const props = withDefaults(defineProps<{
  fileAvailable: boolean
  fileUnavailableReason?: string
  urlAvailable: boolean
  urlUnavailableReason?: string
  disabled?: boolean
}>(), {
  fileUnavailableReason: '当前平台尚未接入文件选择。',
  urlUnavailableReason: '当前平台尚未接入网页正文提取。',
  disabled: false,
})

const model = defineModel<ImportSource>({ required: true })

const options = computed(() => [
  { value: 'paste', label: '粘贴文本', available: true, status: '' },
  {
    value: 'file',
    label: 'TXT / Markdown',
    available: props.fileAvailable,
    status: props.fileAvailable ? '' : '当前平台不可用',
  },
  {
    value: 'url',
    label: 'URL Beta',
    available: props.urlAvailable,
    status: props.urlAvailable ? '' : '当前不可用',
  },
] as const)

function optionTitle(option: (typeof options.value)[number]): string | undefined {
  if (props.disabled) {
    return '请先完成当前导入步骤'
  }
  if (option.value === 'file' && !option.available) {
    return props.fileUnavailableReason
  }
  if (option.value === 'url' && !option.available) {
    return props.urlUnavailableReason
  }
  if (!option.available) {
    return '将在后续版本开放'
  }
  return undefined
}
</script>

<template>
  <div class="source-switcher" role="group" aria-label="导入来源">
    <button
      v-for="option in options"
      :key="option.value"
      class="source-switcher__button"
      :class="{ 'source-switcher__button--active': model === option.value }"
      type="button"
      :aria-pressed="model === option.value"
      :disabled="props.disabled || !option.available"
      :title="optionTitle(option)"
      @click="model = option.value"
    >
      {{ option.label }}
      <span v-if="option.status" class="source-switcher__soon">{{ option.status }}</span>
    </button>
  </div>
</template>

<style scoped>
.source-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.source-switcher__button {
  display: grid;
  place-items: center;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  padding: 0.35rem 0.5rem;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.source-switcher__button--active {
  border-color: var(--accent-primary);
  color: var(--text-accent);
}

.source-switcher__button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.source-switcher__soon {
  font-size: 0.68rem;
  font-weight: 500;
}

.source-switcher__button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (max-width: 479px) {
  .source-switcher {
    grid-template-columns: 1fr;
  }

  .source-switcher__button {
    display: flex;
    justify-content: space-between;
    padding-inline: 0.75rem;
  }
}
</style>
