import { describe, expect, it, vi } from 'vitest'

import { loadCachedArticlePackage, saveCachedArticlePackage } from '@/features/article/articlePackageLoader'
import { importArticleFromPaste, importArticleFromTextFile, importArticleFromUrl } from '@/features/import/importArticle'
import { saveImportedArticle, loadImportedArticle, loadImportedArticleSummaries } from '@/features/import/importedArticleStorage'
import { segmentEnglishSentences } from '@/features/import/sentenceSegmenter'
import { parseSupportedHttpUrl } from '@/features/import/sourceGuards'

const readableEnglish = [
  'A careful reader can bring their own article into Yomu.',
  'The app keeps each sentence separate, so practice remains calm and predictable.',
  'Short passages work best because every sentence can be played and repeated.',
].join(' ')

describe('BYO import pipeline', () => {
  it('imports pasted text with stable metadata and non-executable sentence content', async () => {
    const result = await importArticleFromPaste({
      text: `<article><p>${readableEnglish}</p></article>`,
      now: new Date('2026-05-31T00:00:00.000Z'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.metadata.sourceType).toBe('paste')
    expect(result.metadata.sourceRef.url).toBeUndefined()
    expect(result.article.rights.sourceType).toBe('user-import')
    expect(result.article.importMetadata?.textHash).toMatch(/^[0-9a-f]{16}$/)
    expect(result.article.sentences).toHaveLength(3)
    expect(result.article.sentences.every(sentence => !sentence.original.includes('<'))).toBe(true)
    expect(result.article.sentences.map(sentence => sentence.paragraphIndex)).toEqual([0, 0, 0])
    expect(result.article.sentences.every(sentence => sentence.textHash && sentence.audio?.cacheKey)).toBe(true)
    expect(result.article.sentences.every(sentence => !sentence.audio?.cacheKey.includes('careful'))).toBe(true)
    expect(result.article.sentences.every(sentence => sentence.audioRef.url.startsWith('missing://tts-consent-required/'))).toBe(true)
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

  it('imports URL text through an allowlisted response without retaining fake source data', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(`<main><h1>Imported web article</h1><p>${readableEnglish}</p></main>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    const result = await importArticleFromUrl({
      url: 'https://example.com/story',
      fetchImpl,
      now: new Date('2026-05-31T00:00:00.000Z'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.metadata.sourceRef.url).toBe('https://example.com/story')
    expect(result.article.factSources).toEqual([{ title: 'example.com', url: 'https://example.com/story' }])
  })

  it('stores imported articles in a separate local library index', async () => {
    window.localStorage.clear()
    const result = await importArticleFromPaste({ text: readableEnglish })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    saveImportedArticle(window.localStorage, result.article)

    expect(loadImportedArticleSummaries(window.localStorage)).toHaveLength(1)
    expect(loadImportedArticle(window.localStorage, result.article.id)?.id).toBe(result.article.id)

    saveCachedArticlePackage(window.localStorage, result.article)
    expect(loadCachedArticlePackage(window.localStorage)?.id).toBe(result.article.id)
  })
})
