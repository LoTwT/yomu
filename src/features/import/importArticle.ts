import type {
  ArticleRecord,
  ArticleSentenceRecord,
  ArticleTokenRecord,
} from '@/data/entities'
import { RemoteServiceError, type RemoteServicesAdapter } from '@/platform/contracts'
import { segmentEnglishSentences, type ImportedSentenceSegment } from './sentenceSegmenter'
import {
  createImportFailure,
  parseSupportedHttpUrl,
  validatePlainTextLength,
  validateTextFile,
  type ImportFailure,
} from './sourceGuards'
import { cleanImportedText } from './textCleaning'
import { createStableTextHash } from './textHash'

export type ImportSourceType = 'paste' | 'file' | 'url'
export type ImportedArticleSource = Omit<ArticleRecord['source'], 'kind'> & {
  kind: ImportSourceType
}

export interface ImportedArticleDraft {
  source: ImportedArticleSource
  title: string
  body: string
  contentHash: string
  sentences: ArticleSentenceRecord[]
  wordCount: number
  estimatedReadTimeMinutes: number
}

export interface ImportedArticleSuccess {
  ok: true
  draft: ImportedArticleDraft
  warnings: string[]
}

export type ImportArticleResult = ImportedArticleSuccess | ImportFailure

export interface ImportPasteOptions {
  text: string
}

export interface ImportTextFileOptions {
  file: {
    name: string
    size: number
    type?: string
    text: () => Promise<string>
  }
}

export interface ImportUrlOptions {
  url: string
  remote?: RemoteServicesAdapter
  timeoutMs?: number
}

export async function importArticleFromPaste(options: ImportPasteOptions): Promise<ImportArticleResult> {
  return importArticleFromRawText({
    rawText: options.text,
    sourceType: 'paste',
    sourceLabel: '粘贴文本',
    contentType: 'text/plain',
  })
}

export async function importArticleFromTextFile(options: ImportTextFileOptions): Promise<ImportArticleResult> {
  const fileFailure = validateTextFile(options.file)
  if (fileFailure) {
    return fileFailure
  }

  let text: string
  try {
    text = await options.file.text()
  }
  catch {
    return createImportFailure('file-read-failed', 'The file could not be read as text.', 'file.encoding')
  }

  return importArticleFromRawText({
    rawText: text,
    sourceType: 'file',
    sourceLabel: options.file.name,
    contentType: options.file.type || 'text/plain',
  })
}

export async function importArticleFromUrl(options: ImportUrlOptions): Promise<ImportArticleResult> {
  const parsedUrl = parseSupportedHttpUrl(options.url)
  if (!(parsedUrl instanceof URL)) {
    return parsedUrl
  }

  if (!options.remote) {
    return createImportFailure(
      'extract-failed',
      'URL import is unavailable on this platform.',
      'url.extractFailed',
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)

  try {
    const payload = await options.remote.request<{
      text?: unknown
      contentType?: unknown
      sourceUrl?: unknown
    }>({
      operation: 'url-import',
      body: {
        url: parsedUrl.toString(),
        timeoutMs: options.timeoutMs,
      },
      signal: controller.signal,
    })

    if (typeof payload.text !== 'string') {
      return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
    }

    const sourceUrl = typeof payload.sourceUrl === 'string'
      ? payload.sourceUrl
      : parsedUrl.toString()

    return importArticleFromRawText({
      rawText: payload.text,
      sourceType: 'url',
      sourceLabel: new URL(sourceUrl).hostname,
      url: sourceUrl,
      contentType: typeof payload.contentType === 'string' ? payload.contentType : 'text/plain',
    })
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return createImportFailure('url-timeout', 'This URL took too long to respond.', 'url.timeout')
    }
    if (error instanceof RemoteServiceError) {
      return toRemoteImportFailure(error)
    }

    return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
  }
  finally {
    clearTimeout(timeout)
  }
}

export async function reparseImportedArticleDraft(
  draft: ImportedArticleDraft,
  body: string,
): Promise<ImportArticleResult> {
  return importArticleFromRawText({
    rawText: body,
    sourceType: draft.source.kind,
    sourceLabel: draft.source.label,
    url: draft.source.url,
    contentType: 'text/plain',
    title: draft.title,
  })
}

function toRemoteImportFailure(error: RemoteServiceError): ImportFailure {
  if (error.status === 403) {
    return createImportFailure('private-url', error.message, 'url.scheme')
  }
  if (error.status === 404) {
    return createImportFailure('url-http-error', error.message, 'url.notFound')
  }
  if (error.status === 413) {
    return createImportFailure('url-too-large', error.message, 'url.extractFailed')
  }
  if (error.status === 504) {
    return createImportFailure('url-timeout', error.message, 'url.timeout')
  }

  return createImportFailure('extract-failed', error.message, 'url.extractFailed')
}

async function importArticleFromRawText(options: {
  rawText: string
  sourceType: ImportSourceType
  sourceLabel: string
  contentType?: string | null
  url?: string
  title?: string
}): Promise<ImportArticleResult> {
  const lengthFailure = validateSourceTextLength(options.rawText, options.sourceType)
  if (lengthFailure) {
    return lengthFailure
  }

  const cleanResult = cleanImportedText(options.rawText, {
    sourceKind: options.sourceType,
    contentType: options.contentType,
  })
  if (options.sourceType === 'paste' && cleanResult.removedDangerousBlocks) {
    return createImportFailure('unsafe-html', 'This pasted text contains scripts or embedded content. Please paste plain text instead.', 'paste.htmlDetected')
  }

  const cleanedLengthFailure = validateSourceTextLength(cleanResult.text, options.sourceType)
  if (cleanedLengthFailure) {
    return cleanedLengthFailure
  }

  const segmentationResult = segmentEnglishSentences(cleanResult.text)
  if (!segmentationResult.ok) {
    return segmentationResult
  }

  return {
    ok: true,
    draft: buildImportedArticleDraft({
      body: cleanResult.text,
      sourceType: options.sourceType,
      sourceLabel: options.sourceLabel,
      url: options.url,
      title: options.title,
      segments: segmentationResult.sentences,
    }),
    warnings: cleanResult.removedDangerousBlocks ? ['removed-dangerous-html-blocks'] : [],
  }
}

function buildImportedArticleDraft(options: {
  body: string
  sourceType: ImportSourceType
  sourceLabel: string
  url?: string
  title?: string
  segments: ImportedSentenceSegment[]
}): ImportedArticleDraft {
  const sentences = options.segments.map(toArticleSentence)
  const wordCount = sentences.reduce((sum, sentence) =>
    sum + sentence.tokens.filter(token => token.kind === 'word').length, 0)

  return {
    source: {
      kind: options.sourceType,
      label: options.sourceLabel,
      url: options.url,
    },
    title: truncateTitle(options.title?.trim() || extractTitle(options.body)),
    body: options.body,
    contentHash: createStableTextHash(options.body),
    sentences,
    wordCount,
    estimatedReadTimeMinutes: Math.max(1, Math.ceil(wordCount / 130)),
  }
}

function toArticleSentence(segment: ImportedSentenceSegment): ArticleSentenceRecord {
  return {
    id: segment.id,
    order: segment.order,
    original: segment.original,
    paragraphIndex: segment.paragraphIndex,
    textHash: segment.textHash,
    tokens: tokenizeImportedSentence(segment.original).map((token, index) => ({
      ...token,
      id: `${segment.id}-t${index + 1}`,
    })),
  }
}

function tokenizeImportedSentence(sentence: string): Array<Omit<ArticleTokenRecord, 'id'>> {
  return sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+(?:\.[0-9]+)?|[^\sA-Za-z0-9]/g)
    ?.map(token => ({
      text: token,
      kind: /[A-Za-z0-9]/.test(token) ? 'word' : 'punctuation',
    })) ?? []
}

function extractTitle(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length >= 4)?.trim() ?? 'Imported reading'
  const firstSentence = firstLine.split(/[.!?]/)[0]?.trim() ?? firstLine
  return truncateTitle(firstSentence || 'Imported reading')
}

function truncateTitle(title: string): string {
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title
}

function validateSourceTextLength(text: string, sourceType: ImportSourceType): ImportFailure | null {
  const failure = validatePlainTextLength(text)
  if (!failure) {
    return null
  }

  if (sourceType === 'paste') {
    const variant = failure.code === 'empty-input'
      ? 'paste.empty'
      : failure.code === 'too-short'
        ? 'paste.tooShort'
        : failure.code === 'too-long'
          ? 'paste.tooLong'
          : undefined
    return { ...failure, variant }
  }

  if (sourceType === 'file' && failure.code === 'empty-input') {
    return { ...failure, variant: 'file.empty' }
  }

  if (sourceType === 'url') {
    return { ...failure, variant: 'url.extractFailed' }
  }

  return failure
}
