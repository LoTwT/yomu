<script setup lang="ts">
import { watch, useTemplateRef } from 'vue'

import type { ImportedArticleDraft } from '@/features/import/importArticle'

const props = defineProps<{
  draft: ImportedArticleDraft
  title: string
  body: string
  saving: boolean
  canPersist: boolean
  validationMessage?: string
}>()

const emit = defineEmits<{
  updateTitle: [value: string]
  updateSource: [value: string]
  updateBody: [value: string]
  save: []
  cancel: []
}>()

const validationSummary = useTemplateRef<HTMLElement>('validationSummary')

watch(
  () => props.validationMessage,
  message => message && validationSummary.value?.focus(),
)

function handleTitleInput(event: Event): void {
  emit('updateTitle', (event.target as HTMLInputElement).value)
}

function handleBodyInput(event: Event): void {
  emit('updateBody', (event.target as HTMLTextAreaElement).value)
}

function handleSourceInput(event: Event): void {
  emit('updateSource', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <section class="import-preview" data-testid="import-preview" aria-labelledby="preview-heading">
    <div class="import-preview__editor">
      <div class="import-preview__heading-row">
        <div>
          <p class="import-preview__eyebrow">
            保存前预览
          </p>
          <h2 id="preview-heading" class="import-preview__heading">
            检查文章内容
          </h2>
        </div>
        <button class="import-preview__cancel" type="button" :disabled="props.saving" @click="emit('cancel')">
          重新输入
        </button>
      </div>

      <label class="import-preview__field">
        <span>标题</span>
        <input
          :value="props.title"
          maxlength="120"
          :disabled="props.saving"
          @input="handleTitleInput"
        >
      </label>

      <label class="import-preview__field">
        <span>来源</span>
        <input
          :value="props.draft.source.label"
          maxlength="120"
          :disabled="props.saving"
          @input="handleSourceInput"
        >
      </label>

      <label class="import-preview__field import-preview__field--body">
        <span>提取后的正文</span>
        <textarea
          :value="props.body"
          rows="14"
          :disabled="props.saving"
          @input="handleBodyInput"
        />
      </label>
    </div>

    <aside class="import-preview__summary" aria-label="文章预览信息">
      <div class="import-preview__paper">
        <p class="import-preview__source">
          {{ props.draft.source.label }} · 未评估
        </p>
        <h3 class="import-preview__article-title" lang="en">
          {{ props.title || '未命名文章' }}
        </h3>
        <p class="import-preview__excerpt" lang="en">
          {{ props.draft.sentences.slice(0, 3).map(sentence => sentence.original).join(' ') }}
        </p>
      </div>

      <dl class="import-preview__facts">
        <div>
          <dt>句子</dt>
          <dd>{{ props.draft.sentences.length }}</dd>
        </div>
        <div>
          <dt>预计阅读</dt>
          <dd>{{ props.draft.estimatedReadTimeMinutes }} 分钟</dd>
        </div>
        <div>
          <dt>能力</dt>
          <dd>纯阅读与本机朗读</dd>
        </div>
      </dl>

      <p class="import-preview__rights">
        Yomu 不会推断你拥有该内容的版权。保存即表示你确认自己有权在此设备上保存和处理它。
      </p>

      <p
        v-if="props.validationMessage"
        ref="validationSummary"
        class="import-preview__validation"
        role="alert"
        tabindex="-1"
      >
        {{ props.validationMessage }}
      </p>
      <p v-else-if="!props.canPersist" class="import-preview__validation" role="alert">
        此安装的持久存储不可用，暂时不能保存。
      </p>

      <div class="import-preview__actions">
        <button
          class="import-preview__save"
          type="button"
          :disabled="props.saving || !props.canPersist"
          @click="emit('save')"
        >
          {{ props.saving ? '正在保存…' : '保存并开始阅读' }}
        </button>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.import-preview {
  display: grid;
  gap: 1rem;
}

.import-preview__editor,
.import-preview__summary {
  min-inline-size: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
}

.import-preview__editor,
.import-preview__summary,
.import-preview__field {
  display: grid;
  gap: 1rem;
}

.import-preview__heading-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.import-preview__eyebrow,
.import-preview__heading,
.import-preview__source,
.import-preview__article-title,
.import-preview__excerpt,
.import-preview__rights,
.import-preview__validation {
  margin: 0;
}

.import-preview__eyebrow,
.import-preview__source {
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.import-preview__heading {
  margin-block-start: 0.2rem;
  font-size: 1.35rem;
}

.import-preview__cancel {
  min-block-size: 2.75rem;
  border: 0;
  padding-inline: 0.5rem;
  background: transparent;
  color: var(--text-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.import-preview__field {
  gap: 0.45rem;
  font-weight: 650;
}

.import-preview__field input,
.import-preview__field textarea {
  inline-size: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
}

.import-preview__field textarea {
  min-block-size: 16rem;
  resize: vertical;
  line-height: 1.65;
}

.import-preview__summary {
  align-content: start;
}

.import-preview__paper {
  border-block-start: 3px solid var(--accent-primary-active);
  padding-block-start: 1rem;
}

.import-preview__article-title {
  margin-block-start: 0.5rem;
  font-family: var(--font-reading);
  font-size: clamp(1.45rem, 5vw, 2rem);
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.import-preview__excerpt {
  display: -webkit-box;
  overflow: hidden;
  margin-block-start: 0.85rem;
  color: var(--text-secondary);
  font-family: var(--font-reading);
  line-height: 1.7;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}

.import-preview__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.import-preview__facts div {
  min-inline-size: 0;
  border-block-start: 1px solid var(--border-subtle);
  padding-block-start: 0.65rem;
}

.import-preview__facts dt {
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.import-preview__facts dd {
  margin: 0.25rem 0 0;
  font-size: 0.88rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.import-preview__rights {
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.55;
}

.import-preview__validation {
  border: 1px solid var(--status-danger-border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  line-height: 1.5;
}

.import-preview__validation:focus {
  outline: 0;
}

.import-preview__actions {
  position: sticky;
  inset-block-end: calc(4.5rem + env(safe-area-inset-bottom));
  padding-block-start: 0.25rem;
  background: var(--surface-elevated);
}

.import-preview__save {
  inline-size: 100%;
  min-block-size: 3rem;
  border: 0;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.import-preview__save:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.import-preview__cancel:focus-visible,
.import-preview__field input:focus-visible,
.import-preview__field textarea:focus-visible,
.import-preview__save:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (min-width: 768px) {
  .import-preview__editor,
  .import-preview__summary {
    padding: 1.25rem;
  }

  .import-preview__actions {
    position: static;
  }
}

@media (min-width: 1200px) {
  .import-preview {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    align-items: start;
  }
}
</style>
