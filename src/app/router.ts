import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
  type RouteRecordRaw,
} from 'vue-router'

import { LEGACY_TODAY_ARTICLE_ID } from '../views/library/libraryFixtures'

function resolveArticleId(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

const readerRoutes: RouteRecordRaw[] = typeof __YOMU_TARGET__ === 'undefined' || __YOMU_TARGET__ === 'web-pwa'
  ? [
      {
        path: '/legacy',
        name: 'legacy',
        component: () => import('../views/LegacyReaderRouteView.vue'),
        meta: { immersive: true },
      },
      {
        path: '/read/:articleId',
        name: 'legacy-reader',
        component: () => import('../views/LegacyReaderRouteView.vue'),
        meta: { immersive: true },
        beforeEnter(to) {
          const articleId = resolveArticleId(to.params.articleId)

          if (articleId === LEGACY_TODAY_ARTICLE_ID) {
            return true
          }

          return {
            name: 'article-unavailable',
            params: { articleId },
            replace: true,
          }
        },
      },
    ]
  : [
      {
        path: '/legacy',
        name: 'legacy',
        component: () => import('../views/library/UnavailableArticleView.vue'),
        props: { articleId: LEGACY_TODAY_ARTICLE_ID },
      },
      {
        path: '/read/:articleId',
        name: 'legacy-reader',
        component: () => import('../views/library/UnavailableArticleView.vue'),
        props: route => ({ articleId: resolveArticleId(route.params.articleId) }),
      },
    ]

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'library',
    component: () => import('../views/LibraryView.vue'),
  },
  {
    path: '/words',
    name: 'words',
    component: () => import('../views/VocabularyView.vue'),
  },
  {
    path: '/import',
    name: 'import',
    component: () => import('../views/ImportView.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
  },
  ...readerRoutes,
  {
    path: '/unavailable/:articleId',
    name: 'article-unavailable',
    component: () => import('../views/library/UnavailableArticleView.vue'),
    props: true,
  },
  {
    path: '/today',
    redirect: { name: 'legacy' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'library' },
  },
]

export function createYomuRouter(history: RouterHistory = createWebHistory(import.meta.env.BASE_URL)): Router {
  return createRouter({
    history,
    routes,
    scrollBehavior(_to, _from, savedPosition) {
      return savedPosition ?? { left: 0, top: 0 }
    },
  })
}

export const router = createYomuRouter()
