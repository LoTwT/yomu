import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importArticleFromUrl } from '@/features/import/importArticle'
import type { RemoteServicesAdapter } from '@/platform/contracts'
import { WebArticleContentExtractor } from '@/platform/web/articleContentExtractor'

const fixtureDirectory = join(process.cwd(), 'tests/fixtures/url-import')
const extractor = new WebArticleContentExtractor(DOMParser)

const readableFixtures = [
  {
    name: 'standard-article.html',
    title: 'Standard Practice Article',
    body: 'A quiet morning routine can make focused reading feel much easier. The reader begins with one clear paragraph and listens without rushing. After each sentence, a short pause leaves room to notice unfamiliar sounds. Repeating the passage then turns small observations into steady progress.',
  },
  {
    name: 'nested-navigation.html',
    title: 'Reading Beyond the Menu',
    body: 'Useful articles often sit beside complicated menus, promotional cards, and unrelated links. A reader should receive the central explanation instead of that surrounding interface. Careful extraction keeps the original order of the meaningful paragraphs. It also gives the learner a calmer preview before the first listening session begins.',
  },
  {
    name: 'cookie-banner.html',
    title: 'A Walk Through the Harbor',
    body: 'The harbor becomes especially peaceful just after sunrise, when the water reflects the pale sky. Small fishing boats return slowly while shopkeepers prepare for the day. Visitors who walk along the eastern pier can hear ropes tapping against wooden masts. That gentle rhythm makes the busy city beyond the docks seem far away.',
  },
  {
    name: 'footer-heavy.html',
    title: 'Why Small Gardens Matter',
    body: 'A small garden can change how a neighborhood feels during every season. Even a narrow bed of herbs gives people a reason to stop, talk, and share advice. These spaces also help children observe insects and weather at close range. Daily care turns an ordinary corner into a patient lesson about growth.',
  },
  {
    name: 'semantic-main.html',
    title: 'Learning from a Local Museum',
    body: 'A local museum can explain a familiar street through objects that survived earlier generations. Maps, letters, and tools reveal how ordinary decisions shaped the present town. Reading the labels aloud encourages visitors to slow down and connect details. The same habit can make a short historical article easier to remember.',
  },
  {
    name: 'prose-with-aside.html',
    title: 'The Value of an Evening Notebook',
    body: 'Writing a few lines at the end of the day can reveal patterns that memory usually hides. The notes do not need to be polished or shared with anyone. Over several weeks, repeated concerns become easier to recognize and address. A modest notebook therefore becomes a practical tool for reflection rather than another demanding task.',
  },
  {
    name: 'blog-post.html',
    title: 'Repairing an Old Bicycle | Field Notes',
    body: 'An old bicycle rarely needs every component replaced at the same time. Cleaning the chain and checking the tires first can reveal which repairs are truly necessary. Working in a deliberate order also makes each change easier to test. By the final ride, the bicycle feels dependable because every adjustment has a clear reason.',
  },
  {
    name: 'news-story.html',
    title: 'Night Train Service Returns',
    body: 'City Desk · August 5 The regional railway restored its late evening service after a six-month trial. Officials said the new timetable responds to workers who finish after regular commuter hours. Passengers welcomed the quieter route and the additional connection to nearby towns. The railway will review ridership data before deciding whether to add weekend trains.',
  },
  {
    name: 'redirect-target.html',
    title: 'The Final Address',
    body: 'A permanent article address helps readers return to the same material later. Redirects are common when publishers reorganize sections or replace an older naming scheme. The importer records the final public address after checking every step. That source remains visible in the preview so the reader can confirm where the text came from.',
  },
] as const

describe('URL article extraction fixtures', () => {
  it.each(readableFixtures)('extracts $name to its expected title and normalized body', async (fixture) => {
    const content = await readFixture(fixture.name)
    const result = await extractor.extract({
      content,
      contentType: 'text/html; charset=utf-8',
      sourceUrl: `https://reader.example/${fixture.name}`,
    })

    expect(result?.title).toBe(fixture.title)
    expect(normalizeText(result?.text)).toBe(fixture.body)
    expect(result?.text).not.toMatch(/EXCLUDE (?:NESTED|SUBMENU|COOKIE|FOOTER|MEMBERSHIP|RELATED|BLOG|BREAKING|REDIRECT)/)
  })

  it('classifies a navigation-only fixture as insufficient body', async () => {
    const result = await importFixture('no-body.html', 'text/html; charset=utf-8')

    expect(result).toMatchObject({
      ok: false,
      code: 'too-short',
      variant: 'url.insufficientBody',
    })
  })

  it('rejects extracted fixture text above the canonical article limit', async () => {
    const template = await readFixture('overlong.html')
    const expanded = template.replace(
      /<p data-repeat="900">([\s\S]*?)<\/p>/,
      (_match, paragraph: string) => `<p>${Array.from({ length: 900 }, () => paragraph.trim()).join(' ')}</p>`,
    )
    const result = await importContent(expanded, 'text/html; charset=utf-8', 'overlong.html')

    expect(result).toMatchObject({
      ok: false,
      code: 'too-long',
      variant: 'url.tooLarge',
    })
  })

  it('never sends a non-HTML fixture into DOM extraction', async () => {
    const content = await readFixture('non-html.html')

    expect(await extractor.extract({
      content,
      contentType: 'application/pdf',
      sourceUrl: 'https://reader.example/non-html.pdf',
    })).toBeNull()
  })

  it.each([
    'text/htmlx',
    'application/json; profile=text/html',
    'application/xhtml+xml-evil',
  ])('rejects deceptive media type %s before DOM extraction', async (contentType) => {
    const content = await readFixture('standard-article.html')

    expect(await extractor.extract({
      content,
      contentType,
      sourceUrl: 'https://reader.example/deceptive',
    })).toBeNull()
  })

  it('rejects excessive element density before invoking DOMParser', async () => {
    let parserInvoked = false
    class TrackingDOMParser extends DOMParser {
      constructor() {
        super()
        parserInvoked = true
      }
    }
    const guardedExtractor = new WebArticleContentExtractor(TrackingDOMParser)

    expect(await guardedExtractor.extract({
      content: '<x></x>'.repeat(2_001),
      contentType: 'text/html',
      sourceUrl: 'https://reader.example/dense',
    })).toBeNull()
    expect(parserInvoked).toBe(false)
  })

  it('rejects excessive element nesting before invoking DOMParser', async () => {
    let parserInvoked = false
    class TrackingDOMParser extends DOMParser {
      constructor() {
        super()
        parserInvoked = true
      }
    }
    const guardedExtractor = new WebArticleContentExtractor(TrackingDOMParser)

    expect(await guardedExtractor.extract({
      content: '<x>'.repeat(129),
      contentType: 'text/html',
      sourceUrl: 'https://reader.example/deeply-nested',
    })).toBeNull()
    expect(parserInvoked).toBe(false)
  })

  it('does not let comments, attributes, or raw text hide excessive nesting', async () => {
    let parserInvoked = false
    class TrackingDOMParser extends DOMParser {
      constructor() {
        super()
        parserInvoked = true
      }
    }
    const guardedExtractor = new WebArticleContentExtractor(TrackingDOMParser)
    const adversarialLayer = '<x title="</x>"><!-- </x> --><script></x></script>'

    expect(await guardedExtractor.extract({
      content: adversarialLayer.repeat(129),
      contentType: 'text/html',
      sourceUrl: 'https://reader.example/hidden-nesting',
    })).toBeNull()
    expect(parserInvoked).toBe(false)
  })

  it('does not let an abruptly closed comment hide excessive element density', async () => {
    let parserInvoked = false
    class TrackingDOMParser extends DOMParser {
      constructor() {
        super()
        parserInvoked = true
      }
    }
    const guardedExtractor = new WebArticleContentExtractor(TrackingDOMParser)

    expect(await guardedExtractor.extract({
      content: `<!-->${'<x></x>'.repeat(2_001)}`,
      contentType: 'text/html',
      sourceUrl: 'https://reader.example/abrupt-comment',
    })).toBeNull()
    expect(parserInvoked).toBe(false)
  })
})

async function importFixture(name: string, contentType: string) {
  return importContent(await readFixture(name), contentType, name)
}

async function importContent(content: string, contentType: string, name: string) {
  const remote: RemoteServicesAdapter = {
    async request<TResponse>() {
      return {
        content,
        contentType,
        sourceUrl: `https://reader.example/${name}`,
      } as TResponse
    },
  }
  return importArticleFromUrl({
    url: `https://reader.example/${name}`,
    remote,
    extractor,
  })
}

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixtureDirectory, name), 'utf8')
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}
