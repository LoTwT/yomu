<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import type { ReadingRereadState } from '@/features/review/useReadingReview'

const props = defineProps<{
  articleTitle: string
  activeDurationSec: number
  completedAt: string
  sourceLabel: string
  rereadState: ReadingRereadState
  rereadErrorMessage?: string
}>()

const emit = defineEmits<{
  reread: []
}>()

const durationLabel = computed(() => formatDuration(props.activeDurationSec))
const completedAtLabel = computed(() => formatCompletedAt(props.completedAt))

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours} 小时`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} 分`)
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} 秒`)
  }

  return parts.join(' ')
}

function formatCompletedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date)
}
</script>

<template>
  <section class="review-summary" aria-labelledby="review-article-title">
    <p class="review-summary__status">
      阅读完成
    </p>
    <h2 id="review-article-title" class="review-summary__title" lang="en">
      {{ props.articleTitle }}
    </h2>
    <p class="review-summary__copy">
      这次专注阅读已记录在本机。
    </p>

    <dl class="review-summary__facts">
      <div class="review-summary__fact">
        <dt>实际耗时</dt>
        <dd>{{ durationLabel }}</dd>
      </div>
      <div class="review-summary__fact">
        <dt>完成时间</dt>
        <dd>
          <time :datetime="props.completedAt">{{ completedAtLabel }}</time>
        </dd>
      </div>
      <div class="review-summary__fact">
        <dt>来源</dt>
        <dd>{{ props.sourceLabel }}</dd>
      </div>
    </dl>

    <p v-if="props.rereadErrorMessage" class="review-summary__error" role="alert">
      {{ props.rereadErrorMessage }}
    </p>
    <div class="review-summary__actions">
      <button
        class="review-summary__action review-summary__action--primary"
        type="button"
        :disabled="props.rereadState === 'starting'"
        @click="emit('reread')"
      >
        {{ props.rereadState === 'starting' ? '正在开始新阅读…' : '再读一次' }}
      </button>
      <RouterLink
        class="review-summary__action review-summary__action--secondary"
        :to="{ name: 'library' }"
      >
        返回阅读库
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.review-summary {
  inline-size: min(100%, 42rem);
  margin-inline: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: clamp(1.25rem, 5vw, 2.5rem);
  background: var(--surface-elevated);
}

.review-summary__status {
  display: inline-flex;
  align-items: center;
  min-block-size: 2rem;
  margin: 0 0 0.75rem;
  border-radius: 999px;
  padding-inline: 0.75rem;
  background: var(--accent-soft);
  color: var(--text-accent);
  font-size: 0.875rem;
  font-weight: 750;
}

.review-summary__title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: clamp(2rem, 8vw, 3.5rem);
  letter-spacing: -0.04em;
  line-height: 1.08;
  overflow-wrap: anywhere;
}

.review-summary__copy {
  margin: 1rem 0 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.review-summary__facts {
  display: grid;
  gap: 0;
  margin: 2rem 0 0;
  border-block: 1px solid var(--border-subtle);
}

.review-summary__fact {
  display: grid;
  grid-template-columns: minmax(5rem, 0.35fr) minmax(0, 1fr);
  gap: 1rem;
  padding-block: 1rem;
}

.review-summary__fact + .review-summary__fact {
  border-block-start: 1px solid var(--border-subtle);
}

.review-summary__fact dt,
.review-summary__fact dd {
  margin: 0;
}

.review-summary__fact dt {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.review-summary__fact dd {
  color: var(--text-primary);
  font-weight: 650;
  overflow-wrap: anywhere;
}

.review-summary__actions {
  display: grid;
  gap: 0.75rem;
  margin-block-start: 2rem;
}

.review-summary__error {
  margin: 1rem 0 0;
  color: var(--text-danger, var(--text-primary));
  line-height: 1.6;
}

.review-summary__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font: inherit;
  font-weight: 750;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.review-summary__action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.review-summary__action--primary {
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.review-summary__action--secondary {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.review-summary__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.review-summary__action--primary:active {
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
}

.review-summary__action--secondary:active {
  background: var(--accent-soft);
}

@media (hover: hover) {
  .review-summary__action--primary:hover {
    background: var(--accent-primary-active);
    color: var(--accent-contrast-active);
  }

  .review-summary__action--secondary:hover {
    border-color: var(--accent-primary);
    background: var(--accent-soft);
    color: var(--text-accent);
  }
}

@media (min-width: 36rem) {
  .review-summary__actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 28rem) {
  .review-summary__fact {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }
}
</style>
