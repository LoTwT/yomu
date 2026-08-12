<script setup lang="ts">
import LibraryArticleItem, {
  type LibraryArticleManageRequest,
} from './LibraryArticleItem.vue'
import type { LibraryArticleViewModel } from '@/features/library/libraryViewModel'

defineProps<{
  articles: readonly LibraryArticleViewModel[]
  restoreFocusArticleId?: string | null
}>()

const emit = defineEmits<{
  manage: [request: LibraryArticleManageRequest]
}>()
</script>

<template>
  <ol class="article-collection" data-testid="article-collection" aria-label="我的文章列表">
    <LibraryArticleItem
      v-for="article in articles"
      :key="article.id"
      :article="article"
      :restore-focus="article.id === restoreFocusArticleId"
      @manage="emit('manage', $event)"
    />
  </ol>
</template>

<style scoped>
.article-collection {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  margin: 0;
  padding: 0;
}

@media (min-width: 1200px) {
  .article-collection {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }
}
</style>
