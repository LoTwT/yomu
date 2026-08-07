// @vitest-environment node

import { fileURLToPath, URL } from 'node:url'

import { resolveConfig } from 'vite'

test('development ignores Cloudflare runtime state in the Vite watcher', async () => {
  const config = await resolveConfig({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    mode: 'development',
  }, 'serve')

  expect(config.server.watch?.ignored).toEqual(
    expect.arrayContaining(['**/.wrangler/**']),
  )
})
