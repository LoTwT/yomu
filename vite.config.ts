import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      injectRegister: 'script-defer',
      manifest: {
        name: 'Yomu — Daily Read-Aloud Practice',
        short_name: 'Yomu',
        description: 'A quiet daily read-aloud language practice app with lead voice, sentence highlighting, translation support, and pronunciation notes.',
        lang: 'en',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fbf8f1',
        theme_color: '#fbf8f1',
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
        globPatterns: ['**/*.{html,js,mjs,css,json,svg}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
