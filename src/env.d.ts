/// <reference types="vite/client" />

declare const __YOMU_TARGET__: 'web-pwa' | 'desktop-shell' | 'mobile-shell'

interface Fetcher {
  fetch: (request: Request) => Promise<Response>
}

interface RateLimit {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}
