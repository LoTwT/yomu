<script setup lang="ts">
import { PhArrowLeft } from '@phosphor-icons/vue'
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { isNavigationFailure, RouterLink, useRouter } from 'vue-router'

import ReadingReviewSummary from '@/components/review/ReadingReviewSummary.vue'
import { requestLibraryArticleFocus } from '@/features/library/libraryFocusReturn'
import { useReadingReview } from '@/features/review/useReadingReview'
import { usePageHeadingFocus } from './usePageHeadingFocus'

const props = defineProps<{
  attemptId: string
}>()

const router = useRouter()
const currentAttemptId = computed(() => props.attemptId)
const {
  status,
  review,
  attempt,
  missingResource,
  errorMessage,
  rereadState,
  rereadErrorMessage,
  reload,
  startRereading,
} = useReadingReview(currentAttemptId)
const rereadNavigationError = shallowRef('')
const rereadActionError = computed(() =>
  rereadNavigationError.value || rereadErrorMessage.value)
let viewUnmounted = false
let rereadNavigationOperation: { sourceAttemptId: string } | null = null
const missingTitle = computed(() => missingResource.value === 'article'
  ? '找不到回顾对应的文章'
  : '找不到这次回顾')
const missingMessage = computed(() => missingResource.value === 'article'
  ? '阅读记录仍在，但对应文章可能已被删除。Yomu 不会用其他正文替代它。'
  : '这次阅读记录可能已被删除，或此链接不属于当前设备。')

const removeAfterEach = router.afterEach((to, from, failure) => {
  if (!failure && from.name === 'review' && to.name === 'library' && review.value) {
    requestLibraryArticleFocus(review.value.article.id)
  }
})
watch(currentAttemptId, () => {
  rereadNavigationError.value = ''
})
onUnmounted(() => {
  viewUnmounted = true
  removeAfterEach()
})

function handleReread(): void {
  const sourceReview = review.value
  if (!sourceReview) {
    return
  }
  const sourceAttemptId = sourceReview.attempt.id
  if (rereadNavigationOperation?.sourceAttemptId === sourceAttemptId) {
    return
  }
  const operation = { sourceAttemptId }
  rereadNavigationOperation = operation
  rereadNavigationError.value = ''
  void startRereading()
    .then(async (rereadAttempt) => {
      if (!rereadAttempt
        || viewUnmounted
        || review.value?.attempt.id !== sourceAttemptId
        || router.currentRoute.value.name !== 'review') {
        return
      }
      const failure = await router.push({
        name: 'reader',
        params: { articleId: rereadAttempt.articleId },
      })
      if (failure && isNavigationFailure(failure) && !viewUnmounted) {
        rereadNavigationError.value = '新的阅读已准备好，但阅读器暂时未能打开。请重试。'
      }
    })
    .catch(() => {
      if (!viewUnmounted) {
        rereadNavigationError.value = '新的阅读已准备好，但阅读器暂时未能打开。请重试。'
      }
    })
    .finally(() => {
      if (rereadNavigationOperation === operation) {
        rereadNavigationOperation = null
      }
    })
}

usePageHeadingFocus()
</script>

<template>
  <div class="review-view">
    <header class="review-view__toolbar">
      <RouterLink class="review-view__back" :to="{ name: 'library' }">
        <PhArrowLeft aria-hidden="true" :size="20" />
        <span>我的阅读</span>
      </RouterLink>
      <h1
        ref="pageHeading"
        class="review-view__heading"
        data-page-heading
        tabindex="-1"
      >
        读后回顾
      </h1>
      <span class="review-view__toolbar-spacer" aria-hidden="true" />
    </header>

    <main class="review-view__main">
      <p v-if="status === 'loading'" class="review-view__loading" role="status">
        正在读取这次阅读回顾…
      </p>

      <ReadingReviewSummary
        v-else-if="status === 'ready' && review"
        :article-title="review.article.title"
        :active-duration-sec="review.attempt.activeDurationSec"
        :completed-at="review.attempt.completedAt"
        :reread-error-message="rereadActionError"
        :reread-state="rereadState"
        :source-label="review.article.source.label"
        @reread="handleReread"
      />

      <section
        v-else-if="status === 'missing'"
        class="review-view__state"
        role="alert"
        aria-labelledby="review-missing-title"
      >
        <h2 id="review-missing-title" class="review-view__state-title">
          {{ missingTitle }}
        </h2>
        <p class="review-view__state-copy">
          {{ missingMessage }}
        </p>
        <RouterLink class="review-view__state-link" :to="{ name: 'library' }">
          返回阅读库
        </RouterLink>
      </section>

      <section
        v-else-if="status === 'incomplete'"
        class="review-view__state"
        role="alert"
        aria-labelledby="review-incomplete-title"
      >
        <h2 id="review-incomplete-title" class="review-view__state-title">
          这次阅读尚未完成
        </h2>
        <p class="review-view__state-copy">
          完成整篇阅读后，这里会显示本次实际耗时和完成时间。
        </p>
        <div class="review-view__state-actions">
          <RouterLink
            v-if="attempt"
            class="review-view__state-link review-view__state-link--primary"
            :to="{ name: 'reader', params: { articleId: attempt.articleId } }"
          >
            继续阅读
          </RouterLink>
          <RouterLink class="review-view__state-link" :to="{ name: 'library' }">
            返回阅读库
          </RouterLink>
        </div>
      </section>

      <section
        v-else-if="status === 'error'"
        class="review-view__state"
        role="alert"
        aria-labelledby="review-error-title"
      >
        <h2 id="review-error-title" class="review-view__state-title">
          暂时无法读取回顾
        </h2>
        <p class="review-view__state-copy">
          {{ errorMessage }}
        </p>
        <div class="review-view__state-actions">
          <button
            class="review-view__state-link review-view__state-link--primary"
            type="button"
            @click="reload"
          >
            重试
          </button>
          <RouterLink class="review-view__state-link" :to="{ name: 'library' }">
            返回阅读库
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.review-view {
  min-block-size: 100vh;
  min-block-size: 100dvh;
  background: var(--surface-canvas);
}

.review-view__toolbar {
  position: sticky;
  inset-block-start: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(5.5rem, 1fr) auto minmax(5.5rem, 1fr);
  align-items: center;
  min-block-size: calc(3.5rem + env(safe-area-inset-top));
  border-block-end: 1px solid var(--border-subtle);
  padding-block-start: env(safe-area-inset-top);
  padding-inline:
    max(1rem, env(safe-area-inset-left))
    max(1rem, env(safe-area-inset-right));
  background: color-mix(in srgb, var(--surface-canvas) 94%, transparent);
  backdrop-filter: blur(16px);
}

.review-view__back {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 0.4rem;
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 700;
  text-decoration: none;
}

.review-view__heading {
  margin: 0;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 750;
}

.review-view__heading:focus {
  outline: 0;
}

.review-view__toolbar-spacer {
  min-inline-size: 5.5rem;
}

.review-view__main {
  display: grid;
  place-items: start center;
  inline-size: 100%;
  padding:
    clamp(1.5rem, 5vw, 4rem)
    max(1rem, env(safe-area-inset-right))
    max(3rem, env(safe-area-inset-bottom))
    max(1rem, env(safe-area-inset-left));
}

.review-view__loading,
.review-view__state {
  inline-size: min(100%, 42rem);
  margin-inline: auto;
}

.review-view__loading {
  color: var(--text-secondary);
  text-align: center;
}

.review-view__state {
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: clamp(1.25rem, 5vw, 2rem);
  background: var(--surface-elevated);
}

.review-view__state-title {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(1.5rem, 6vw, 2.25rem);
  letter-spacing: -0.035em;
}

.review-view__state-copy {
  margin: 0.85rem 0 1.5rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.review-view__state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.review-view__state-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
}

.review-view__state-link--primary {
  border-color: transparent;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.review-view__back:focus-visible,
.review-view__state-link:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.review-view__back:active,
.review-view__state-link:not(.review-view__state-link--primary):active {
  background: var(--accent-soft);
}

.review-view__state-link--primary:active {
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
}

@media (hover: hover) {
  .review-view__back:hover,
  .review-view__state-link:not(.review-view__state-link--primary):hover {
    background: var(--accent-soft);
    color: var(--text-accent);
  }

  .review-view__state-link--primary:hover {
    background: var(--accent-primary-active);
    color: var(--accent-contrast-active);
  }
}

@media (max-width: 28rem) {
  .review-view__toolbar {
    grid-template-columns: 2.75rem 1fr 2.75rem;
  }

  .review-view__back {
    inline-size: 2.75rem;
    padding: 0;
  }

  .review-view__back span {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .review-view__heading {
    justify-self: center;
  }

  .review-view__toolbar-spacer {
    min-inline-size: 2.75rem;
  }

  .review-view__state-actions,
  .review-view__state-link {
    inline-size: 100%;
  }
}
</style>
