import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import { createFakePlatformServices } from '@/platform/fake/createFakePlatformServices'
import { createWebPlatformServices } from '@/platform/web/createWebPlatformServices'

const articleId = 'article-to-delete'
const articleKey = `yomu:imported-article:${articleId}`
const indexKey = 'yomu:imported-article:index'

afterEach(() => {
  window.localStorage.clear()
})

describe('legacy imported content adapter', () => {
  it('wires a deterministic fake that records cleanup requests', async () => {
    const harness = createFakePlatformServices()

    await harness.services.legacyImportedContent.deleteArticle(articleId)
    await harness.services.legacyImportedContent.deleteArticle('another-article')

    expect(harness.legacyImportedContent.deletedArticleIds).toEqual([
      articleId,
      'another-article',
    ])
  })

  it('removes only matching legacy article, index, and parsed practice records', async () => {
    const storage = window.localStorage
    const malformedPractice = '{not-json'
    storage.setItem(articleKey, JSON.stringify({ id: articleId, text: 'private text' }))
    storage.setItem('yomu:imported-article:keep', JSON.stringify({ id: 'keep' }))
    storage.setItem(indexKey, JSON.stringify([
      { articleId, title: 'First duplicate' },
      'malformed-item',
      { articleId: 'keep', title: 'Keep' },
      { articleId, title: 'Second duplicate' },
      null,
      { articleId: 42 },
    ]))
    storage.setItem(`yomu:practice-session:${articleId}`, JSON.stringify({ articleId }))
    storage.setItem('yomu:practice-session:alias', JSON.stringify({ articleId, completedAt: 'later' }))
    storage.setItem('yomu:practice-session:keep', JSON.stringify({ articleId: 'keep' }))
    storage.setItem('yomu:practice-session:malformed', malformedPractice)
    storage.setItem('unrelated', 'keep')
    const services = await createWebServices(storage)

    await services.legacyImportedContent.deleteArticle(articleId)

    expect(storage.getItem(articleKey)).toBeNull()
    expect(storage.getItem('yomu:imported-article:keep')).not.toBeNull()
    expect(JSON.parse(storage.getItem(indexKey) ?? 'null')).toEqual([
      'malformed-item',
      { articleId: 'keep', title: 'Keep' },
      null,
      { articleId: 42 },
    ])
    expect(storage.getItem(`yomu:practice-session:${articleId}`)).toBeNull()
    expect(storage.getItem('yomu:practice-session:alias')).toBeNull()
    expect(storage.getItem('yomu:practice-session:keep')).not.toBeNull()
    expect(storage.getItem('yomu:practice-session:malformed')).toBe(malformedPractice)
    expect(storage.getItem('unrelated')).toBe('keep')

    const afterFirstDelete = snapshotStorage(storage)
    await services.legacyImportedContent.deleteArticle(articleId)
    expect(snapshotStorage(storage)).toEqual(afterFirstDelete)
  })

  it('clears a malformed legacy index and exact practice record without guessing aliases', async () => {
    const storage = window.localStorage
    const malformedIndex = '[{"articleId":"article-to-delete"}'
    storage.setItem(articleKey, 'legacy article')
    storage.setItem(indexKey, malformedIndex)
    storage.setItem(`yomu:practice-session:${articleId}`, '{"articleId":"article-to-delete"')
    storage.setItem('yomu:practice-session:malformed', '{broken')
    const services = await createWebServices(storage)

    await services.legacyImportedContent.deleteArticle(articleId)

    expect(storage.getItem(articleKey)).toBeNull()
    expect(storage.getItem(indexKey)).toBeNull()
    expect(storage.getItem(`yomu:practice-session:${articleId}`)).toBeNull()
    expect(storage.getItem('yomu:practice-session:malformed')).toBe('{broken')
  })

  it('degrades to a no-op when browser storage is missing or unavailable', async () => {
    const missingStorage = await createWebServices(null)
    await expect(missingStorage.legacyImportedContent.deleteArticle(articleId)).resolves.toBeUndefined()

    const unavailableStorage = new FaultInjectingStorage(window.localStorage, () => true)
    const unavailable = await createWebServices(unavailableStorage)
    await expect(unavailable.legacyImportedContent.deleteArticle(articleId)).resolves.toBeUndefined()
  })

  it.each([
    {
      label: 'article removal',
      shouldFail: (operation: StorageOperation, key: string) =>
        operation === 'remove' && key === articleKey,
    },
    {
      label: 'index rewrite',
      shouldFail: (operation: StorageOperation, key: string) =>
        operation === 'set' && key === indexKey,
    },
  ])('rejects actual storage failures during $label', async ({ shouldFail }) => {
    const storage = window.localStorage
    storage.setItem(articleKey, 'legacy article')
    storage.setItem(indexKey, JSON.stringify([{ articleId }]))
    const services = await createWebServices(new FaultInjectingStorage(storage, shouldFail))

    await expect(services.legacyImportedContent.deleteArticle(articleId))
      .rejects.toThrow('Injected storage failure')
  })
})

async function createWebServices(storage: Storage | null) {
  return (await createWebPlatformServices({
    repositories: createMemoryLocalRepositories(),
    indexedDbFactory: null,
    localStorage: storage,
    migrateLegacy: false,
    fetchImpl: vi.fn(async () => new Response('{}')),
  })).services
}

function snapshotStorage(storage: Storage): Record<string, string> {
  const entries: Array<[string, string]> = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null) {
      entries.push([key, storage.getItem(key) ?? ''])
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

type StorageOperation = 'set' | 'remove'

class FaultInjectingStorage implements Storage {
  constructor(
    private readonly delegate: Storage,
    private readonly shouldFail: (operation: StorageOperation, key: string) => boolean,
  ) {}

  get length(): number {
    return this.delegate.length
  }

  clear(): void {
    this.delegate.clear()
  }

  getItem(key: string): string | null {
    return this.delegate.getItem(key)
  }

  key(index: number): string | null {
    return this.delegate.key(index)
  }

  removeItem(key: string): void {
    if (this.shouldFail('remove', key)) {
      throw new Error('Injected storage failure')
    }
    this.delegate.removeItem(key)
  }

  setItem(key: string, value: string): void {
    if (this.shouldFail('set', key)) {
      throw new Error('Injected storage failure')
    }
    this.delegate.setItem(key, value)
  }
}
