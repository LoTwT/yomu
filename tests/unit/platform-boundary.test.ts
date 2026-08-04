import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const forbiddenPlatformGlobals = /\b(?:window|document|navigator|localStorage|indexedDB|speechSynthesis)\b/

describe('platform architecture boundary', () => {
  it('keeps the platform-neutral data layer free of browser globals', async () => {
    const roots = [path.resolve('src/data')]
    const files = (await Promise.all(roots.map(walk))).flat()
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (forbiddenPlatformGlobals.test(stripCommentsAndStrings(source))) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  }))
  return files.flat().filter(file => file.endsWith('.ts'))
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '')
}
