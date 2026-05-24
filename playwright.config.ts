import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost pnpm exec vite --host 127.0.0.1 --port 57241',
    url: 'http://127.0.0.1:57241',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:57241',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
