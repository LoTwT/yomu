<script setup lang="ts">
const props = defineProps<{
  text: string
  busy: boolean
}>()

const emit = defineEmits<{
  updateText: [value: string]
  parse: []
}>()

function handleInput(event: Event): void {
  emit('updateText', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <form class="paste-panel" @submit.prevent="emit('parse')">
    <label class="paste-panel__field">
      <span>英文正文</span>
      <textarea
        :value="props.text"
        rows="10"
        placeholder="在这里粘贴英文内容"
        autocomplete="off"
        :disabled="props.busy"
        @input="handleInput"
      />
    </label>
    <div class="paste-panel__footer">
      <p class="paste-panel__hint">
        正文会先在本机清洗和分句，不会因为生成预览而发送到第三方。
      </p>
      <button class="paste-panel__action" type="submit" :disabled="props.busy">
        {{ props.busy ? '正在生成…' : '生成预览' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.paste-panel {
  display: grid;
  gap: 1rem;
}

.paste-panel__field {
  display: grid;
  gap: 0.5rem;
  font-weight: 650;
}

.paste-panel__field textarea {
  inline-size: 100%;
  min-block-size: 13rem;
  resize: vertical;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
  line-height: 1.65;
}

.paste-panel__footer {
  display: grid;
  gap: 0.75rem;
}

.paste-panel__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.55;
}

.paste-panel__action {
  min-block-size: 2.75rem;
  border: 0;
  border-radius: 0.5rem;
  padding-inline: 1.25rem;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.paste-panel__action:disabled {
  cursor: wait;
  opacity: 0.65;
}

.paste-panel__field textarea:focus-visible,
.paste-panel__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (min-width: 768px) {
  .paste-panel__footer {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
}
</style>
