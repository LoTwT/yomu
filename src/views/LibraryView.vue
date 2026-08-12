<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { isNavigationFailure, useRouter } from 'vue-router'

import { usePlatformServices } from '@/app/platformServices'
import {
  BundledSampleDeletionPendingError,
  BundledSampleIdentityConflictError,
  startBundledSampleReading,
} from '@/features/article/startBundledSampleReading'
import {
  ArticleDeletionCleanupPendingError,
  ArticleDeletionPendingRetryError,
  deleteArticleFromDevice,
} from '@/features/library/articleDeletion'
import {
  ArticleManagementNotFoundError,
  getArticleManagementDetails,
  renameArticle,
  type ArticleManagementDetails,
} from '@/features/library/articleCommands'
import { takeLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { useLibraryPage } from '@/features/library/useLibraryPage'
import ArticleCollection from './library/ArticleCollection.vue'
import ArticleManagementDialog from './library/ArticleManagementDialog.vue'
import type { LibraryArticleManageRequest } from './library/LibraryArticleItem.vue'
import ContinueReadingCard from './library/ContinueReadingCard.vue'
import LibraryEmptyState from './library/LibraryEmptyState.vue'
import RecommendationCard from './library/RecommendationCard.vue'
import { bundledSampleRecommendation } from './library/libraryRecommendations'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const {
  status,
  library,
  errorMessage,
  ignoredRecordCount,
  persistenceAvailable,
  reload,
  refresh,
} = useLibraryPage()
const services = usePlatformServices()
const router = useRouter()
const isEmpty = computed(() => status.value === 'ready' && library.value.articles.length === 0)
const sampleSessionOnly = !persistenceAvailable
const restoreFocusArticleId = shallowRef<string | null>(takeLibraryArticleFocus())
const libraryRoot = useTemplateRef<HTMLElement>('libraryRoot')
const managementDetails = shallowRef<ArticleManagementDetails | null>(null)
const managementFocusReturn = shallowRef<HTMLElement | null>(null)
const managementArticleId = shallowRef<string | null>(null)
const managementPreviousIndex = shallowRef(-1)
const managementBusy = shallowRef(false)
const managementErrorMessage = shallowRef('')
const articleActionMessage = shallowRef('')
const sampleBusy = shallowRef(false)
const sampleErrorMessage = shallowRef('')
let operationVersion = 0
let sampleOperationVersion = 0
let sampleFocusReturn: HTMLButtonElement | null = null
let viewUnmounted = false

usePageHeadingFocus()

watch(
  () => ({
    articleIds: library.value.articles.map(article => article.id),
    continueArticleId: library.value.continueReading?.id ?? null,
    empty: isEmpty.value,
  }),
  (next, previous) => {
    const focusedSurface = focusedLibrarySurface()
    const managedArticleId = managementArticleId.value
    const removedArticleId = managedArticleId && !next.articleIds.includes(managedArticleId)
      ? managedArticleId
      : focusedSurface?.kind === 'article'
          && !next.articleIds.includes(focusedSurface.articleId)
        ? focusedSurface.articleId
        : null
    if (!removedArticleId) {
      if (
        focusedSurface?.kind === 'continue'
        && previous.continueArticleId === focusedSurface.articleId
        && next.continueArticleId !== focusedSurface.articleId
      ) {
        if (next.articleIds.includes(focusedSurface.articleId)) {
          void focusArticleById(focusedSurface.articleId)
        }
        else {
          void focusArticleAfterRemoval(
            next.articleIds,
            previous.articleIds.indexOf(focusedSurface.articleId),
          )
        }
        return
      }
      if (
        focusedSurface?.kind === 'empty'
        && previous.empty
        && !next.empty
        && next.articleIds.length > 0
      ) {
        void focusArticleById(next.articleIds[0]!)
        return
      }
      if (focusedSurface?.kind === 'recommendation' && next.empty) {
        void focusArticleAfterRemoval([], 0)
      }
      return
    }
    if (managedArticleId === removedArticleId) {
      const previousIndex = managementPreviousIndex.value >= 0
        ? managementPreviousIndex.value
        : previous.articleIds.indexOf(removedArticleId)
      operationVersion += 1
      managementBusy.value = false
      closeManagement()
      void focusArticleAfterRemoval(next.articleIds, previousIndex)
      return
    }
    const previousIndex = previous.articleIds.indexOf(removedArticleId)
    void focusArticleAfterRemoval(next.articleIds, previousIndex)
  },
)

onUnmounted(() => {
  viewUnmounted = true
  operationVersion += 1
  sampleOperationVersion += 1
  sampleFocusReturn = null
})

async function handleStartSample(focusReturn: HTMLButtonElement): Promise<void> {
  if (sampleBusy.value) {
    return
  }
  const version = ++sampleOperationVersion
  sampleFocusReturn = focusReturn
  sampleBusy.value = true
  sampleErrorMessage.value = ''
  let samplePersisted = false
  try {
    const result = await startBundledSampleReading(services)
    samplePersisted = true
    if (!isCurrentSampleOperation(version)) {
      return
    }
    const navigationFailure = await router.push({
      name: 'reader',
      params: { articleId: result.article.id },
    })
    const readerOpened = router.currentRoute.value.name === 'reader'
      && router.currentRoute.value.params.articleId === result.article.id
    if (
      isCurrentSampleOperation(version)
      && (isNavigationFailure(navigationFailure) || !readerOpened)
    ) {
      sampleErrorMessage.value = sampleNavigationErrorMessage
    }
  }
  catch (error) {
    if (!isCurrentSampleOperation(version)) {
      return
    }
    sampleErrorMessage.value = samplePersisted
      ? sampleNavigationErrorMessage
      : error instanceof BundledSampleDeletionPendingError
        ? '内置样例正在删除或清理旧进度，请稍后重试。'
        : error instanceof BundledSampleIdentityConflictError
          ? '无法加入内置样例：该本机文章标识已被其他内容占用。现有内容没有被修改。'
          : '暂时无法加入内置样例。没有留下不完整的阅读记录，请重试。'
  }
  finally {
    if (isCurrentSampleOperation(version)) {
      sampleBusy.value = false
      if (sampleErrorMessage.value) {
        await restoreSampleActionFocus(version)
      }
    }
  }
}

const sampleNavigationErrorMessage = '样例已加入，但暂时无法打开。请再次点击“加入并阅读”继续。'

async function restoreSampleActionFocus(version: number): Promise<void> {
  await nextTick()
  if (!isCurrentSampleOperation(version)) {
    return
  }
  const originalAction = sampleFocusReturn
  const target = originalAction?.isConnected && !originalAction.disabled
    ? originalAction
    : libraryRoot.value?.querySelector<HTMLButtonElement>('[data-sample-start]:not(:disabled)')
  sampleFocusReturn = null
  if (!target) {
    return
  }
  const ownerDocument = target.ownerDocument
  const activeElement = ownerDocument.activeElement
  if (
    activeElement
    && activeElement !== ownerDocument.body
    && activeElement !== ownerDocument.documentElement
  ) {
    return
  }
  target.focus({ preventScroll: true })
}

async function openManagement(request: LibraryArticleManageRequest): Promise<void> {
  if (managementBusy.value) {
    return
  }
  const version = ++operationVersion
  managementBusy.value = true
  managementErrorMessage.value = ''
  articleActionMessage.value = ''
  managementFocusReturn.value = request.focusReturn
  managementArticleId.value = request.articleId
  managementPreviousIndex.value = library.value.articles.findIndex(
    article => article.id === request.articleId,
  )
  try {
    const details = await getArticleManagementDetails(
      services.repositories,
      request.articleId,
    )
    if (isCurrentOperation(version)) {
      managementDetails.value = details
    }
  }
  catch (error) {
    if (!isCurrentOperation(version)) {
      return
    }
    articleActionMessage.value = error instanceof ArticleManagementNotFoundError
      ? '这篇文章已不在阅读库中。列表会在下次刷新时更新。'
      : '暂时无法读取文章管理信息，请重试。'
    if (error instanceof ArticleManagementNotFoundError) {
      const previousIndex = managementPreviousIndex.value
      const refreshed = await refresh()
      if (!isCurrentOperation(version)) {
        return
      }
      closeManagement()
      if (refreshed && !library.value.articles.some(article => article.id === request.articleId)) {
        await focusArticleAfterRemoval(
          library.value.articles.map(article => article.id),
          previousIndex,
        )
      }
      else if (request.focusReturn.isConnected) {
        request.focusReturn.focus({ preventScroll: true })
      }
    }
    else {
      closeManagement()
      if (request.focusReturn.isConnected) {
        request.focusReturn.focus({ preventScroll: true })
      }
    }
  }
  finally {
    if (isCurrentOperation(version)) {
      managementBusy.value = false
    }
  }
}

function closeManagement(): void {
  managementDetails.value = null
  managementFocusReturn.value = null
  managementArticleId.value = null
  managementPreviousIndex.value = -1
  managementErrorMessage.value = ''
}

async function handleRename(title: string): Promise<void> {
  const details = managementDetails.value
  if (!details || managementBusy.value) {
    return
  }
  const version = ++operationVersion
  managementBusy.value = true
  managementErrorMessage.value = ''
  try {
    const article = await renameArticle(services.repositories, {
      articleId: details.article.id,
      title,
    })
    if (!isCurrentOperation(version)) {
      return
    }
    const refreshed = await refresh()
    if (!isCurrentOperation(version)) {
      return
    }
    if (!refreshed) {
      const message = '名称已保存，但阅读库暂时无法刷新。稍后重新打开页面即可看到新名称。'
      if (managementDetails.value?.article.id === details.article.id) {
        managementDetails.value = { ...details, article }
      }
      reportManagementError(message)
      return
    }
    closeManagement()
  }
  catch (error) {
    if (isCurrentOperation(version)) {
      reportManagementError(error instanceof Error
        && error.name === 'ArticleTitleRequiredError'
        ? error.message
        : '无法保存名称。文章内容没有被修改，请重试。')
    }
  }
  finally {
    if (isCurrentOperation(version)) {
      managementBusy.value = false
    }
  }
}

async function handleOpenSource(url: string): Promise<void> {
  if (managementBusy.value) {
    return
  }
  const version = ++operationVersion
  managementBusy.value = true
  managementErrorMessage.value = ''
  try {
    await services.externalNavigation.open(url)
  }
  catch {
    if (isCurrentOperation(version)) {
      reportManagementError('暂时无法打开来源链接，请稍后重试。')
    }
  }
  finally {
    if (isCurrentOperation(version)) {
      managementBusy.value = false
    }
  }
}

async function handleDelete(options: { deleteContextlessTerms: boolean }): Promise<void> {
  const details = managementDetails.value
  if (!details || managementBusy.value) {
    return
  }
  const articleId = details.article.id
  const deletedIndex = library.value.articles.findIndex(article => article.id === articleId)
  const version = ++operationVersion
  managementBusy.value = true
  managementErrorMessage.value = ''
  articleActionMessage.value = ''
  let deletionCommitted = false
  let cleanupPendingMessage = ''
  try {
    await deleteArticleFromDevice(services, {
      articleId,
      deleteContextlessTerms: options.deleteContextlessTerms,
    })
    deletionCommitted = true
  }
  catch (error) {
    if (error instanceof ArticleDeletionCleanupPendingError) {
      deletionCommitted = true
      cleanupPendingMessage = articleDeletionCleanupPendingMessage(error)
    }
    else if (isCurrentOperation(version)) {
      reportManagementError(error instanceof ArticleDeletionPendingRetryError
        ? articleDeletionPendingRetryMessage(error)
        : '无法完成删除，文章仍保留在阅读库中。请重试。')
    }
  }

  if (!deletionCommitted || !isCurrentOperation(version)) {
    if (isCurrentOperation(version)) {
      managementBusy.value = false
    }
    return
  }

  closeManagement()
  const reloaded = await reload()
  if (!isCurrentOperation(version)) {
    return
  }
  managementBusy.value = false
  if (cleanupPendingMessage) {
    articleActionMessage.value = cleanupPendingMessage
  }
  if (reloaded) {
    const nextIds = library.value.articles.map(article => article.id)
    await focusArticleAfterRemoval(nextIds, deletedIndex)
  }
  else {
    await nextTick()
    libraryRoot.value?.querySelector<HTMLButtonElement>('.library-state__button')
      ?.focus({ preventScroll: true })
  }
}

function articleDeletionPendingRetryMessage(
  error: ArticleDeletionPendingRetryError,
): string {
  const retryGuidance = error.automaticRetry
    ? 'Yomu 会在下次打开或激活阅读库时自动重试。'
    : '删除确认只保存在当前页面，关闭或刷新后不会自动恢复；请在离开前重试。'
  const progressGuidance = error.progressRetired
    ? error.automaticRetry
      ? '这篇文章的阅读进度已停止保存。'
      : '停止保存状态只在当前页面有效；其他已打开的阅读页面可能仍会保存进度，请先关闭它们。'
    : '阅读进度尚未停止保存，请勿继续阅读这篇文章。'
  return `删除尚未完成。${retryGuidance}${progressGuidance}`
}

function articleDeletionCleanupPendingMessage(
  error: ArticleDeletionCleanupPendingError,
): string {
  return error.automaticRetry
    ? '文章已删除；部分旧进度缓存将在下次打开或激活阅读库时自动继续清理。'
    : '文章已删除；部分旧进度缓存只会在当前页面继续清理，关闭或刷新后不会保留清理状态。'
}

function isCurrentOperation(version: number): boolean {
  return !viewUnmounted && version === operationVersion
}

function isCurrentSampleOperation(version: number): boolean {
  return !viewUnmounted && version === sampleOperationVersion
}

function reportManagementError(message: string): void {
  if (managementDetails.value) {
    managementErrorMessage.value = message
    return
  }
  articleActionMessage.value = message
}

type FocusedLibrarySurface =
  | { kind: 'article', articleId: string }
  | { kind: 'continue', articleId: string }
  | { kind: 'empty' }
  | { kind: 'recommendation' }

function focusedLibrarySurface(): FocusedLibrarySurface | null {
  const root = libraryRoot.value
  const active = root?.ownerDocument.activeElement as HTMLElement | null | undefined
  const continueCard = active?.closest<HTMLElement>('[data-continue-article-id]')
  const continueArticleId = continueCard?.dataset.continueArticleId
  if (continueArticleId) {
    return { kind: 'continue', articleId: continueArticleId }
  }
  const item = active?.closest<HTMLElement>('[data-article-id]')
  const articleId = item?.dataset.articleId
  if (articleId) {
    return { kind: 'article', articleId }
  }
  if (active?.closest('[data-testid="library-empty-state"]')) {
    return { kind: 'empty' }
  }
  if (active?.closest('[data-library-recommendation]')) {
    return { kind: 'recommendation' }
  }
  return null
}

async function focusArticleById(articleId: string): Promise<void> {
  if (viewUnmounted) {
    return
  }
  restoreFocusArticleId.value = null
  await nextTick()
  restoreFocusArticleId.value = articleId
  await nextTick()
}

async function focusArticleAfterRemoval(
  articleIds: readonly string[],
  removedIndex: number,
): Promise<void> {
  if (viewUnmounted) {
    return
  }
  const targetIndex = Math.min(Math.max(removedIndex, 0), articleIds.length - 1)
  const targetId = articleIds[targetIndex] ?? null
  if (targetId) {
    await focusArticleById(targetId)
    return
  }
  restoreFocusArticleId.value = null
  await nextTick()
  libraryRoot.value?.querySelector<HTMLAnchorElement>('.library-empty__primary')
    ?.focus({ preventScroll: true })
}
</script>

<template>
  <div
    ref="libraryRoot"
    class="library-view"
    :aria-busy="status === 'loading' || managementBusy || sampleBusy"
  >
    <div class="library-view__content">
      <h1 ref="pageHeading" class="library-view__page-title" data-page-heading tabindex="-1">
        我的阅读
      </h1>

      <p v-if="status === 'loading'" class="library-state" role="status">
        正在读取此设备上的阅读库…
      </p>

      <section v-else-if="status === 'error'" class="library-state library-state--error" role="alert">
        <h2 class="library-state__title">
          无法读取阅读库
        </h2>
        <p>{{ errorMessage }}</p>
        <button class="library-state__button" type="button" @click="reload">
          重试
        </button>
      </section>

      <template v-else>
        <p v-if="!persistenceAvailable" class="library-notice" role="alert">
          此安装当前只能使用临时存储。Yomu 已暂停导入新文章；你仍可在本次使用期间加入内置样例，刷新或关闭后内容可能丢失。
        </p>
        <p v-if="ignoredRecordCount > 0" class="library-notice" role="status">
          已隔离 {{ ignoredRecordCount }} 条无法读取的记录，其余阅读库仍可使用。
        </p>
        <p v-if="articleActionMessage" class="library-notice" role="alert">
          {{ articleActionMessage }}
        </p>
        <p
          v-if="sampleErrorMessage"
          class="library-notice"
          data-sample-error
          role="alert"
        >
          {{ sampleErrorMessage }}
        </p>

        <LibraryEmptyState
          v-if="isEmpty"
          :busy="sampleBusy"
          :session-only="sampleSessionOnly"
          @start-sample="handleStartSample"
        />

        <section
          v-if="library.continueReading"
          class="library-section"
          aria-labelledby="continue-heading"
        >
          <h2 id="continue-heading" class="library-section__heading library-section__heading--accent">
            继续阅读
          </h2>
          <ContinueReadingCard :article="library.continueReading" />
        </section>

        <section
          v-if="library.articles.length > 0"
          class="library-section"
          aria-labelledby="articles-heading"
        >
          <h2 id="articles-heading" class="library-section__heading">
            我的文章
          </h2>
          <ArticleCollection
            :articles="library.articles"
            :restore-focus-article-id="restoreFocusArticleId"
            @manage="openManagement"
          />
        </section>

        <section
          v-if="!isEmpty"
          class="library-section"
          data-library-recommendation
          aria-labelledby="recommendations-heading"
        >
          <h2 id="recommendations-heading" class="library-section__heading">
            推荐阅读
          </h2>
          <RecommendationCard
            :article="bundledSampleRecommendation"
            :busy="sampleBusy"
            :session-only="sampleSessionOnly"
            @start-sample="handleStartSample"
          />
        </section>
      </template>
    </div>

    <ArticleManagementDialog
      v-if="managementDetails"
      :details="managementDetails"
      :focus-return="managementFocusReturn"
      :busy="managementBusy"
      :error-message="managementErrorMessage"
      @close="closeManagement"
      @rename="handleRename"
      @delete="handleDelete"
      @open-source="handleOpenSource"
    />
  </div>
</template>

<style scoped>
.library-view {
  display: grid;
  gap: 1.25rem;
}

.library-view__content {
  display: grid;
  min-inline-size: 0;
  gap: 1.25rem;
}

.library-view__page-title {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.library-view__page-title:focus {
  outline: 0;
}

.library-state,
.library-notice {
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1rem;
  background: var(--surface-elevated);
  color: var(--text-secondary);
}

.library-state--error,
.library-notice[role="alert"] {
  border-color: var(--status-warning-border);
}

.library-state__title {
  margin: 0 0 0.5rem;
  color: var(--text-primary);
  font-size: 1.15rem;
}

.library-state__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.library-state__button:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.library-section {
  min-inline-size: 0;
}

.library-section__heading {
  margin: 0 0 0.75rem;
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.library-section__heading--accent {
  color: var(--text-accent);
  font-size: 0.9rem;
}

@media (min-width: 768px) {
  .library-view {
    gap: 2.5rem;
  }

  .library-section__heading {
    margin-block-end: 1rem;
  }
}

@media (min-width: 1200px) {
  .library-view {
    gap: 1.5rem;
  }
}
</style>
