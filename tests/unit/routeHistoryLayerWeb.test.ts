/** @vitest-environment jsdom */

import {
  createRouter,
  createWebHistory,
} from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import { createCoordinatedRouterHistory } from '@/app/routeLeaveCoordinator'

describe('route history layers in Web History', () => {
  it('persists an invalid marker tombstone before a fresh registration can adopt it', async () => {
    const sourceHistory = createWebHistory()
    const coordinated = createCoordinatedRouterHistory(sourceHistory)
    const router = createRouter({
      history: coordinated.history,
      routes: [{
        path: '/read/:articleId',
        component: { template: '<p>Reader</p>' },
      }],
    })
    coordinated.coordinator.attachRouter(router)
    await router.replace('/read/a')
    await router.isReady()

    const layer = coordinated.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      origin: () => router.currentRoute.value.fullPath,
    })
    expect(layer.activate()).toBe(true)
    await router.push('/read/b')
    await layer.deactivate()

    router.back()
    await vi.waitFor(() => {
      expect(location.pathname).toBe('/read/a')
      expect(router.currentRoute.value.fullPath).toBe('/read/a')
    })
    expect(history.state.__yomuRouteHistoryLayer).toBeNull()
    layer.dispose()
    coordinated.history.destroy()

    const reloadedSourceHistory = createWebHistory()
    const reloaded = createCoordinatedRouterHistory(reloadedSourceHistory)
    const onReloadActivate = vi.fn()
    reloaded.coordinator.registerHistoryLayer({
      id: 'reader-settings',
      onActivate: onReloadActivate,
      onDeactivate: vi.fn(),
      origin: () => '/read/a',
    })

    expect(onReloadActivate).not.toHaveBeenCalled()
    reloaded.history.destroy()
  })
})
