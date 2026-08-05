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
import type {
  ArticleContentExtractor,
  RemoteServiceRequest,
  RemoteServicesAdapter,
} from '@/platform/contracts'

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

  it('imports Markdown files through the same canonical preview pipeline', async () => {
    const markdown = [
      `# ${readableEnglish.split(' ').slice(0, 12).join(' ')}.`,
      '',
      readableEnglish.split('. ').slice(1).join('. '),
    ].join('\n')
    const result = await importArticleFromTextFile({
      file: {
        name: 'reading-notes.md',
        size: markdown.length,
        type: 'text/markdown',
        text: async () => markdown,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.draft.source).toEqual({ kind: 'file', label: 'reading-notes.md' })
    expect(result.draft.body).not.toContain('# ')
    expect(result.draft.sentences.length).toBeGreaterThanOrEqual(2)
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

    const tooLarge = await importArticleFromTextFile({
      file: { name: 'large.txt', size: 256_001, text: async () => readableEnglish },
    })
    expect(tooLarge.ok ? null : tooLarge.code).toBe('file-too-large')
    expect(tooLarge.ok ? null : tooLarge.variant).toBe('file.tooLarge')

    const unreadable = await importArticleFromTextFile({
      file: {
        name: 'broken.txt',
        size: 42,
        text: async () => Promise.reject(new Error('invalid UTF-8')),
      },
    })
    expect(unreadable.ok ? null : unreadable.code).toBe('file-read-failed')
    expect(unreadable.ok ? null : unreadable.variant).toBe('file.encoding')

    const privateUrl = await importArticleFromUrl({ url: 'http://127.0.0.1/article' })
    expect(privateUrl.ok ? null : privateUrl.code).toBe('private-url')
    expect(privateUrl.ok ? null : privateUrl.variant).toBe('url.scheme')

    const fragments = segmentEnglishSentences('Hi. OK. Go.')
    expect(fragments.ok ? null : fragments.code).toBe('fragment-sentences')
    expect(fragments.ok ? null : fragments.variant).toBe('content.lowEnglish')
  })

  it('blocks local, private, reserved, translated, and documentation URL forms before fetch', () => {
    for (const url of [
      'http://0.1.2.3/article',
      'http://[::ffff:127.0.0.1]/article',
      'http://[::ffff:7f00:1]/article',
      'http://[::ffff:0a00:1]/article',
      'http://[::ffff:c0a8:1]/article',
      'http://[0:0:0:0:0:ffff:172.16.0.1]/article',
      'http://2130706433/article',
      'http://0x7f000001/article',
      'http://0177.0.0.1/article',
      'http://0300.0250.0.1/article',
      'http://169.254.1.2/article',
      'http://192.0.2.1/article',
      'http://192.88.99.1/article',
      'http://198.18.0.1/article',
      'http://198.51.100.1/article',
      'http://203.0.113.1/article',
      'http://224.0.0.1/article',
      'http://255.255.255.255/article',
      'http://[::1]/article',
      'http://[::7f00:1]/article',
      'http://[::ffff:0:7f00:1]/article',
      'http://[64:ff9b::7f00:1]/article',
      'http://[64:ff9b:1::1]/article',
      'http://[100::1]/article',
      'http://[2001:db8::1]/article',
      'http://[2002:7f00:1::]/article',
      'http://[3fff::1]/article',
      'http://[5f00::1]/article',
      'http://[fc00::1]/article',
      'http://[fd12::1]/article',
      'http://[fe80::1]/article',
      'http://[febf::1]/article',
      'http://[fec0::1]/article',
      'http://[ff02::1]/article',
      'http://printer.local/article',
      'http://service.lan/article',
      'http://service.internal/article',
      'http://router.home.arpa/article',
    ]) {
      const result = parseSupportedHttpUrl(url)
      expect(result).toMatchObject({
        ok: false,
        code: 'private-url',
        variant: 'url.scheme',
      })
    }

    expect(parseSupportedHttpUrl('https://[2606:4700:4700::1111]/article')).toBeInstanceOf(URL)
  })

  it('rejects embedded URL credentials and removes fragments before transport', () => {
    expect(parseSupportedHttpUrl('https://reader:secret@example.com/story')).toMatchObject({
      ok: false,
      code: 'unsupported-url',
      variant: 'url.scheme',
    })

    const parsed = parseSupportedHttpUrl('https://example.com/story#comments')
    expect(parsed).toBeInstanceOf(URL)
    expect(parsed instanceof URL ? parsed.toString() : '').toBe('https://example.com/story')
  })

  it('does not treat public hostnames that start with IPv6-looking letters as IP literals', () => {
    expect(parseSupportedHttpUrl('https://fc-example.test/article')).toBeInstanceOf(URL)
    expect(parseSupportedHttpUrl('https://fd-example.test/article')).toBeInstanceOf(URL)
  })

  it('imports URL text through the remote service boundary without retaining fake source data', async () => {
    const remote = createRemoteRecorder(() => ({
      content: `<main><h1>Imported web article</h1><p>${readableEnglish}</p></main>`,
      contentType: 'text/html; charset=utf-8',
      sourceUrl: 'https://example.com/story',
    }))
    const extractor: ArticleContentExtractor = {
      isAvailable: () => true,
      extract: async () => ({ title: 'Imported web article', text: readableEnglish }),
    }
    const result = await importArticleFromUrl({
      url: 'https://example.com/story',
      remote: remote.adapter,
      extractor,
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
    expect(result.draft.title).toBe('Imported web article')
    expect(remote.request).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'url-import',
      body: expect.objectContaining({ url: 'https://example.com/story' }),
    }))
  })

  it('routes remote Markdown through the canonical markup cleaner after extraction', async () => {
    const markdown = `# Remote reading notes\n\n${readableEnglish}`
    const remote = createRemoteRecorder(() => ({
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
      sourceUrl: 'https://example.com/notes.md',
    }))
    const extractor: ArticleContentExtractor = {
      isAvailable: () => true,
      extract: async input => ({ title: '', text: input.content }),
    }

    const result = await importArticleFromUrl({
      url: 'https://example.com/notes.md',
      remote: remote.adapter,
      extractor,
    })

    expect(result.ok).toBe(true)
    expect(result.ok ? result.draft.body : '').not.toContain('# ')
    expect(result.ok ? result.draft.body : '').toContain('Remote reading notes')
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
