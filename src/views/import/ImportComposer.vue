<script setup lang="ts">
import { computed } from 'vue'

import { useImportFlow } from '@/features/import/useImportFlow'
import { useUnsavedImportGuard } from '@/features/import/useUnsavedImportGuard'
import ImportErrorSummary from './ImportErrorSummary.vue'
import FileImportPanel from './FileImportPanel.vue'
import ImportPreview from './ImportPreview.vue'
import ImportSourceSwitcher, { type ImportSource } from './ImportSourceSwitcher.vue'
import PasteImportPanel from './PasteImportPanel.vue'
import UnsavedImportDialog from './UnsavedImportDialog.vue'
import UrlImportPanel from './UrlImportPanel.vue'

const emit = defineEmits<{
  openArticle: [articleId: string]
}>()

const {
  state,
  inputSource,
  canPersist,
  fileImportAvailable,
  fileImportReason,
  fileDropAvailable,
  urlImportAvailable,
  urlImportReason,
  isDirty,
  setInputSource,
  setSourceText,
  setSourceUrl,
  parsePaste,
  chooseFile,
  importDroppedFiles,
  parseSelectedFile,
  parseUrl,
  usePasteFallback,
  updateTitle,
  updateSourceLabel,
  updateBody,
  save,
  cancelPreview,
  acceptResolvedArticle,
} = useImportFlow()
const source = computed<ImportSource>({
  get: () => inputSource.value,
  set: (value) => {
    setInputSource(value)
  },
})
const sourceLocked = computed(() =>
  state.value.phase !== 'idle' && state.value.phase !== 'error')
const {
  isConfirming,
  keepEditing,
  discardAndLeave,
} = useUnsavedImportGuard(isDirty)

async function saveAndOpen(): Promise<void> {
  const result = await save()
  if (result?.kind === 'created') {
    emit('openArticle', result.articleId)
  }
}

function openResolvedArticle(): void {
  const articleId = acceptResolvedArticle()
  if (articleId) {
    emit('openArticle', articleId)
  }
}
</script>

<template>
  <div class="import-composer">
    <ImportSourceSwitcher
      v-model="source"
      :file-available="fileImportAvailable"
      :file-unavailable-reason="fileImportReason"
      :url-available="urlImportAvailable"
      :url-unavailable-reason="urlImportReason"
      :disabled="sourceLocked"
    />

    <section
      v-if="state.phase === 'idle' || state.phase === 'parsing' || state.phase === 'error'"
      class="import-composer__panel"
      aria-live="polite"
    >
      <ImportErrorSummary v-if="state.phase === 'error'" :message="state.message" />
      <PasteImportPanel
        v-if="state.source === 'paste'"
        :text="state.text"
        :busy="state.phase === 'parsing'"
        @update-text="setSourceText"
        @parse="parsePaste"
      />
      <FileImportPanel
        v-else-if="state.source === 'file'"
        :busy="state.phase === 'parsing'"
        :available="fileImportAvailable"
        :unavailable-reason="fileImportReason"
        :drop-available="fileDropAvailable"
        :file-name="state.fileName"
        @choose-file="chooseFile"
        @retry="parseSelectedFile"
        @drop-files="importDroppedFiles"
      />
      <UrlImportPanel
        v-else
        :url="state.url"
        :busy="state.phase === 'parsing'"
        :available="urlImportAvailable"
        :unavailable-reason="urlImportReason"
        :show-fallback="state.phase === 'error'"
        @update-url="setSourceUrl"
        @parse="parseUrl"
        @paste-fallback="usePasteFallback"
      />
    </section>

    <ImportPreview
      v-else-if="state.phase === 'preview' || state.phase === 'saving'"
      :draft="state.draft"
      :title="state.title"
      :body="state.body"
      :saving="state.phase === 'saving'"
      :can-persist="canPersist"
      :cancel-label="state.draft.source.kind === 'file'
        ? '选择其他文件'
        : state.draft.source.kind === 'url'
          ? '修改网址'
          : '重新输入'"
      :validation-message="state.phase === 'preview' ? state.validationMessage : ''"
      @update-title="updateTitle"
      @update-source="updateSourceLabel"
      @update-body="updateBody"
      @save="saveAndOpen"
      @cancel="cancelPreview"
    />

    <section
      v-else
      class="import-composer__duplicate"
      :data-testid="state.phase === 'saved'
        ? 'import-saved-state'
        : 'import-duplicate-state'"
      aria-labelledby="duplicate-heading"
    >
      <p class="import-composer__eyebrow">
        {{ state.phase === 'saved' ? '已保存到我的阅读' : '已在阅读库' }}
      </p>
      <h2 id="duplicate-heading" class="import-composer__duplicate-title" lang="en">
        {{ state.articleTitle }}
      </h2>
      <p class="import-composer__duplicate-copy">
        {{ state.phase === 'saved'
          ? '内容已经安全保存，可以现在开始阅读。'
          : 'Yomu 根据最终正文识别到同一篇文章，因此没有创建副本。标题修改不会改变去重结果。' }}
      </p>
      <div class="import-composer__duplicate-actions">
        <button class="import-composer__open" type="button" @click="openResolvedArticle">
          {{ state.phase === 'saved' ? '开始阅读' : '打开已有文章' }}
        </button>
        <button
          v-if="state.phase === 'duplicate'"
          class="import-composer__cancel"
          type="button"
          @click="cancelPreview"
        >
          返回修改
        </button>
      </div>
    </section>

    <UnsavedImportDialog
      v-if="isConfirming"
      @keep-editing="keepEditing"
      @discard="discardAndLeave"
    />
  </div>
</template>

<style scoped>
.import-composer {
  display: grid;
  gap: 1rem;
}

.import-composer__panel,
.import-composer__duplicate {
  display: grid;
  gap: 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--surface-elevated);
}

.import-composer__duplicate {
  max-inline-size: 36rem;
}

.import-composer__eyebrow,
.import-composer__duplicate-title,
.import-composer__duplicate-copy {
  margin: 0;
}

.import-composer__eyebrow {
  color: var(--status-success-fg);
  font-size: 0.8rem;
  font-weight: 750;
}

.import-composer__duplicate-title {
  font-family: var(--font-reading);
  font-size: 1.75rem;
}

.import-composer__duplicate-copy {
  color: var(--text-secondary);
  line-height: 1.65;
}

.import-composer__duplicate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.import-composer__open,
.import-composer__cancel {
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.import-composer__open {
  border: 0;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.import-composer__cancel {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-accent);
}

.import-composer__open:focus-visible,
.import-composer__cancel:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}
</style>
