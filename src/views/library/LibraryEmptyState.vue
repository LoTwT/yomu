<script setup lang="ts">
import { PhBookOpenText, PhTextAlignLeft } from '@phosphor-icons/vue'
import { RouterLink } from 'vue-router'
</script>

<template>
  <section
    class="library-empty"
    data-testid="library-empty-state"
    aria-labelledby="library-empty-heading"
  >
    <div class="library-empty__icon" aria-hidden="true">
      <PhBookOpenText :size="31" />
    </div>
    <div class="library-empty__copy">
      <h2 id="library-empty-heading" class="library-empty__title">
        导入一段英文即可开始
      </h2>
      <p class="library-empty__description">
        文章和阅读进度只保存在此设备；无需账号，也不会自动同步到其他安装。
      </p>
    </div>
    <div class="library-empty__actions">
      <RouterLink class="library-empty__primary" :to="{ name: 'import' }">
        <PhTextAlignLeft aria-hidden="true" :size="20" />
        粘贴英文内容
      </RouterLink>
      <RouterLink class="library-empty__secondary" :to="{ name: 'legacy' }">
        阅读 Today 示例
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.library-empty {
  display: grid;
  gap: 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--surface-elevated);
}

.library-empty__icon {
  display: grid;
  place-items: center;
  inline-size: 3rem;
  block-size: 3rem;
  border-radius: var(--radius-control);
  background: var(--accent-soft);
  color: var(--text-accent);
}

.library-empty__title {
  margin: 0;
  font-family: var(--font-reading);
  font-size: clamp(1.35rem, 5vw, 1.75rem);
}

.library-empty__description {
  max-inline-size: 38rem;
  margin: 0.5rem 0 0;
  color: var(--text-secondary);
  line-height: 1.65;
}

.library-empty__actions {
  display: grid;
  gap: 0.65rem;
}

.library-empty__primary,
.library-empty__secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  padding-inline: 1rem;
  font-weight: 700;
  text-decoration: none;
}

.library-empty__primary {
  gap: 0.55rem;
  background: var(--accent-primary-hover);
  color: var(--accent-contrast-hover);
}

.library-empty__secondary {
  border: 1px solid var(--border-subtle);
  color: var(--text-accent);
}

.library-empty__primary:focus-visible,
.library-empty__secondary:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

@media (min-width: 768px) {
  .library-empty {
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    padding: 1.5rem;
  }

  .library-empty__actions {
    min-inline-size: 12rem;
  }
}
</style>
