import { getHttpMediaTypeEssence } from '../../httpMediaType'

const blockTagPattern = /<\/?(article|section|main|header|footer|aside|nav|div|p|br|h[1-6]|ul|ol|li|blockquote|pre|tr|td|th)\b[^>]*>/gi
const dangerousBlockPattern = /<(script|style|noscript|iframe|object|embed|svg|canvas)\b[\s\S]*?<\/\1>/gi
const htmlTagPattern = /<[^>]+>/g

export interface CleanImportedTextOptions {
  sourceKind: 'paste' | 'file' | 'url'
  contentType?: string | null
}

export interface CleanImportedTextResult {
  text: string
  hadHtml: boolean
  removedDangerousBlocks: boolean
}

export function cleanImportedText(
  input: string,
  options: CleanImportedTextOptions,
): CleanImportedTextResult {
  const withoutBom = input.replace(/^\uFEFF/, '')
  const hadHtml = looksLikeHtml(withoutBom, options.contentType)
  const dangerousBlocks = withoutBom.match(dangerousBlockPattern)
  const removedDangerousBlocks = Boolean(dangerousBlocks?.length)

  const text = hadHtml
    ? normalizePlainText(stripHtmlToText(withoutBom))
    : normalizePlainText(stripMarkdownNoise(withoutBom))

  return {
    text,
    hadHtml,
    removedDangerousBlocks,
  }
}

export function looksLikeHtml(input: string, contentType?: string | null): boolean {
  const mediaType = getHttpMediaTypeEssence(contentType)
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
    return true
  }

  return /<\/?[a-z][\s\S]*>/i.test(input)
}

function stripHtmlToText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(dangerousBlockPattern, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(blockTagPattern, '\n')
      .replace(htmlTagPattern, ' '),
  )
}

function stripMarkdownNoise(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '- ')
    .replace(/^\s{0,3}>\s?/gm, '')
}

function normalizePlainText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    apos: '\'',
  }

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16)
      return decodeCodePoint(codePoint, entity)
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10)
      return decodeCodePoint(codePoint, entity)
    }

    return namedEntities[lower] ?? `&${entity};`
  })
}

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return `&${entity};`
  }

  return String.fromCodePoint(codePoint)
}
