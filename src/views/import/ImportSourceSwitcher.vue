<script setup lang="ts">
export type ImportSource = 'paste' | 'file' | 'url'

const model = defineModel<ImportSource>({ required: true })

const options = [
  { value: 'paste', label: '粘贴文本', available: true },
  { value: 'file', label: 'TXT / Markdown', available: false },
  { value: 'url', label: 'URL Beta', available: false },
] as const
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
      :disabled="!option.available"
      :title="option.available ? undefined : '将在后续版本开放'"
      @click="model = option.value"
    >
      {{ option.label }}
      <span v-if="!option.available" class="source-switcher__soon">即将支持</span>
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
