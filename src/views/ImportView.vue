<script setup lang="ts">
import { useRouter } from 'vue-router'

import ImportComposer from './import/ImportComposer.vue'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const router = useRouter()

function openArticle(articleId: string): void {
  void router.push({ name: 'reader', params: { articleId } })
}

usePageHeadingFocus()
</script>

<template>
  <div class="import-view">
    <header class="import-view__header">
      <h1 ref="pageHeading" class="import-view__title" data-page-heading tabindex="-1">
        导入内容
      </h1>
      <p class="import-view__lead">
        把英文内容带进 Yomu；保存前可以检查标题、来源和正文。
      </p>
    </header>

    <ImportComposer @open-article="openArticle" />
  </div>
</template>

<style scoped>
.import-view {
  display: grid;
  gap: 1.5rem;
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
  margin-block: 0.75rem 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

@media (min-width: 1200px) {
  .import-view:has([data-testid="import-preview"]) {
    max-inline-size: 75rem;
  }
}
</style>
