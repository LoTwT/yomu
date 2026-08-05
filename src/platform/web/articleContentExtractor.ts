import { Readability } from '@mozilla/readability'

import { getHttpMediaTypeEssence } from '../../httpMediaType'
import type {
  ArticleContentExtractor,
  ExtractedArticleContent,
  RemoteArticleContent,
} from '../contracts'

const htmlContentTypes = new Set(['text/html', 'application/xhtml+xml'])
const plainContentTypes = new Set(['text/plain', 'text/markdown'])
const maxReadableElements = 2_000
const maxReadableNestingDepth = 128
const rawTextElementNames = new Set([
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
])
const voidElementNames = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const resourceElementNames = new Set([
  'applet',
  'audio',
  'base',
  'bgsound',
  'canvas',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'img',
  'image',
  'input',
  'link',
  'meta',
  'noscript',
  'object',
  'picture',
  'param',
  'portal',
  'script',
  'select',
  'source',
  'style',
  'svg',
  'textarea',
  'track',
  'video',
])
const resourceAttributes = ['background', 'data', 'ping', 'poster', 'src', 'srcdoc', 'srcset', 'xlink:href']

export class WebArticleContentExtractor implements ArticleContentExtractor {
  constructor(private readonly Parser: typeof DOMParser | null) {}

  isAvailable(): boolean {
    return this.Parser !== null
  }

  async extract(input: RemoteArticleContent): Promise<ExtractedArticleContent | null> {
    const contentType = getHttpMediaTypeEssence(input.contentType)
    if (plainContentTypes.has(contentType)) {
      return { title: '', text: input.content }
    }
    if (
      !this.Parser
      || !htmlContentTypes.has(contentType)
      || exceedsHtmlStructureBudget(input.content)
    ) {
      return null
    }

    try {
      const sourceUrl = new URL(input.sourceUrl)
      const document = new this.Parser().parseFromString(
        '<!doctype html><html><head></head><body></body></html>',
        'text/html',
      )
      const stagingTemplate = document.createElement('template')
      stagingTemplate.innerHTML = input.content
      const stagedElements = Array.from(stagingTemplate.content.querySelectorAll('*'))
      if (stagedElements.length > maxReadableElements) {
        return null
      }

      const stagedTitle = stagingTemplate.content.querySelector('title')?.textContent?.trim() ?? ''
      for (const element of stagedElements) {
        if (resourceElementNames.has(element.localName)) {
          element.remove()
          continue
        }

        element.removeAttribute('style')
        for (const attribute of resourceAttributes) {
          element.removeAttribute(attribute)
        }
      }
      document.body.replaceChildren(stagingTemplate.content)
      document.title = stagedTitle

      const base = document.createElement('base')
      base.href = sourceUrl.toString()
      document.head?.prepend(base)

      const article = new Readability(document, {
        charThreshold: 120,
        maxElemsToParse: maxReadableElements + 4,
      }).parse()
      const text = article?.textContent?.trim() ?? ''
      if (!text) {
        return null
      }

      return {
        title: article?.title?.trim() ?? '',
        text,
      }
    }
    catch {
      return null
    }
  }
}

function exceedsHtmlStructureBudget(content: string): boolean {
  const openElements: string[] = []
  let startTagCount = 0

  for (let index = 0; index < content.length - 1; index += 1) {
    if (content.charCodeAt(index) !== 0x3c) {
      continue
    }

    if (content.startsWith('<!--', index)) {
      // HTML comments can close abruptly (for example `<!-->`), so `-->` is
      // not a safe upper bound. Resuming after the first `>` may over-count
      // markup inside a valid comment, but it never hides elements the parser
      // could materialize.
      const commentBoundary = content.indexOf('>', index + 4)
      index = commentBoundary >= 0 ? commentBoundary : content.length
      continue
    }
    if (content.charCodeAt(index + 1) === 0x21 || content.charCodeAt(index + 1) === 0x3f) {
      const declarationEnd = content.indexOf('>', index + 2)
      index = declarationEnd >= 0 ? declarationEnd : content.length
      continue
    }

    const isClosingTag = content.charCodeAt(index + 1) === 0x2f
    const tagNameStart = index + (isClosingTag ? 2 : 1)
    const nextCharacter = content.charCodeAt(tagNameStart)
    const startsWithAsciiLetter = (nextCharacter >= 0x41 && nextCharacter <= 0x5a)
      || (nextCharacter >= 0x61 && nextCharacter <= 0x7a)
    if (!startsWithAsciiLetter) {
      continue
    }

    let tagNameEnd = tagNameStart + 1
    while (tagNameEnd < content.length && isHtmlTagNameCharacter(content.charCodeAt(tagNameEnd))) {
      tagNameEnd += 1
    }
    const tagName = content.slice(tagNameStart, tagNameEnd).toLowerCase()
    const tagEnd = findHtmlTagEnd(content, tagNameEnd)
    const rawTextElement = openElements.at(-1)

    if (rawTextElement && rawTextElementNames.has(rawTextElement)) {
      if (isClosingTag && tagName === rawTextElement) {
        openElements.pop()
      }
      index = tagEnd >= 0 ? tagEnd : content.length
      continue
    }

    if (isClosingTag) {
      const matchingOpenElement = openElements.lastIndexOf(tagName)
      if (matchingOpenElement >= 0) {
        openElements.length = matchingOpenElement
      }
      index = tagEnd >= 0 ? tagEnd : content.length
      continue
    }

    startTagCount += 1
    if (startTagCount > maxReadableElements) {
      return true
    }

    if (!voidElementNames.has(tagName)) {
      openElements.push(tagName)
      if (openElements.length > maxReadableNestingDepth) {
        return true
      }
    }
    index = tagEnd >= 0 ? tagEnd : content.length
  }

  return false
}

function findHtmlTagEnd(content: string, start: number): number {
  let quote = 0

  for (let index = start; index < content.length; index += 1) {
    const character = content.charCodeAt(index)
    if (quote !== 0) {
      if (character === quote) {
        quote = 0
      }
      continue
    }
    if (character === 0x22 || character === 0x27) {
      quote = character
    }
    else if (character === 0x3e) {
      return index
    }
  }

  return -1
}

function isHtmlTagNameCharacter(character: number): boolean {
  return (character >= 0x41 && character <= 0x5a)
    || (character >= 0x61 && character <= 0x7a)
    || (character >= 0x30 && character <= 0x39)
    || character === 0x2d
}
