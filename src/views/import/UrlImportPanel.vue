<script setup lang="ts">
import { PhArrowRight, PhLinkSimple } from '@phosphor-icons/vue'

const props = defineProps<{
  url: string
  busy: boolean
  available: boolean
  unavailableReason: string
  showFallback: boolean
}>()

const emit = defineEmits<{
  updateUrl: [value: string]
  parse: []
  pasteFallback: []
}>()

function handleInput(event: Event): void {
  emit('updateUrl', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <form class="url-panel" @submit.prevent="emit('parse')">
    <div class="url-panel__intro">
      <span class="url-panel__icon" aria-hidden="true">
        <PhLinkSimple :size="26" />
      </span>
      <div>
        <h2 class="url-panel__title">从网页提取正文</h2>
        <p class="url-panel__description">
          Yomu 会受限抓取公开网页，再在此设备上识别标题与正文。此功能仍处于 Beta。
        </p>
      </div>
    </div>

    <label class="url-panel__field">
      <span>文章网址</span>
      <input
        :value="props.url"
        type="url"
        inputmode="url"
        autocomplete="url"
        autocapitalize="none"
        spellcheck="false"
        placeholder="https://example.com/article"
        :disabled="props.busy"
        @input="handleInput"
      >
    </label>

    <p v-if="!props.available" class="url-panel__unavailable" role="status">
      {{ props.unavailableReason }}
    </p>

    <div class="url-panel__footer">
      <p class="url-panel__privacy">
        只支持公开的 HTTP/HTTPS 页面；响应不会缓存，页面脚本不会运行或保存。
      </p>
      <button
        class="url-panel__action"
        type="submit"
        :disabled="props.busy || !props.available || !props.url.trim()"
      >
        {{ props.busy ? '正在提取…' : '提取正文' }}
        <PhArrowRight v-if="!props.busy" :size="18" aria-hidden="true" />
      </button>
    </div>

    <aside v-if="props.showFallback" class="url-panel__fallback">
      <div>
        <strong>也可以直接粘贴正文</strong>
        <p>当前网址会保留，之后仍可返回重试。</p>
      </div>
      <button type="button" @click="emit('pasteFallback')">改为粘贴正文</button>
    </aside>
  </form>
</template>

<style scoped>
.url-panel {
  display: grid;
  gap: 1rem;
}

.url-panel__intro {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

.url-panel__icon {
  display: inline-grid;
  place-items: center;
  inline-size: 3rem;
  block-size: 3rem;
  border-radius: 0.65rem;
  background: var(--accent-soft);
  color: var(--text-accent);
}

.url-panel__title,
.url-panel__description,
.url-panel__privacy,
.url-panel__unavailable,
.url-panel__fallback p {
  margin: 0;
}

.url-panel__title {
  font-size: 1.15rem;
}

.url-panel__description,
.url-panel__privacy,
.url-panel__fallback p {
  color: var(--text-secondary);
  line-height: 1.55;
}

.url-panel__description {
  margin-block-start: 0.3rem;
}

.url-panel__field {
  display: grid;
  gap: 0.5rem;
  font-weight: 650;
}

.url-panel__field input {
  inline-size: 100%;
  min-block-size: 3rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 0.8rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
}

.url-panel__unavailable {
  color: var(--status-warning-fg);
  line-height: 1.55;
}

.url-panel__footer {
  display: grid;
  gap: 0.75rem;
}

.url-panel__privacy {
  font-size: 0.875rem;
}

.url-panel__action,
.url-panel__fallback button {
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.url-panel__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 0;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.url-panel__action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.url-panel__fallback {
  display: grid;
  gap: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.65rem;
  padding: 1rem;
  background: var(--surface-canvas);
}

.url-panel__fallback p {
  margin-block-start: 0.2rem;
  font-size: 0.85rem;
}

.url-panel__fallback button {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-accent);
}

.url-panel__field input:focus-visible,
.url-panel__action:focus-visible,
.url-panel__fallback button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (min-width: 768px) {
  .url-panel__footer,
  .url-panel__fallback {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
}
</style>
