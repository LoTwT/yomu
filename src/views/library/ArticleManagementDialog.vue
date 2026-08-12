<script setup lang="ts">
import { PhArrowLeft, PhX } from '@phosphor-icons/vue'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'

import {
  useInteractionLayer,
  type InteractionLayerCloseReason,
  type ReleaseInteractionLayer,
} from '@/app/interactionLayer'
import {
  openModalDialog,
  type ModalDialogSession,
} from '@/app/modalDialog'
import { maxArticleTitleLength } from '@/features/article/articleMetadata'
import type { ArticleManagementDetails } from '@/features/library/articleCommands'
import ArticleActionMenu from './ArticleActionMenu.vue'

type ArticleManagementPane = 'menu' | 'rename' | 'source' | 'delete'

export type ArticleManagementCloseReason =
  | InteractionLayerCloseReason
  | 'cancel'
  | 'close-button'

const props = withDefaults(defineProps<{
  details: ArticleManagementDetails
  focusReturn?: HTMLElement | null
  busy?: boolean
  errorMessage?: string
}>(), {
  focusReturn: undefined,
  busy: false,
  errorMessage: '',
})

const emit = defineEmits<{
  close: [reason: ArticleManagementCloseReason]
  rename: [title: string]
  delete: [options: { deleteContextlessTerms: boolean }]
  openSource: [url: string]
}>()

const interactionLayer = useInteractionLayer()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')
const headingId = useId()
const descriptionId = useId()
const pane = shallowRef<ArticleManagementPane>('menu')
const renameTitle = shallowRef(props.details.article.title)
const deleteContextlessTerms = shallowRef(false)
const trimmedRenameTitle = computed(() => renameTitle.value.trim())
const canRename = computed(() => !props.busy
  && trimmedRenameTitle.value.length > 0
  && trimmedRenameTitle.value !== props.details.article.title)
const normalizedErrorMessage = computed(() => props.errorMessage.trim())
const sourceUrl = computed(() => props.details.article.source.url?.trim() ?? '')
const sourceKindLabel = computed(() => {
  switch (props.details.article.source.kind) {
    case 'paste':
      return '粘贴内容'
    case 'file':
      return '本地文件'
    case 'url':
      return '网页链接'
    case 'today':
      return '今日精选'
    case 'public-domain':
      return '公版内容'
  }
})
const paneTitle = computed(() => {
  switch (pane.value) {
    case 'menu':
      return '管理文章'
    case 'rename':
      return '重命名文章'
    case 'source':
      return '来源详情'
    case 'delete':
      return '删除文章'
  }
})
const paneDescription = computed(() => {
  switch (pane.value) {
    case 'menu':
      return '选择要对这篇文章执行的操作。'
    case 'rename':
      return '新名称只影响阅读库中的显示，不会修改文章正文。'
    case 'source':
      return '这些信息随文章保存在此设备，用于追溯内容来源与使用说明。'
    case 'delete':
      return '删除不可撤销。请先确认将一并移除的数据。'
  }
})
let releaseLayer: ReleaseInteractionLayer | null = null
let modalSession: ModalDialogSession | null = null
let closeRequested = false

watch(
  () => props.details.article.id,
  () => {
    pane.value = 'menu'
    renameTitle.value = props.details.article.title
    deleteContextlessTerms.value = false
    void nextTick(focusHeading)
  },
)

watch(
  () => props.details.article.title,
  title => {
    if (pane.value !== 'rename') {
      renameTitle.value = title
    }
  },
)

onMounted(() => {
  const release = interactionLayer.registerLayer({
    focusReturn: readFocusReturn(),
    id: `article-management:${props.details.article.id}`,
    onRequestClose: reason => requestClose(reason),
  })
  if (!release) {
    requestClose('superseded')
    return
  }
  releaseLayer = release

  const dialogElement = dialog.value
  if (!dialogElement) {
    requestClose('superseded')
    return
  }
  modalSession = openModalDialog(dialogElement, {
    fallbackBackdropClass: 'article-management-dialog__fallback-backdrop',
  })
  void nextTick(focusHeading)
})

onUnmounted(() => {
  closeRequested = true
  modalSession?.release()
  modalSession = null
  releaseLayer?.()
  releaseLayer = null
})

function showPane(nextPane: ArticleManagementPane): void {
  if (props.busy) {
    return
  }
  if (nextPane === 'rename') {
    renameTitle.value = props.details.article.title
  }
  if (nextPane === 'delete') {
    deleteContextlessTerms.value = false
  }
  pane.value = nextPane
  void nextTick(() => {
    if (nextPane === 'rename') {
      renameInput.value?.focus({ preventScroll: true })
      renameInput.value?.select()
      return
    }
    focusHeading()
  })
}

function focusHeading(): void {
  if (!closeRequested && heading.value?.isConnected) {
    heading.value.focus({ preventScroll: true })
  }
}

function submitRename(): void {
  if (!canRename.value) {
    return
  }
  emit('rename', trimmedRenameTitle.value)
}

function submitDelete(): void {
  if (props.busy) {
    return
  }
  emit('delete', {
    deleteContextlessTerms: deleteContextlessTerms.value,
  })
}

function openSource(): void {
  if (!props.busy && sourceUrl.value) {
    emit('openSource', sourceUrl.value)
  }
}

function requestClose(reason: ArticleManagementCloseReason): void {
  if (closeRequested) {
    return
  }
  closeRequested = true

  const modal = modalSession
  modalSession = null
  const release = releaseLayer
  releaseLayer = null
  modal?.release()
  emit('close', reason)
  release?.()
}

function handleDialogClose(): void {
  if (!closeRequested && !dialog.value?.open) {
    requestClose('cancel')
  }
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (!modalSession?.usesFallback
    || event.key !== 'Escape'
    || event.isComposing
    || event.defaultPrevented) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  requestClose('cancel')
}

function readFocusReturn(): HTMLElement | null {
  if (props.focusReturn !== undefined) {
    return props.focusReturn
  }

  const ownerDocument = dialog.value?.ownerDocument
  const activeElement = ownerDocument?.activeElement
  if (activeElement === ownerDocument?.body || activeElement === ownerDocument?.documentElement) {
    return null
  }
  return activeElement && typeof (activeElement as HTMLElement).focus === 'function'
    ? activeElement as HTMLElement
    : null
}
</script>

<template>
  <dialog
    ref="dialog"
    class="article-management-dialog"
    :aria-busy="busy ? 'true' : undefined"
    aria-modal="true"
    :aria-labelledby="headingId"
    :aria-describedby="descriptionId"
    tabindex="-1"
    @cancel.prevent="requestClose('cancel')"
    @close="handleDialogClose"
    @keydown="handleDialogKeydown"
  >
    <header class="article-management-dialog__header">
      <button
        v-if="pane !== 'menu'"
        class="article-management-dialog__icon-button"
        type="button"
        aria-label="返回文章操作"
        :disabled="busy"
        @click="showPane('menu')"
      >
        <PhArrowLeft aria-hidden="true" :size="20" />
      </button>
      <span v-else class="article-management-dialog__header-spacer" aria-hidden="true" />

      <div class="article-management-dialog__heading-copy">
        <p class="article-management-dialog__eyebrow" lang="en">
          {{ details.article.title }}
        </p>
        <h2
          :id="headingId"
          ref="heading"
          class="article-management-dialog__title"
          tabindex="-1"
        >
          {{ paneTitle }}
        </h2>
      </div>

      <button
        class="article-management-dialog__icon-button"
        type="button"
        aria-label="关闭文章管理"
        @click="requestClose('close-button')"
      >
        <PhX aria-hidden="true" :size="20" />
      </button>
    </header>

    <p :id="descriptionId" class="article-management-dialog__description">
      {{ paneDescription }}
    </p>

    <p
      v-if="normalizedErrorMessage"
      class="article-management-dialog__error"
      role="alert"
    >
      {{ normalizedErrorMessage }}
    </p>

    <ArticleActionMenu
      v-if="pane === 'menu'"
      :busy="busy"
      @rename="showPane('rename')"
      @source="showPane('source')"
      @delete="showPane('delete')"
    />

    <form
      v-else-if="pane === 'rename'"
      class="article-management-dialog__panel"
      @submit.prevent="submitRename"
    >
      <label class="article-management-dialog__field">
        <span class="article-management-dialog__field-label">文章名称</span>
        <input
          ref="renameInput"
          v-model="renameTitle"
          class="article-management-dialog__input"
          type="text"
          autocomplete="off"
          enterkeyhint="done"
          :maxlength="maxArticleTitleLength"
          required
          :disabled="busy"
        >
      </label>
      <div class="article-management-dialog__actions">
        <button
          class="article-management-dialog__button"
          type="button"
          :disabled="busy"
          @click="showPane('menu')"
        >
          取消
        </button>
        <button
          class="article-management-dialog__button article-management-dialog__button--primary"
          type="submit"
          :disabled="!canRename"
        >
          {{ busy ? '正在保存…' : '保存名称' }}
        </button>
      </div>
    </form>

    <section v-else-if="pane === 'source'" class="article-management-dialog__panel">
      <dl class="article-management-dialog__details">
        <div class="article-management-dialog__detail">
          <dt>来源类型</dt>
          <dd>{{ sourceKindLabel }}</dd>
        </div>
        <div class="article-management-dialog__detail">
          <dt>来源名称</dt>
          <dd>{{ details.article.source.label }}</dd>
        </div>
        <div class="article-management-dialog__detail">
          <dt>网址</dt>
          <dd class="article-management-dialog__source-value" dir="auto">
            {{ sourceUrl || '未记录' }}
          </dd>
        </div>
        <div class="article-management-dialog__detail">
          <dt>作者</dt>
          <dd>{{ details.article.source.author || '未记录' }}</dd>
        </div>
        <div class="article-management-dialog__detail">
          <dt>年份</dt>
          <dd>{{ details.article.source.publicationYear || '未记录' }}</dd>
        </div>
        <div class="article-management-dialog__detail">
          <dt>内容权利说明</dt>
          <dd>{{ details.article.rights.note }}</dd>
        </div>
      </dl>
      <div class="article-management-dialog__actions">
        <button
          class="article-management-dialog__button"
          type="button"
          :disabled="busy"
          @click="showPane('menu')"
        >
          返回
        </button>
        <button
          v-if="sourceUrl"
          class="article-management-dialog__button article-management-dialog__button--primary"
          type="button"
          :disabled="busy"
          @click="openSource"
        >
          打开来源
        </button>
      </div>
    </section>

    <form
      v-else
      class="article-management-dialog__panel"
      @submit.prevent="submitDelete"
    >
      <div class="article-management-dialog__danger-summary">
        <p>
          将永久删除文章、{{ details.attemptCount }} 条阅读记录和
          {{ details.vocabularyContextCount }} 条收藏词原句上下文。
        </p>
        <p>
          收藏词条默认保留；失去的原句会计入不可用上下文数量。
        </p>
      </div>
      <label class="article-management-dialog__checkbox">
        <input
          v-model="deleteContextlessTerms"
          type="checkbox"
          :disabled="busy || details.contextlessTermCount === 0"
        >
        <span v-if="details.contextlessTermCount > 0">
          同时删除 {{ details.contextlessTermCount }} 个将失去全部上下文的词条
        </span>
        <span v-else>没有词条会因本次操作失去全部上下文</span>
      </label>
      <div class="article-management-dialog__actions">
        <button
          class="article-management-dialog__button"
          type="button"
          :disabled="busy"
          @click="showPane('menu')"
        >
          取消
        </button>
        <button
          class="article-management-dialog__button article-management-dialog__button--danger"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? '正在删除…' : '永久删除' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.article-management-dialog {
  --article-management-safe-top: env(safe-area-inset-top, 0px);
  --article-management-safe-right: env(safe-area-inset-right, 0px);
  --article-management-safe-bottom: env(safe-area-inset-bottom, 0px);
  --article-management-safe-left: env(safe-area-inset-left, 0px);
  --article-management-edge-top: max(1rem, var(--article-management-safe-top));
  --article-management-edge-right: max(1rem, var(--article-management-safe-right));
  --article-management-edge-bottom: max(1rem, var(--article-management-safe-bottom));
  --article-management-edge-left: max(1rem, var(--article-management-safe-left));
  position: fixed;
  inset: var(--article-management-edge-top) var(--article-management-edge-right)
    var(--article-management-edge-bottom) var(--article-management-edge-left);
  display: grid;
  gap: 1rem;
  inline-size: min(
    calc(100% - var(--article-management-edge-left) - var(--article-management-edge-right)),
    34rem
  );
  max-inline-size: calc(
    100% - var(--article-management-edge-left) - var(--article-management-edge-right)
  );
  block-size: fit-content;
  max-block-size: min(
    calc(100vh - var(--article-management-edge-top) - var(--article-management-edge-bottom)),
    42rem
  );
  max-block-size: min(
    calc(100dvh - var(--article-management-edge-top) - var(--article-management-edge-bottom)),
    42rem
  );
  margin: auto;
  border: 1px solid var(--border-strong);
  border-radius: 0.85rem;
  padding: 1.1rem;
  overflow: auto;
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
  overscroll-behavior: contain;
}

.article-management-dialog:not([open]) {
  display: none;
}

.article-management-dialog[data-modal-fallback] {
  z-index: 101;
}

:global(.article-management-dialog__fallback-backdrop) {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--surface-canvas) 40%, transparent);
  backdrop-filter: blur(3px);
}

.article-management-dialog::backdrop {
  background: color-mix(in srgb, var(--surface-canvas) 40%, transparent);
  backdrop-filter: blur(3px);
}

.article-management-dialog__header {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
  align-items: start;
  gap: 0.5rem;
}

.article-management-dialog__header-spacer {
  inline-size: 2.75rem;
  block-size: 2.75rem;
}

.article-management-dialog__heading-copy {
  min-inline-size: 0;
  text-align: center;
}

.article-management-dialog__eyebrow,
.article-management-dialog__title,
.article-management-dialog__description,
.article-management-dialog__error,
.article-management-dialog__danger-summary p {
  margin: 0;
}

.article-management-dialog__eyebrow {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-management-dialog__title {
  margin-block-start: 0.15rem;
  font-size: 1.3rem;
  line-height: 1.25;
}

.article-management-dialog__title:focus {
  outline: 0;
}

.article-management-dialog__description {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  text-align: center;
}

.article-management-dialog__icon-button {
  display: inline-grid;
  place-items: center;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  touch-action: manipulation;
}

.article-management-dialog__icon-button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.article-management-dialog__icon-button:focus-visible,
.article-management-dialog__button:focus-visible,
.article-management-dialog__input:focus-visible,
.article-management-dialog__checkbox:has(input:focus-visible) {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.article-management-dialog__error {
  border: 1px solid var(--status-danger-border);
  border-radius: 0.55rem;
  padding: 0.75rem;
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  line-height: 1.5;
}

.article-management-dialog__panel {
  display: grid;
  gap: 1rem;
  min-inline-size: 0;
}

.article-management-dialog__field {
  display: grid;
  gap: 0.45rem;
}

.article-management-dialog__field-label {
  font-size: 0.85rem;
  font-weight: 700;
}

.article-management-dialog__input {
  inline-size: 100%;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.55rem;
  padding-inline: 0.75rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
}

.article-management-dialog__details {
  display: grid;
  gap: 0;
  margin: 0;
  border-block: 1px solid var(--border-subtle);
}

.article-management-dialog__detail {
  display: grid;
  grid-template-columns: minmax(6rem, 0.36fr) minmax(0, 1fr);
  gap: 0.75rem;
  padding-block: 0.7rem;
  border-block-end: 1px solid var(--border-subtle);
}

.article-management-dialog__detail:last-child {
  border-block-end: 0;
}

.article-management-dialog__detail dt {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.article-management-dialog__detail dd {
  min-inline-size: 0;
  margin: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.article-management-dialog__source-value {
  font-size: 0.84rem;
}

.article-management-dialog__danger-summary {
  display: grid;
  gap: 0.55rem;
  border: 1px solid var(--status-danger-border);
  border-radius: 0.65rem;
  padding: 0.85rem;
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  line-height: 1.55;
}

.article-management-dialog__checkbox {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.65rem;
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding: 0.65rem;
  color: var(--text-secondary);
  line-height: 1.5;
  cursor: pointer;
}

.article-management-dialog__checkbox:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.68;
}

.article-management-dialog__checkbox input {
  inline-size: 1.15rem;
  block-size: 1.15rem;
  margin: 0.15rem 0 0;
  accent-color: var(--accent-primary-active);
}

.article-management-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.65rem;
}

.article-management-dialog__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.55rem;
  padding-inline: 1rem;
  background: transparent;
  color: var(--text-primary);
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.article-management-dialog__button--primary {
  border-color: transparent;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.article-management-dialog__button--danger {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.article-management-dialog__button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

@media (hover: hover) {
  .article-management-dialog__icon-button:not(:disabled):hover,
  .article-management-dialog__button:not(:disabled):hover {
    background: var(--surface-subtle);
  }

  .article-management-dialog__button--primary:not(:disabled):hover {
    background: var(--accent-primary-active);
    color: var(--accent-contrast-active);
  }

  .article-management-dialog__button--danger:not(:disabled):hover {
    background: var(--status-danger-bg);
  }
}

@media (max-width: 479px) {
  .article-management-dialog__detail {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }

  .article-management-dialog__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (forced-colors: active) {
  .article-management-dialog {
    border: 2px solid CanvasText;
    box-shadow: none;
  }

  :global(.article-management-dialog__fallback-backdrop) {
    background: Canvas;
    opacity: 0.75;
  }

  .article-management-dialog__icon-button,
  .article-management-dialog__button,
  .article-management-dialog__input,
  .article-management-dialog__danger-summary,
  .article-management-dialog__error {
    border-color: ButtonText;
  }

  .article-management-dialog__button--primary,
  .article-management-dialog__button--danger {
    background: ButtonFace;
    color: ButtonText;
  }
}
</style>
