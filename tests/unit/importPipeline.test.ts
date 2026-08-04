import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import {
  importArticleFromPaste,
  importArticleFromTextFile,
  importArticleFromUrl,
} from '@/features/import/importArticle'
import { saveImportedArticle } from '@/features/import/saveImportedArticle'
import { segmentEnglishSentences } from '@/features/import/sentenceSegmenter'
import { parseSupportedHttpUrl } from '@/features/import/sourceGuards'
import type { RemoteServiceRequest, RemoteServicesAdapter } from '@/platform/contracts'

const readableEnglish = [
  'A careful reader can bring their own article into Yomu.',
  'The app keeps each sentence separate, so practice remains calm and predictable.',
  'Short passages work best because every sentence can be played and repeated.',
].join(' ')

describe('BYO import pipeline', () => {
  it('creates a canonical local preview without executable or playback state', async () => {
    const result = await importArticleFromPaste({
      text: `<article><p>${readableEnglish}</p></article>`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.draft.source).toEqual({ kind: 'paste', label: '粘贴文本' })
    expect(result.draft.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(result.draft.sentences).toHaveLength(3)
    expect(result.draft.sentences.every(sentence => !sentence.original.includes('<'))).toBe(true)
    expect(result.draft.sentences.map(sentence => sentence.paragraphIndex)).toEqual([0, 0, 0])
    expect(result.draft.sentences.every(sentence => sentence.textHash)).toBe(true)
    expect(JSON.stringify(result.draft)).not.toContain('audioRef')
    expect(JSON.stringify(result.draft)).not.toContain('cacheKey')
  })

  it('rejects dangerous pasted script blocks instead of rendering or cleaning them silently', async () => {
    const result = await importArticleFromPaste({
      text: `<p>${readableEnglish}</p><script>alert("x")</script>`,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.code).toBe('unsafe-html')
    expect(result.ok ? null : result.variant).toBe('paste.htmlDetected')
  })

  it('keeps common abbreviations, decimals, quote endings, and paragraph indexes stable', () => {
    const text = [
      'Dr. Gray moved to the U.S. in 2024. He paid 3.50 dollars for a notebook.',
      '"This is enough practice!" she said. Mr. Lee agreed, e.g. he repeated every sentence.',
    ].join('\n\n')

    const result = segmentEnglishSentences(text)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.sentences.map(sentence => sentence.original)).toEqual([
      'Dr. Gray moved to the U.S. in 2024.',
      'He paid 3.50 dollars for a notebook.',
      '"This is enough practice!"',
      'she said.',
      'Mr. Lee agreed, e.g. he repeated every sentence.',
    ])
    expect(result.sentences.map(sentence => sentence.paragraphIndex)).toEqual([0, 0, 1, 1, 1])
    expect(result.sentences.every(sentence => sentence.id && sentence.textHash)).toBe(true)
  })

  it('fails loud for unsupported files, private URLs, and short fragments', async () => {
    const pdf = await importArticleFromTextFile({
      file: { name: 'paper.pdf', size: 42, text: async () => readableEnglish },
    })
    expect(pdf.ok ? null : pdf.code).toBe('unsupported-file-type')
    expect(pdf.ok ? null : pdf.variant).toBe('file.unsupported')

    const privateUrl = await importArticleFromUrl({ url: 'http://127.0.0.1/article' })
    expect(privateUrl.ok ? null : privateUrl.code).toBe('private-url')
    expect(privateUrl.ok ? null : privateUrl.variant).toBe('url.scheme')

    const fragments = segmentEnglishSentences('Hi. OK. Go.')
    expect(fragments.ok ? null : fragments.code).toBe('fragment-sentences')
    expect(fragments.ok ? null : fragments.variant).toBe('content.lowEnglish')
  })

  it('blocks IPv4-mapped IPv6 loopback and private URL forms before fetch', () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/article',
      'http://[::ffff:7f00:1]/article',
      'http://[::ffff:0a00:1]/article',
      'http://[::ffff:c0a8:1]/article',
      'http://[0:0:0:0:0:ffff:172.16.0.1]/article',
      'http://2130706433/article',
      'http://0x7f000001/article',
      'http://0177.0.0.1/article',
      'http://0300.0250.0.1/article',
      'http://[::1]/article',
      'http://[fc00::1]/article',
      'http://[fd12::1]/article',
      'http://[fe80::1]/article',
      'http://[febf::1]/article',
    ]) {
      const result = parseSupportedHttpUrl(url)
      expect(result).toMatchObject({
        ok: false,
        code: 'private-url',
        variant: 'url.scheme',
      })
    }
  })

  it('does not treat public hostnames that start with IPv6-looking letters as IP literals', () => {
    expect(parseSupportedHttpUrl('https://fc-example.test/article')).toBeInstanceOf(URL)
    expect(parseSupportedHttpUrl('https://fd-example.test/article')).toBeInstanceOf(URL)
  })

  it('imports URL text through the remote service boundary without retaining fake source data', async () => {
    const remote = createRemoteRecorder(() => ({
      text: `<main><h1>Imported web article</h1><p>${readableEnglish}</p></main>`,
      contentType: 'text/html; charset=utf-8',
      sourceUrl: 'https://example.com/story',
    }))
    const result = await importArticleFromUrl({
      url: 'https://example.com/story',
      remote: remote.adapter,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.draft.source).toEqual({
      kind: 'url',
      label: 'example.com',
      url: 'https://example.com/story',
    })
    expect(remote.request).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'url-import',
      body: expect.objectContaining({ url: 'https://example.com/story' }),
    }))
  })

  it('atomically saves ArticleRecord plus Attempt and deduplicates by body, not title', async () => {
    const repositories = createMemoryLocalRepositories()
    const parsed = await importArticleFromPaste({ text: readableEnglish })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    const ids = ['article-uuid', 'attempt-uuid']
    const dependencies = {
      now: () => new Date('2026-08-04T10:00:00.000Z'),
      randomUUID: () => ids.shift() ?? 'unexpected-id',
    }

    const created = await saveImportedArticle(repositories, parsed.draft, dependencies)
    expect(created.kind).toBe('created')
    if (created.kind !== 'created') {
      return
    }
    expect(created.article).toMatchObject({
      id: 'article-uuid',
      level: 'unassessed',
      rights: { status: 'user-provided-unknown' },
      capabilities: {
        sentenceTranslation: 'none',
        sentenceIpa: 'none',
        tokenMeaning: 'none',
      },
    })
    expect(created.article.sentences[0]?.id).toBe('article-uuid:p1-s1')
    expect(created.article.sentences[0]?.tokens[0]?.id).toBe('article-uuid:p1-s1:t1')
    expect(created.attempt).toMatchObject({
      id: 'attempt-uuid',
      articleId: 'article-uuid',
      currentSentenceId: 'article-uuid:p1-s1',
      status: 'active',
    })

    const duplicate = await saveImportedArticle(repositories, {
      ...parsed.draft,
      title: 'A completely different title',
    })
    expect(duplicate).toMatchObject({ kind: 'duplicate', article: { id: 'article-uuid' } })
    expect(await repositories.articles.count()).toBe(1)
    expect(await repositories.attempts.count()).toBe(1)
  })

  it('rolls back a malformed save without leaving an article or attempt', async () => {
    const repositories = createMemoryLocalRepositories()
    const parsed = await importArticleFromPaste({ text: readableEnglish })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    await expect(saveImportedArticle(repositories, {
      ...parsed.draft,
      sentences: [],
    }, {
      randomUUID: () => 'malformed-id',
    })).rejects.toThrow()
    expect(await repositories.articles.count()).toBe(0)
    expect(await repositories.attempts.count()).toBe(0)
  })
})

function createRemoteRecorder(
  handler: (request: RemoteServiceRequest) => unknown | Promise<unknown>,
): { adapter: RemoteServicesAdapter, request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(handler)
  const adapter: RemoteServicesAdapter = {
    request<TResponse>(remoteRequest: RemoteServiceRequest): Promise<TResponse> {
      return Promise.resolve(request(remoteRequest)) as Promise<TResponse>
    },
  }
  return { adapter, request }
}
