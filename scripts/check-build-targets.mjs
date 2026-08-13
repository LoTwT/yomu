import { readFile, readdir } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import process from 'node:process'

import { build } from 'vite'

const repositoryRoot = process.cwd()
const sourceRoot = join(repositoryRoot, 'src')
const targets = [
  { mode: 'web-pwa', outputDirectory: join(repositoryRoot, 'dist/client'), web: true },
  { mode: 'desktop-shell', outputDirectory: join(repositoryRoot, 'dist-targets/desktop-shell'), web: false },
  { mode: 'mobile-shell', outputDirectory: join(repositoryRoot, 'dist-targets/mobile-shell'), web: false },
]
const forbiddenShellAdapterModules = [
  '/src/platform/web/createWebPlatformServices.ts',
  '/src/platform/web/indexedDbLocalRepositories.ts',
  '/src/platform/web/indexedDbSchema.ts',
  '/src/platform/web/runtimeAdapters.ts',
  '/src/platform/web/storageAdapters.ts',
]
const forbiddenShellRuntimeModules = [
  '/src/platform/fake/',
  '/src/views/LegacyReaderRouteView.vue',
  '/src/legacy/',
  '/src/features/article/articlePackageLoader.ts',
  '/src/features/tts/configuredSentencePlayer.ts',
  '/src/features/tts/mimoAdapter.ts',
  '/src/features/extension/aiAdapter.ts',
]
const forbiddenShellChunkNames = [
  'createFakePlatformServices',
  'FakeCloudSpeech',
  'LegacyReaderRouteView',
  'LegacyReaderView',
  'articlePackageLoader',
  'configuredSentencePlayer',
  'mimoAdapter',
  'aiAdapter',
]
const forbiddenShellProviderMarkers = [
  { label: 'mimo-tts', pattern: /mimo-tts/i },
  { label: 'FakeCloudSpeech', pattern: /fake[\s_-]*cloud[\s_-]*speech/i },
]
const remoteApiPaths = [
  '/api/import/url',
  '/api/tts/mimo',
  '/api/extensions/ai',
]

await assertApiPathsStayBehindPlatformBoundary()

for (const target of targets) {
  const result = await build({
    mode: target.mode,
    logLevel: 'warn',
  })
  const moduleIds = collectModuleIds(result)
  const files = await collectFiles(target.outputDirectory)
  const javaScript = await collectJavaScript(files)
  assert(
    moduleIds.some(moduleId => moduleId.endsWith('/src/platform/bootstrap.ts')),
    `${target.mode} must include the shared host bootstrap`,
  )
  assert(
    moduleIds.some(moduleId => moduleId.includes('/src/views/ReaderView.vue')),
    `${target.mode} must include the shared Reader view`,
  )
  assert(
    moduleIds.some(moduleId => moduleId.endsWith('/src/features/reader/useReadingSession.ts')),
    `${target.mode} must include the shared Reader session`,
  )

  if (target.web) {
    await assertWebBuild(target.outputDirectory, files, moduleIds, javaScript)
  }
  else {
    await assertShellBuild(target.mode, target.outputDirectory, files, moduleIds, javaScript)
  }

  console.log(`Build smoke passed: ${target.mode}`)
}

function collectModuleIds(buildResult) {
  const outputs = Array.isArray(buildResult) ? buildResult : [buildResult]
  return outputs.flatMap(output => output?.output ?? [])
    .filter(item => item.type === 'chunk')
    .flatMap(chunk => Object.keys(chunk.modules))
    .map(moduleId => moduleId.replaceAll('\\', '/'))
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

async function collectJavaScript(files) {
  const javaScriptFiles = files.filter(file => ['.js', '.mjs'].includes(extname(file)))
  return (await Promise.all(javaScriptFiles.map(file => readFile(file, 'utf8')))).join('\n')
}

async function assertWebBuild(outputDirectory, files, moduleIds, javaScript) {
  const relativeFiles = files.map(file => relative(outputDirectory, file).replaceAll('\\', '/'))
  assert(relativeFiles.includes('sw.js'), 'web-pwa must emit sw.js')
  assert(relativeFiles.includes('registerSW.js'), 'web-pwa must emit registerSW.js')
  assert(relativeFiles.includes('manifest.webmanifest'), 'web-pwa must emit manifest.webmanifest')

  const fonts = relativeFiles.filter(file => file.endsWith('.woff2'))
  assert(fonts.length > 0, 'web-pwa must emit bundled .woff2 fonts')

  const serviceWorker = await readFile(join(outputDirectory, 'sw.js'), 'utf8')
  const indexHtml = await readFile(join(outputDirectory, 'index.html'), 'utf8')
  assert(indexHtml.includes('registerSW.js'), 'web-pwa index must register its Service Worker')
  assert(
    fonts.some(font => serviceWorker.includes(basename(font))),
    'web-pwa Service Worker must precache at least one emitted font',
  )
  assert(
    moduleIds.some(moduleId => moduleId.endsWith('/src/platform/web/createWebPlatformServices.ts')),
    'web-pwa must include the Web PlatformServices adapter',
  )
  assert(
    moduleIds.some(moduleId => moduleId.endsWith('/src/platform/web/runtimeAdapters.ts')),
    'web-pwa must include the Web remote services adapter',
  )
  assert(
    moduleIds.some(moduleId => moduleId.includes('/src/views/LegacyReaderRouteView.vue')),
    'web-pwa must retain the compatibility reader route',
  )
  for (const apiPath of remoteApiPaths) {
    assert(
      javaScript.includes(apiPath),
      `web-pwa remote adapter must include ${apiPath}`,
    )
  }
}

async function assertShellBuild(mode, outputDirectory, files, moduleIds, javaScript) {
  const relativeFiles = files.map(file => relative(outputDirectory, file).replaceAll('\\', '/'))
  const forbiddenArtifacts = relativeFiles.filter((file) => {
    const fileName = basename(file)
    return fileName === 'sw.js'
      || fileName === 'registerSW.js'
      || fileName === 'manifest.webmanifest'
      || /^workbox-.*\.js$/.test(fileName)
  })
  assert(
    forbiddenArtifacts.length === 0,
    `${mode} must not emit PWA artifacts: ${forbiddenArtifacts.join(', ')}`,
  )

  const indexHtml = await readFile(join(outputDirectory, 'index.html'), 'utf8')
  assert(!indexHtml.includes('registerSW.js'), `${mode} index must not register a Service Worker`)
  assert(!indexHtml.includes('manifest.webmanifest'), `${mode} index must not link a Web App Manifest`)

  const forbiddenModules = moduleIds.filter(moduleId =>
    forbiddenShellAdapterModules.some(suffix => moduleId.endsWith(suffix)),
  )
  assert(
    forbiddenModules.length === 0,
    `${mode} must not bundle Web-only platform adapters: ${forbiddenModules.join(', ')}`,
  )
  const forbiddenRuntimeModules = moduleIds.filter(moduleId =>
    forbiddenShellRuntimeModules.some(fragment => moduleId.includes(fragment)),
  )
  assert(
    forbiddenRuntimeModules.length === 0,
    `${mode} must not bundle the legacy/Today/provider browser runtime: ${forbiddenRuntimeModules.join(', ')}`,
  )
  assert(
    moduleIds.some(moduleId =>
      moduleId.endsWith('/src/platform/shell/createUnavailableShellPlatformServices.ts'),
    ),
    `${mode} must include the provider-neutral unavailable shell fallback`,
  )
  assert(
    !relativeFiles.some(file => basename(file).startsWith('createWebPlatformServices-')),
    `${mode} must not emit a createWebPlatformServices chunk`,
  )
  const forbiddenRuntimeChunks = relativeFiles.filter(file =>
    forbiddenShellChunkNames.some(name => basename(file).includes(name)),
  )
  assert(
    forbiddenRuntimeChunks.length === 0,
    `${mode} must not emit legacy/provider chunks: ${forbiddenRuntimeChunks.join(', ')}`,
  )
  assert(
    !javaScript.includes('/api/'),
    `${mode} must not contain relative provider API paths`,
  )
  const providerMarkers = forbiddenShellProviderMarkers
    .filter(({ pattern }) => pattern.test(javaScript))
    .map(({ label }) => label)
  assert(
    providerMarkers.length === 0,
    `${mode} must not contain provider-shaped fallback markers: ${providerMarkers.join(', ')}`,
  )
}

async function assertApiPathsStayBehindPlatformBoundary() {
  const files = (await collectFiles(sourceRoot))
    .filter(file => ['.ts', '.tsx', '.js', '.mjs', '.vue'].includes(extname(file)))
  const violations = []

  for (const file of files) {
    const projectPath = relative(repositoryRoot, file).replaceAll('\\', '/')
    if (projectPath === 'src/worker.ts' || projectPath.startsWith('src/platform/')) {
      continue
    }

    const source = await readFile(file, 'utf8')
    if (source.includes('/api/')) {
      violations.push(projectPath)
    }
  }

  assert(
    violations.length === 0,
    `relative /api/ paths must stay in src/platform or src/worker.ts: ${violations.join(', ')}`,
  )
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Build smoke failed: ${message}`)
  }
}
