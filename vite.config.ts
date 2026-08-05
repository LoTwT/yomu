import { fileURLToPath, URL } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type PartialEnvironment, type Plugin, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const shellTargets = ['web-pwa', 'desktop-shell', 'mobile-shell'] as const

type ShellTarget = typeof shellTargets[number]

function resolveShellTarget(mode: string): ShellTarget {
  return shellTargets.includes(mode as ShellTarget) ? mode as ShellTarget : 'web-pwa'
}

function createPwaPlugin(): Plugin[] {
  return VitePWA({
    injectRegister: 'script-defer',
    manifest: {
      name: 'Yomu — Your local English reading library',
      short_name: 'Yomu',
      description: 'A local-first English reading library for focused reading, read-aloud practice, and vocabulary review.',
      lang: 'zh-CN',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#faf8f4',
      theme_color: '#faf8f4',
      categories: ['education', 'productivity'],
      icons: [
        {
          src: '/icons/yomu-icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,mjs,css,json,svg,woff,woff2}'],
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
      clientsClaim: false,
      skipWaiting: false,
      runtimeCaching: [],
    },
  })
}

function clientOnly(plugins: Plugin | Plugin[]): Plugin[] {
  return (Array.isArray(plugins) ? plugins : [plugins]).map(plugin => ({
    ...plugin,
    applyToEnvironment: (environment: PartialEnvironment) => environment.name === 'client',
  }))
}

export default defineConfig(({ mode }) => {
  const target = resolveShellTarget(mode)
  const plugins: PluginOption[] = []

  if (target === 'web-pwa') {
    plugins.push(
      clientOnly(tailwindcss()),
      clientOnly(vue()),
      clientOnly(createPwaPlugin()),
      cloudflare(),
    )
  }
  else {
    plugins.push(tailwindcss(), vue())
  }

  return {
    plugins,
    define: {
      __YOMU_TARGET__: JSON.stringify(target),
    },
    build: {
      emptyOutDir: true,
      outDir: target === 'web-pwa' ? 'dist' : `dist-targets/${target}`,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
