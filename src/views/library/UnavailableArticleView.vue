<script setup lang="ts">
import { RouterLink } from 'vue-router'

import { usePageHeadingFocus } from '../usePageHeadingFocus'

defineProps<{
  articleId: string
}>()

usePageHeadingFocus()
</script>

<template>
  <section class="unavailable-article" aria-labelledby="unavailable-article-heading">
    <p class="unavailable-article__eyebrow">
      文章不可用
    </p>
    <h1
      id="unavailable-article-heading"
      ref="pageHeading"
      class="unavailable-article__title"
      data-page-heading
      tabindex="-1"
    >
      这篇文章还不能打开
    </h1>
    <p class="unavailable-article__message">
      这篇文章尚未接入本机阅读库，Yomu 不会用其他正文代替它。
    </p>
    <p class="unavailable-article__request">
      请求的文章 ID：<code translate="no">{{ articleId }}</code>
    </p>
    <RouterLink class="unavailable-article__back" :to="{ name: 'library' }">
      返回我的阅读
    </RouterLink>
  </section>
</template>

<style scoped>
.unavailable-article {
  max-inline-size: 42rem;
  margin-inline: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: clamp(1.25rem, 4vw, 2rem);
  background: var(--surface-elevated);
}

.unavailable-article__eyebrow {
  margin: 0 0 0.5rem;
  color: var(--text-accent);
  font-size: 0.875rem;
  font-weight: 700;
}

.unavailable-article__title {
  margin: 0;
  font-size: clamp(1.75rem, 6vw, 2.5rem);
  letter-spacing: -0.035em;
}

.unavailable-article__title:focus {
  outline: 0;
}

.unavailable-article__message {
  margin: 1rem 0 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.unavailable-article__request {
  margin: 1rem 0 1.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.unavailable-article__request code {
  color: var(--text-primary);
}

.unavailable-article__back {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
  font-weight: 700;
  text-decoration: none;
}

.unavailable-article__back:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.unavailable-article__back:active {
  background: var(--accent-primary-active);
  color: var(--accent-contrast-active);
}

@media (hover: hover) {
  .unavailable-article__back:hover {
    background: var(--accent-primary-active);
    color: var(--accent-contrast-active);
  }
}
</style>
