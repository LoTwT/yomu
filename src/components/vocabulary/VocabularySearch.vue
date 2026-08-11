<script setup lang="ts">
const query = defineModel<string>({ required: true })

defineProps<{
  resultCount: number
  totalCount: number
  disabled?: boolean
}>()
</script>

<template>
  <div class="vocabulary-search">
    <label class="vocabulary-search__label" for="vocabulary-search-input">
      搜索收藏词
    </label>
    <input
      id="vocabulary-search-input"
      v-model="query"
      class="vocabulary-search__input"
      type="search"
      inputmode="search"
      autocomplete="off"
      placeholder="输入规范词或展示词"
      :disabled="disabled"
    >
    <p class="vocabulary-search__count" role="status" aria-live="polite">
      <template v-if="query.trim()">
        找到 {{ resultCount }} 个词
      </template>
      <template v-else>
        共 {{ totalCount }} 个收藏词
      </template>
    </p>
  </div>
</template>

<style scoped>
.vocabulary-search {
  display: grid;
  gap: 0.5rem;
}

.vocabulary-search__label {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 750;
}

.vocabulary-search__input {
  inline-size: 100%;
  min-block-size: 3rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding-inline: 0.85rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
}

.vocabulary-search__input:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.vocabulary-search__input:disabled {
  cursor: wait;
  opacity: 0.7;
}

.vocabulary-search__count {
  min-block-size: 1.25rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
}
</style>
