import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const repositoryRoot = process.cwd()
const sourceRoot = join(repositoryRoot, 'src')
const allowedBrowserBoundaries = [
  `src${sep}legacy${sep}`,
  `src${sep}platform${sep}`,
]
const allowedFiles = new Set([`src${sep}worker.ts`])
const allowedLegacyConsumers = new Set([`src${sep}views${sep}LegacyReaderRouteView.vue`])
const sourceExtensions = new Set(['.ts', '.vue'])
const forbiddenIdentifiers = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'speechSynthesis',
  'SpeechSynthesisUtterance',
  'Audio',
  'FileReader',
])

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath)
    }
    return sourceExtensions.has(extname(entry.name)) ? [entryPath] : []
  }))
  return nested.flat()
}

function isAllowedBoundary(filePath) {
  const projectPath = relative(repositoryRoot, filePath)
  return allowedFiles.has(projectPath)
    || allowedBrowserBoundaries.some(prefix => projectPath.startsWith(prefix))
}

function isAllowedApiBoundary(filePath) {
  const projectPath = relative(repositoryRoot, filePath)
  return projectPath === `src${sep}worker.ts`
    || projectPath.startsWith(`src${sep}platform${sep}`)
}

function extractScriptSource(source, extension) {
  if (extension !== '.vue') {
    return source
  }

  return Array.from(source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
    .map(match => match[1])
    .join('\n')
}

function isPropertyName(identifier) {
  const parent = identifier.parent
  return (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
    || ((ts.isPropertyAssignment(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent))
      && parent.name === identifier)
}

function collectForbiddenIdentifiers(source, filePath) {
  const scriptSource = extractScriptSource(source, extname(filePath))
  const sourceFile = ts.createSourceFile(
    filePath,
    scriptSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const found = new Set()

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      if ((specifier.startsWith('@/legacy/') || specifier.includes('/legacy/'))
        && !allowedLegacyConsumers.has(relative(repositoryRoot, filePath))) {
        found.add(`legacy import (${specifier})`)
      }
    }

    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'globalThis' || node.expression.text === 'window')
      && (forbiddenIdentifiers.has(node.name.text) || node.name.text === 'fetch')) {
      found.add(`${node.expression.text}.${node.name.text}`)
    }

    if (ts.isIdentifier(node) && !isPropertyName(node)) {
      if (forbiddenIdentifiers.has(node.text)) {
        found.add(node.text)
      }
      if (node.text === 'fetch'
        && ts.isCallExpression(node.parent)
        && node.parent.expression === node) {
        found.add('direct fetch()')
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...found]
}

const failures = []
const files = await collectSourceFiles(sourceRoot)

for (const filePath of files) {
  const source = await readFile(filePath, 'utf8')
  const projectPath = relative(repositoryRoot, filePath)
  if (source.includes('/api/') && !isAllowedApiBoundary(filePath)) {
    failures.push(`${projectPath}: relative /api/ path outside platform/worker boundary`)
  }

  if (isAllowedBoundary(filePath)) {
    continue
  }

  for (const label of collectForbiddenIdentifiers(source, filePath)) {
    failures.push(`${projectPath}: ${label}`)
  }
}

if (failures.length > 0) {
  console.error('Platform-sensitive globals and legacy dependencies must stay behind approved boundaries.')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
}
else {
  console.log('Platform boundary check passed.')
}
