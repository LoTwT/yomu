<script setup lang="ts">
import { RouterLink } from 'vue-router'

import { usePageHeadingFocus } from './usePageHeadingFocus'

usePageHeadingFocus()
</script>

<template>
  <div class="simple-view">
    <h1 ref="pageHeading" class="simple-view__title" data-page-heading tabindex="-1">
      收藏词
    </h1>
    <section class="simple-view__panel" aria-labelledby="empty-words-heading">
      <h2 id="empty-words-heading" class="simple-view__panel-title">
        还没有收藏词
      </h2>
      <p class="simple-view__copy">
        阅读时打开词卡并选择收藏，单词与原句会显示在这里。
      </p>
      <RouterLink class="simple-view__link" :to="{ name: 'legacy' }">
        阅读 Today 示例
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.simple-view {
  max-inline-size: 48rem;
  margin-inline: auto;
}

.simple-view__title {
  margin: 0 0 1.5rem;
  font-size: clamp(1.8rem, 5vw, 2.5rem);
}

.simple-view__title:focus {
  outline: 0;
}

.simple-view__panel {
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--surface-elevated);
}

.simple-view__panel-title {
  margin: 0;
  font-size: 1.1rem;
}

.simple-view__copy {
  margin-block: 0.75rem 1rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.simple-view__link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  color: var(--text-accent);
  font-weight: 700;
}
</style>
