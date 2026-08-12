<script setup lang="ts">
import {
  PhCaretRight,
  PhInfo,
  PhPencilSimple,
  PhTrash,
} from '@phosphor-icons/vue'

withDefaults(defineProps<{
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  rename: []
  source: []
  delete: []
}>()
</script>

<template>
  <ul class="article-action-menu" aria-label="文章操作">
    <li class="article-action-menu__item">
      <button
        class="article-action-menu__action"
        type="button"
        :disabled="busy"
        @click="emit('rename')"
      >
        <PhPencilSimple class="article-action-menu__icon" aria-hidden="true" :size="21" />
        <span class="article-action-menu__copy">
          <span class="article-action-menu__label">重命名</span>
          <span class="article-action-menu__description">修改文章在阅读库中的名称</span>
        </span>
        <PhCaretRight class="article-action-menu__caret" aria-hidden="true" :size="17" />
      </button>
    </li>
    <li class="article-action-menu__item">
      <button
        class="article-action-menu__action"
        type="button"
        :disabled="busy"
        @click="emit('source')"
      >
        <PhInfo class="article-action-menu__icon" aria-hidden="true" :size="21" />
        <span class="article-action-menu__copy">
          <span class="article-action-menu__label">来源详情</span>
          <span class="article-action-menu__description">查看来源与内容权利说明</span>
        </span>
        <PhCaretRight class="article-action-menu__caret" aria-hidden="true" :size="17" />
      </button>
    </li>
    <li class="article-action-menu__item">
      <button
        class="article-action-menu__action article-action-menu__action--danger"
        type="button"
        :disabled="busy"
        @click="emit('delete')"
      >
        <PhTrash class="article-action-menu__icon" aria-hidden="true" :size="21" />
        <span class="article-action-menu__copy">
          <span class="article-action-menu__label">删除文章</span>
          <span class="article-action-menu__description">同时移除阅读记录与原句上下文</span>
        </span>
        <PhCaretRight class="article-action-menu__caret" aria-hidden="true" :size="17" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.article-action-menu {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
}

.article-action-menu__item {
  list-style: none;
}

.article-action-menu__action {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  inline-size: 100%;
  min-block-size: 3.5rem;
  border: 1px solid transparent;
  border-radius: 0.65rem;
  padding: 0.65rem 0.75rem;
  background: transparent;
  color: var(--text-primary);
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
}

.article-action-menu__action:disabled {
  cursor: wait;
  opacity: 0.62;
}

.article-action-menu__action:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.article-action-menu__icon,
.article-action-menu__caret {
  flex: none;
  color: var(--text-secondary);
}

.article-action-menu__copy {
  display: grid;
  gap: 0.1rem;
  min-inline-size: 0;
}

.article-action-menu__label {
  font-weight: 700;
}

.article-action-menu__description {
  color: var(--text-secondary);
  font-size: 0.78rem;
  line-height: 1.4;
}

.article-action-menu__action--danger .article-action-menu__icon,
.article-action-menu__action--danger .article-action-menu__label {
  color: var(--status-danger-fg);
}

@media (hover: hover) {
  .article-action-menu__action:not(:disabled):hover {
    border-color: var(--border-subtle);
    background: var(--surface-subtle);
  }

  .article-action-menu__action--danger:not(:disabled):hover {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
  }
}

@media (forced-colors: active) {
  .article-action-menu__action {
    border-color: ButtonBorder;
    color: ButtonText;
  }

  .article-action-menu__action--danger .article-action-menu__icon,
  .article-action-menu__action--danger .article-action-menu__label {
    color: ButtonText;
  }
}
</style>
