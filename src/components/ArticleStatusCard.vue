<script setup lang="ts">
import { computed } from 'vue'

import type { ArticlePackageLoadResult } from '@/features/article/articlePackageLoader'
import type { PublicDomainDifficultyOption } from '@/features/article/publicDomainSample'
import type { DailyArticle, PublicDomainDifficultyKey } from '@/features/article/types'

const props = defineProps<{
  state: Exclude<ArticlePackageLoadResult, { status: 'ready' }>
  publicDomainArticle: DailyArticle
  publicDomainDifficulty: PublicDomainDifficultyKey
  publicDomainDifficulties: PublicDomainDifficultyOption[]
}>()

const emit = defineEmits<{
  retry: []
  openCached: []
  openPublicDomain: []
  setPublicDomainDifficulty: [difficulty: PublicDomainDifficultyKey]
}>()

const cachedArticle = computed(() => 'cachedArticle' in props.state ? props.state.cachedArticle : null)
const canOpenCached = computed(() => Boolean(cachedArticle.value))
const canOpenPublicDomain = computed(() => props.state.status !== 'loading')
const publicDomainMetadata = computed(() => props.publicDomainArticle.publicDomainMetadata)

const copy = computed(() => {
  switch (props.state.status) {
    case 'loading':
      return {
        eyebrow: 'Today',
        title: "Bringing in today's reading...",
        deck: 'Preparing the page, lead voice, translation, and IPA support.',
      }
    case 'not-ready':
      return {
        eyebrow: 'Today',
        title: "Today's piece is still being prepared.",
        deck: "It'll be ready shortly. In the meantime, you can revisit a past reading.",
      }
    case 'offline':
      return {
        eyebrow: 'Offline',
        title: "You're offline, and today's piece isn't saved yet.",
        deck: "Reconnect to load it, or open a reading you've saved.",
      }
    case 'error':
      return {
        eyebrow: 'Today',
        title: "Today's reading didn't load.",
        deck: props.state.message,
      }
  }
})
</script>

<template>
  <section class="article-status-card" aria-labelledby="article-status-title">
    <p class="article-status-card__eyebrow">
      {{ copy.eyebrow }}
    </p>
    <h1 id="article-status-title" class="article-status-card__title">
      {{ copy.title }}
    </h1>
    <p class="article-status-card__deck">
      {{ copy.deck }}
    </p>
    <div v-if="state.status !== 'loading'" class="article-status-card__actions">
      <button
        v-if="canOpenCached"
        class="article-status-card__button article-status-card__button--primary"
        type="button"
        @click="emit('openCached')"
      >
        {{ state.status === 'offline' ? 'Read a saved piece' : 'Read a past piece' }}
      </button>
      <button class="article-status-card__button" type="button" @click="emit('retry')">
        Try again
      </button>
    </div>

    <section
      v-if="canOpenPublicDomain && publicDomainMetadata"
      class="article-status-card__fallback"
      aria-labelledby="public-domain-fallback-title"
    >
      <p class="article-status-card__fallback-kicker">Public-domain fallback</p>
      <h2 id="public-domain-fallback-title" class="article-status-card__fallback-title">
        先读一篇
      </h2>
      <p class="article-status-card__fallback-copy">
        不想先导入文章时,可以从同源内置的 vetted 选段开始。运行时不会直连 Project Gutenberg。
      </p>
      <div class="article-status-card__difficulty" aria-label="选择难度">
        <button
          v-for="difficulty in publicDomainDifficulties"
          :key="difficulty.key"
          type="button"
          class="article-status-card__difficulty-button"
          :class="{ 'article-status-card__difficulty-button--active': publicDomainDifficulty === difficulty.key }"
          :aria-pressed="publicDomainDifficulty === difficulty.key"
          @click="emit('setPublicDomainDifficulty', difficulty.key)"
        >
          {{ difficulty.label }}
        </button>
      </div>
      <p class="article-status-card__difficulty-note">
        难度为估算,依据长度、句长和词汇密度。
      </p>
      <article class="article-status-card__excerpt">
        <p class="article-status-card__excerpt-eyebrow">
          {{ publicDomainMetadata.difficulty.label }} · {{ publicDomainArticle.sentences.length }} sentences
        </p>
        <h3 class="article-status-card__excerpt-title">
          {{ publicDomainArticle.title }}
        </h3>
        <p class="article-status-card__excerpt-copy">
          {{ publicDomainArticle.deck }}
        </p>
        <p class="article-status-card__rights">
          来源:
          <a
            :href="publicDomainMetadata.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ publicDomainMetadata.sourceName }}
            <span aria-hidden="true">↗</span>
            <span class="article-status-card__sr-only">在新窗口打开</span>
          </a>
          · {{ publicDomainMetadata.author }} · {{ publicDomainMetadata.publicationYear }}
        </p>
        <p class="article-status-card__rights">
          {{ publicDomainMetadata.sourceLabel }}
        </p>
      </article>
      <button
        class="article-status-card__button article-status-card__button--primary"
        type="button"
        @click="emit('openPublicDomain')"
      >
        读这一篇
      </button>
    </section>
  </section>
</template>

<style scoped>
.article-status-card {
  max-inline-size: min(100%, 42rem);
  margin-inline: auto;
  padding: clamp(3rem, 9vw, 6rem) 1.25rem;
}

.article-status-card__eyebrow {
  margin: 0 0 0.75rem;
  color: var(--yomu-muted);
  font-size: 0.875rem;
}

.article-status-card__title {
  margin: 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  font-size: clamp(2.5rem, 8vw, 4.4rem);
  line-height: 1;
}

.article-status-card__deck {
  max-inline-size: 35rem;
  margin: 1rem 0 0;
  color: var(--yomu-ink-soft);
  font-size: 1.05rem;
  line-height: 1.7;
}

.article-status-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block-start: 1.5rem;
}

.article-status-card__button {
  min-block-size: 2.75rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 1rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.article-status-card__button--primary {
  border-color: transparent;
  background: var(--yomu-accent);
  color: var(--yomu-paper);
  font-weight: 650;
}

.article-status-card__button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

.article-status-card__fallback {
  max-inline-size: 38rem;
  margin-block-start: 2.5rem;
  border-block-start: 1px solid var(--yomu-rule);
  padding-block-start: 1.5rem;
}

.article-status-card__fallback-kicker,
.article-status-card__difficulty-note,
.article-status-card__excerpt-eyebrow,
.article-status-card__rights {
  margin: 0;
  color: var(--yomu-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}

.article-status-card__fallback-title,
.article-status-card__excerpt-title {
  margin: 0.35rem 0 0;
  color: var(--yomu-ink);
  font-family: var(--yomu-serif);
  line-height: 1.08;
}

.article-status-card__fallback-title {
  font-size: clamp(1.75rem, 5vw, 2.5rem);
}

.article-status-card__fallback-copy,
.article-status-card__excerpt-copy {
  margin: 0.75rem 0 0;
  color: var(--yomu-ink-soft);
  line-height: 1.7;
}

.article-status-card__difficulty {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-start: 1rem;
}

.article-status-card__difficulty-button {
  min-block-size: 2.5rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 999px;
  padding-inline: 0.85rem;
  background: var(--yomu-paper);
  color: var(--yomu-ink-soft);
  font: inherit;
  cursor: pointer;
}

.article-status-card__difficulty-button--active {
  border-color: transparent;
  background: var(--yomu-ink);
  color: var(--yomu-paper);
}

.article-status-card__difficulty-button:focus-visible {
  outline: 3px solid var(--yomu-focus);
  outline-offset: 3px;
}

.article-status-card__excerpt {
  margin-block: 1rem;
  border: 1px solid var(--yomu-rule);
  border-radius: 1rem;
  padding: 1rem;
}

.article-status-card__rights {
  margin-block-start: 0.7rem;
}

.article-status-card__rights a {
  color: var(--yomu-accent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.article-status-card__sr-only {
  position: absolute;
  overflow: hidden;
  inline-size: 1px;
  block-size: 1px;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
