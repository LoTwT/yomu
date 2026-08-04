<script setup lang="ts">
import ArticleCollection from './library/ArticleCollection.vue'
import ContinueReadingCard from './library/ContinueReadingCard.vue'
import RecommendationCard from './library/RecommendationCard.vue'
import {
  continueReadingArticle,
  libraryArticles,
  recommendedArticle,
} from './library/libraryFixtures'
import { usePageHeadingFocus } from './usePageHeadingFocus'

usePageHeadingFocus()
</script>

<template>
  <div class="library-view">
    <h1 ref="pageHeading" class="library-view__page-title" data-page-heading tabindex="-1">
      我的阅读
    </h1>

    <section class="library-section" aria-labelledby="continue-heading">
      <h2 id="continue-heading" class="library-section__heading library-section__heading--accent">
        继续阅读
      </h2>
      <ContinueReadingCard :article="continueReadingArticle" />
    </section>

    <section class="library-section" aria-labelledby="articles-heading">
      <h2 id="articles-heading" class="library-section__heading">
        我的文章
      </h2>
      <ArticleCollection :articles="libraryArticles" />
    </section>

    <section class="library-section" aria-labelledby="recommendations-heading">
      <h2 id="recommendations-heading" class="library-section__heading">
        公共领域推荐
      </h2>
      <RecommendationCard :article="recommendedArticle" />
    </section>
  </div>
</template>

<style scoped>
.library-view {
  display: grid;
  gap: 1.25rem;
}

.library-view__page-title {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.library-view__page-title:focus {
  outline: 0;
}

.library-section {
  min-inline-size: 0;
}

.library-section__heading {
  margin: 0 0 0.75rem;
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.library-section__heading--accent {
  color: var(--text-accent);
  font-size: 0.9rem;
}

@media (min-width: 768px) {
  .library-view {
    gap: 2.5rem;
  }

  .library-section__heading {
    margin-block-end: 1rem;
  }
}

@media (min-width: 1200px) {
  .library-view {
    gap: 1.5rem;
  }
}
</style>
