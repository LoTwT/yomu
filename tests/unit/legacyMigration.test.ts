import { describe, expect, it } from 'vitest'

import {
  buildLegacyMigrationPlan,
  migrateLegacyData,
  type MutableLegacyKeyValueSource,
} from '@/data/legacyMigration'
import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'

const importedAt = '2026-05-31T00:00:00.000Z'

describe('legacy v1 to v2 migration', () => {
  it('converts imported articles, completed sessions, and uniquely matched vocabulary', () => {
    const source = createLegacySource()
    const plan = buildLegacyMigrationPlan(source)

    expect(plan.articles).toHaveLength(1)
    expect(plan.articles[0]).toMatchObject({
      id: 'legacy-article',
      schemaVersion: 2,
      contentHash: 'legacy-content-hash',
      level: 'B1',
      source: { kind: 'paste', label: 'Pasted text' },
      rights: { status: 'user-provided-unknown' },
      capabilities: {
        sentenceTranslation: 'complete',
        sentenceIpa: 'complete',
        tokenMeaning: 'complete',
      },
    })
    expect(plan.articles[0]?.sentences[0]?.id).toBe('legacy-article:sentence-1')
    expect(plan.articles[0]?.sentences[0]?.tokens[0]?.id).toBe('legacy-article:token-1')
    expect(plan.attempts).toEqual([
      expect.objectContaining({
        articleId: 'legacy-article',
        status: 'completed',
        activeDurationSec: 125,
      }),
    ])
    expect(plan.vocabularyTerms).toEqual([
      expect.objectContaining({
        normalizedTerm: 'reader',
        displayTerm: 'reader',
        meaning: '读者',
      }),
    ])
    expect(plan.vocabularyContexts).toEqual([
      expect.objectContaining({
        articleId: 'legacy-article',
        sentenceId: 'legacy-article:sentence-1',
        sentenceText: 'A careful reader practices every day.',
      }),
    ])
    expect(plan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unrecoverable-vocabulary' }),
    ]))
  })

  it('applies once, records the version, and clears legacy keys and consent', async () => {
    const source = createLegacySource()
    const repositories = createMemoryLocalRepositories()

    const first = await migrateLegacyData(repositories, source)
    const second = await migrateLegacyData(repositories, source)

    expect(first.status).toBe('applied')
    expect(first.migrated).toMatchObject({
      articles: 1,
      attempts: 1,
      vocabularyTerms: 1,
      vocabularyContexts: 1,
    })
    expect(second.status).toBe('already-applied')
    expect(await repositories.articles.count()).toBe(1)
    expect(await repositories.vocabularyTerms.count()).toBe(1)
    expect(await repositories.vocabularyContexts.count()).toBe(1)
    expect(await repositories.migration.getVersion()).toBe(2)

    const tts = JSON.parse(source.get('yomu:tts-settings') ?? '{}')
    const ai = JSON.parse(source.get('yomu:read-expansion-settings') ?? '{}')
    expect(tts.mimo.apiKey).toBe('')
    expect(ai.ai.openai.apiKey).toBe('')
    expect(ai.ai.consentAccepted).toBe(false)
  })

  it('does not guess when the same legacy token id appears in multiple articles', () => {
    const source = createLegacySource()
    const duplicate = JSON.parse(source.get('yomu:imported-article:legacy-article') ?? '{}')
    duplicate.id = 'second-article'
    duplicate.importMetadata.articleId = 'second-article'
    source.set('yomu:imported-article:second-article', JSON.stringify(duplicate))
    source.set('yomu:imported-article:index', JSON.stringify([
      { articleId: 'legacy-article' },
      { articleId: 'second-article' },
    ]))

    const plan = buildLegacyMigrationPlan(source)
    expect(plan.vocabularyTerms).toEqual([])
    expect(plan.vocabularyContexts).toEqual([])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'yomu:saved-vocabulary:token-1',
        code: 'unrecoverable-vocabulary',
      }),
    ]))
  })

  it('isolates a damaged article while continuing with valid records', () => {
    const source = createLegacySource()
    source.set('yomu:imported-article:broken', '{not-json')
    source.set('yomu:imported-article:index', JSON.stringify([
      { articleId: 'legacy-article' },
      { articleId: 'broken' },
    ]))

    const plan = buildLegacyMigrationPlan(source)
    expect(plan.articles.map(article => article.id)).toEqual(['legacy-article'])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'yomu:imported-article:broken',
        code: 'invalid-json',
      }),
    ]))
  })

  it('counts token IPA as migrated sentence IPA capability', () => {
    const source = createLegacySource()
    const article = JSON.parse(source.get('yomu:imported-article:legacy-article') ?? '{}')
    delete article.sentences[0].annotations
    article.sentences[0].tokens[0].ipa = 'ˈriːdər'
    source.set('yomu:imported-article:legacy-article', JSON.stringify(article))

    const plan = buildLegacyMigrationPlan(source)

    expect(plan.articles[0]?.capabilities.sentenceIpa).toBe('complete')
    expect(plan.articles[0]?.sentences[0]?.tokens[0]?.ipa).toBe('ˈriːdər')
  })

  it('does not count delimiter-only IPA as migrated content', () => {
    const source = createLegacySource()
    const article = JSON.parse(source.get('yomu:imported-article:legacy-article') ?? '{}')
    article.sentences[0].annotations.ipa = ' // '
    source.set('yomu:imported-article:legacy-article', JSON.stringify(article))

    const plan = buildLegacyMigrationPlan(source)

    expect(plan.articles[0]?.capabilities.sentenceIpa).toBe('none')
  })
})

function createLegacySource(): InMemoryLegacySource {
  const article = {
    id: 'legacy-article',
    level: 'B1',
    title: 'Legacy article',
    deck: 'Migrated locally',
    estimatedReadTimeMinutes: 2,
    factSources: [],
    rights: {
      licenseNote: 'Legacy user import.',
      ttsAllowed: true,
      translationAllowed: true,
      cacheAllowed: true,
    },
    importMetadata: {
      articleId: 'legacy-article',
      textHash: 'legacy-content-hash',
      importedAt,
      sourceType: 'paste',
      sourceRef: { kind: 'paste', label: 'Pasted text' },
      title: 'Legacy article',
    },
    sentences: [{
      id: 'sentence-1',
      order: 0,
      paragraphIndex: 0,
      textHash: 'sentence-hash',
      original: 'A careful reader practices every day.',
      translation: '一位认真的读者每天练习。',
      annotations: { ipa: 'legacy ipa' },
      tokens: [{
        id: 'token-1',
        text: 'reader',
        kind: 'word',
        meaning: '读者',
      }],
    }],
  }
  return new InMemoryLegacySource({
    'yomu:imported-article:index': JSON.stringify([{ articleId: article.id }]),
    [`yomu:imported-article:${article.id}`]: JSON.stringify(article),
    [`yomu:practice-session:${article.id}`]: JSON.stringify({
      articleId: article.id,
      completedAt: '2026-06-01T00:00:00.000Z',
      durationSec: 125,
    }),
    'yomu:saved-vocabulary': JSON.stringify(['token-1']),
    'yomu:tts-settings': JSON.stringify({ mimo: { apiKey: 'mimo-secret', voice: 'Mia' } }),
    'yomu:read-expansion-settings': JSON.stringify({
      ai: {
        consentAccepted: true,
        openai: { apiKey: 'openai-secret', model: 'gpt-test' },
      },
    }),
  })
}

class InMemoryLegacySource implements MutableLegacyKeyValueSource {
  private readonly values: Map<string, string>

  constructor(values: Record<string, string>) {
    this.values = new Map(Object.entries(values))
  }

  get(key: string): string | null {
    return this.values.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.values.set(key, value)
  }

  keys(): string[] {
    return [...this.values.keys()].sort()
  }
}
