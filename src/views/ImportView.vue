<script setup lang="ts">
import { shallowRef } from 'vue'
import { RouterLink } from 'vue-router'

import { usePageHeadingFocus } from './usePageHeadingFocus'

type ImportSource = 'paste' | 'file' | 'url'

const source = shallowRef<ImportSource>('paste')

usePageHeadingFocus()
</script>

<template>
  <div class="import-view">
    <h1 ref="pageHeading" class="import-view__title" data-page-heading tabindex="-1">
      导入内容
    </h1>
    <p class="import-view__lead">
      把英文内容带进 Yomu；保存前可以检查标题、来源和正文。
    </p>

    <div class="source-switcher" role="group" aria-label="导入来源">
      <button
        v-for="option in ([
          { value: 'paste', label: '粘贴文本' },
          { value: 'file', label: 'TXT / Markdown' },
          { value: 'url', label: 'URL Beta' },
        ] as const)"
        :key="option.value"
        class="source-switcher__button"
        :class="{ 'source-switcher__button--active': source === option.value }"
        type="button"
        :aria-pressed="source === option.value"
        @click="source = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <section class="import-view__panel" aria-live="polite">
      <label v-if="source === 'paste'" class="import-view__field">
        <span>英文正文</span>
        <textarea rows="9" placeholder="在这里粘贴英文内容" />
      </label>
      <label v-else-if="source === 'file'" class="import-view__field">
        <span>选择文本文件</span>
        <input type="file" accept=".txt,.md,text/plain,text/markdown">
      </label>
      <label v-else class="import-view__field">
        <span>文章 URL</span>
        <input type="url" inputmode="url" placeholder="https://example.com/article">
      </label>

      <p class="import-view__notice">
        粘贴、文本文件与 URL 都会在确认保存前进入预览。
      </p>
      <RouterLink class="import-view__legacy-link" :to="{ name: 'legacy' }">
        阅读 Today 示例
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.import-view {
  max-inline-size: 48rem;
  margin-inline: auto;
}

.import-view__title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.5rem);
}

.import-view__title:focus {
  outline: 0;
}

.import-view__lead {
  margin-block: 0.75rem 1.5rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.source-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.source-switcher__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.source-switcher__button--active {
  border-color: var(--accent-primary);
  color: var(--text-accent);
}

.import-view__panel {
  margin-block-start: 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--surface-elevated);
}

.import-view__field {
  display: grid;
  gap: 0.5rem;
  font-weight: 650;
}

.import-view__field textarea,
.import-view__field input {
  inline-size: 100%;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
}

.import-view__notice {
  margin-block: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.import-view__legacy-link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  color: var(--text-accent);
  font-weight: 700;
}

.source-switcher__button:focus-visible,
.import-view__field textarea:focus-visible,
.import-view__field input:focus-visible,
.import-view__legacy-link:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (max-width: 479px) {
  .source-switcher {
    grid-template-columns: 1fr;
  }
}
</style>
