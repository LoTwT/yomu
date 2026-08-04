<script setup lang="ts">
import { computed } from 'vue'

import { takeLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { useLibraryPage } from '@/features/library/useLibraryPage'
import ArticleCollection from './library/ArticleCollection.vue'
import ContinueReadingCard from './library/ContinueReadingCard.vue'
import LibraryEmptyState from './library/LibraryEmptyState.vue'
import RecommendationCard from './library/RecommendationCard.vue'
import { todayRecommendation } from './library/libraryRecommendations'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const {
  status,
  library,
  errorMessage,
  ignoredRecordCount,
  persistenceAvailable,
  reload,
} = useLibraryPage()
const isEmpty = computed(() => status.value === 'ready' && library.value.articles.length === 0)
const restoreFocusArticleId = takeLibraryArticleFocus()

usePageHeadingFocus()
</script>

<template>
  <div class="library-view" :aria-busy="status === 'loading'">
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
        此安装当前只能使用临时存储。为避免刷新后丢失内容，Yomu 已暂停保存新文章。
      </p>
      <p v-if="ignoredRecordCount > 0" class="library-notice" role="status">
        已隔离 {{ ignoredRecordCount }} 条无法读取的记录，其余阅读库仍可使用。
      </p>

      <LibraryEmptyState v-if="isEmpty" />

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
        />
      </section>

      <section v-if="!isEmpty" class="library-section" aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading" class="library-section__heading">
          推荐阅读
        </h2>
        <RecommendationCard
          :article="todayRecommendation"
          :to="{ name: 'legacy' }"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.library-view {
  display: grid;
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
