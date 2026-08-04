<script setup lang="ts">
import LibraryArticleItem from './LibraryArticleItem.vue'
import type { LibraryArticle } from './libraryFixtures'

defineProps<{
  articles: readonly LibraryArticle[]
}>()
</script>

<template>
  <ol class="article-collection" aria-label="我的文章列表">
    <LibraryArticleItem
      v-for="article in articles"
      :key="article.id"
      :article="article"
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
