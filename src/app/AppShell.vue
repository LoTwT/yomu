<script setup lang="ts">
import {
  PhBookOpen,
  PhBookmarkSimple,
  PhGearSix,
  PhUploadSimple,
} from '@phosphor-icons/vue'
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
const isImmersive = computed(() => route.meta.immersive === true)
</script>

<template>
  <div class="yomu-app" :class="{ 'yomu-app--immersive': isImmersive }">
    <a v-if="!isImmersive" class="skip-link" href="#main-content">
      跳到主要内容
    </a>

    <header v-if="!isImmersive" class="shell-header">
      <div class="shell-header__inner">
        <RouterLink class="brand-link" :to="{ name: 'library' }" aria-label="Yomu 我的阅读">
          Yomu
        </RouterLink>

        <nav class="primary-nav" aria-label="一级导航">
          <RouterLink
            class="primary-nav__link"
            :to="{ name: 'library' }"
            exact-active-class="primary-nav__link--active"
          >
            <PhBookOpen class="primary-nav__icon" aria-hidden="true" :size="22" />
            我的阅读
          </RouterLink>
          <RouterLink
            class="primary-nav__link"
            :to="{ name: 'words' }"
            active-class="primary-nav__link--active"
          >
            <PhBookmarkSimple class="primary-nav__icon" aria-hidden="true" :size="22" />
            收藏词
          </RouterLink>
        </nav>

        <div class="shell-actions" aria-label="应用操作">
          <RouterLink
            class="shell-actions__link shell-actions__link--primary"
            :to="{ name: 'import' }"
            aria-label="导入内容"
          >
            <PhUploadSimple class="shell-actions__icon" aria-hidden="true" :size="20" />
            <span class="shell-actions__wide-label">导入内容</span>
          </RouterLink>
          <RouterLink class="shell-actions__link" :to="{ name: 'settings' }" aria-label="设置">
            <PhGearSix class="shell-actions__icon" aria-hidden="true" :size="20" />
            <span class="shell-actions__settings-label">设置</span>
          </RouterLink>
        </div>
      </div>
    </header>

    <RouterView v-slot="{ Component }">
      <main v-if="!isImmersive" id="main-content" class="shell-content">
        <component :is="Component" />
      </main>
      <component :is="Component" v-else />
    </RouterView>
  </div>
</template>

<style scoped>
.yomu-app {
  min-block-size: 100vh;
  min-block-size: 100dvh;
  color: var(--text-primary);
}

.yomu-app--immersive {
  background: var(--surface-canvas);
}

.skip-link {
  position: fixed;
  inset-block-start: 0.5rem;
  inset-inline-start: 0.5rem;
  z-index: 100;
  translate: 0 -160%;
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--surface-elevated);
  color: var(--text-primary);
}

.skip-link:focus {
  translate: 0;
}

.shell-header {
  position: sticky;
  inset-block-start: 0;
  z-index: 30;
  border-block-end: 1px solid var(--border-subtle);
  background: var(--surface-canvas);
}

.shell-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-block-size: calc(3.5rem + env(safe-area-inset-top));
  margin-inline: auto;
  padding-block-start: env(safe-area-inset-top);
  padding-inline:
    max(1rem, env(safe-area-inset-left))
    max(1rem, env(safe-area-inset-right));
}

.brand-link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  min-inline-size: 2.75rem;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 760;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.primary-nav {
  position: fixed;
  inset-inline: 0;
  inset-block-end: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-block-size: calc(3.75rem + env(safe-area-inset-bottom));
  border-block-start: 1px solid var(--border-subtle);
  padding:
    0.25rem
    max(0.75rem, env(safe-area-inset-right))
    env(safe-area-inset-bottom)
    max(0.75rem, env(safe-area-inset-left));
  background: var(--surface-elevated);
}

.primary-nav__link,
.shell-actions__link {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  border-radius: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 650;
  text-decoration: none;
}

.primary-nav__link {
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
}

.primary-nav__icon,
.shell-actions__icon {
  flex: none;
}

.primary-nav__link--active {
  color: var(--text-accent);
}

.primary-nav__link--active::after {
  position: absolute;
  inset-block-end: calc(0.25rem + env(safe-area-inset-bottom));
  inset-inline-start: 50%;
  inline-size: 2rem;
  block-size: 0.125rem;
  border-radius: 999px;
  background: currentColor;
  display: block;
  content: '';
  translate: -50% 0;
}

.shell-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.shell-actions__link {
  gap: 0.45rem;
  min-inline-size: 2.75rem;
  padding-inline: 0.65rem;
}

.shell-actions__link--primary {
  border: 1px solid var(--accent-primary);
  color: var(--text-accent);
}

.shell-actions__wide-label,
.shell-actions__settings-label {
  display: none;
}

.shell-content {
  inline-size: 100%;
  min-block-size: calc(100vh - 3.5rem - env(safe-area-inset-top));
  min-block-size: calc(100dvh - 3.5rem - env(safe-area-inset-top));
  margin-inline: auto;
  padding: 1.5rem 1rem calc(5rem + env(safe-area-inset-bottom));
}

.brand-link:focus-visible,
.primary-nav__link:focus-visible,
.shell-actions__link:focus-visible,
.skip-link:focus-visible {
  outline: 3px solid var(--focus-ring-color);
  outline-offset: 3px;
}

.primary-nav__link:active,
.shell-actions__link:active,
.brand-link:active {
  background: var(--accent-soft);
}

@media (hover: hover) {
  .primary-nav__link:hover,
  .shell-actions__link:hover,
  .brand-link:hover {
    background: var(--accent-soft);
    color: var(--text-accent);
  }
}

@media (min-width: 768px) {
  .shell-header__inner {
    gap: 2rem;
    min-block-size: calc(4rem + env(safe-area-inset-top));
    max-inline-size: 75rem;
    padding-inline: 1.5rem;
  }

  .shell-header {
    background: color-mix(in srgb, var(--surface-canvas) 94%, transparent);
    backdrop-filter: blur(16px);
  }

  .primary-nav {
    position: static;
    display: flex;
    align-self: stretch;
    min-block-size: auto;
    margin-inline-end: auto;
    border: 0;
    padding: 0;
    background: transparent;
  }

  .primary-nav__link {
    position: relative;
    flex-direction: row;
    gap: 0;
    min-inline-size: 5.5rem;
    border-radius: 0;
    font-size: 0.875rem;
  }

  .primary-nav__icon {
    display: none;
  }

  .primary-nav__link--active::after {
    display: block;
    inset-block-end: 0;
    inline-size: 100%;
  }

  .shell-actions {
    gap: 0.5rem;
  }

  .shell-actions__wide-label {
    display: inline;
  }

  .shell-actions__link--primary {
    padding-inline: 1rem;
  }

  .shell-content {
    max-inline-size: 60rem;
    min-block-size: calc(100vh - 4rem - env(safe-area-inset-top));
    min-block-size: calc(100dvh - 4rem - env(safe-area-inset-top));
    padding: 2rem 1.5rem 3rem;
  }
}

@media (min-width: 1200px) {
  .shell-header__inner,
  .shell-content {
    max-inline-size: 75rem;
  }

  .shell-header__inner {
    padding-inline: 2rem;
  }

  .shell-actions__settings-label {
    display: inline;
  }

  .shell-content {
    padding: 2rem 2rem 1.5rem;
  }
}
</style>
