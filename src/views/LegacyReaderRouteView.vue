<script setup lang="ts">
import { RouterLink } from 'vue-router'

import LegacyReaderView from '../legacy/LegacyReaderView.vue'
</script>

<template>
  <div class="legacy-route">
    <div class="legacy-route__notice" role="status">
      <span>Today 阅读</span>
      <RouterLink class="legacy-route__back" :to="{ name: 'library' }">
        返回我的阅读
      </RouterLink>
    </div>
    <LegacyReaderView />
  </div>
</template>

<style scoped>
.legacy-route {
  min-block-size: 100vh;
  min-block-size: 100dvh;
}

.legacy-route__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-block-size: calc(3.5rem + env(safe-area-inset-top));
  border-block-end: 1px solid var(--border-subtle);
  padding-inline:
    max(1rem, env(safe-area-inset-left))
    max(1rem, env(safe-area-inset-right));
  padding-block-start: env(safe-area-inset-top);
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.legacy-route__back {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  color: var(--text-accent);
  font-weight: 700;
}

.legacy-route__back:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}
</style>
