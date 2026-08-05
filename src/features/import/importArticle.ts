import type {
  ArticleRecord,
  ArticleSentenceRecord,
  ArticleTokenRecord,
} from '@/data/entities'
import {
  RemoteServiceError,
  type ArticleContentExtractor,
  type RemoteServicesAdapter,
} from '@/platform/contracts'
import { getHttpMediaTypeEssence } from '../../httpMediaType'
import { segmentEnglishSentences, type ImportedSentenceSegment } from './sentenceSegmenter'
import {
  createImportFailure,
  maxUrlResponseBytes,
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
  extractor?: ArticleContentExtractor
  timeoutMs?: number
  signal?: AbortSignal
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

  if (!options.remote || !options.extractor?.isAvailable()) {
    return createImportFailure(
      'url-unavailable',
      'URL import is unavailable on this platform.',
      'url.unavailable',
    )
  }

  const workerTimeoutMs = clampUrlTimeout(options.timeoutMs)
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort()
  if (options.signal?.aborted) {
    controller.abort()
  }
  else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), workerTimeoutMs + 2_000)

  try {
    const payload = await options.remote.request<{
      content?: unknown
      contentType?: unknown
      sourceUrl?: unknown
    }>({
      operation: 'url-import',
      body: {
        url: parsedUrl.toString(),
        timeoutMs: workerTimeoutMs,
      },
      signal: controller.signal,
    })

    if (
      typeof payload.content !== 'string'
      || typeof payload.contentType !== 'string'
      || typeof payload.sourceUrl !== 'string'
    ) {
      return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
    }
    if (
      payload.content.length > maxUrlResponseBytes
      || new TextEncoder().encode(payload.content).byteLength > maxUrlResponseBytes
    ) {
      return createImportFailure('url-too-large', 'This page is too large for one read-aloud session.', 'url.tooLarge')
    }

    const sourceUrl = parseSupportedHttpUrl(payload.sourceUrl)
    if (!(sourceUrl instanceof URL)) {
      return createImportFailure('extract-failed', 'This URL returned an invalid source address.', 'url.extractFailed')
    }

    const extracted = await options.extractor.extract({
      content: payload.content,
      contentType: payload.contentType,
      sourceUrl: sourceUrl.toString(),
    })
    if (!extracted?.text.trim()) {
      return createImportFailure('extract-failed', 'No readable article body could be extracted from this URL.', 'url.extractFailed')
    }

    return importArticleFromRawText({
      rawText: extracted.text,
      sourceType: 'url',
      sourceLabel: sourceUrl.hostname,
      url: sourceUrl.toString(),
      contentType: getHttpMediaTypeEssence(payload.contentType) === 'text/markdown'
        ? 'text/markdown'
        : 'text/plain',
      title: extracted.title,
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
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

function clampUrlTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 10_000
  }
  return Math.min(Math.max(1_000, value), 15_000)
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
  if (error.code === 'unsupported-url') {
    return createImportFailure('unsupported-url', error.message, 'url.scheme')
  }
  if (error.code === 'private-url') {
    return createImportFailure('private-url', error.message, 'url.scheme')
  }
  if (error.code === 'url-timeout') {
    return createImportFailure('url-timeout', error.message, 'url.timeout')
  }
  if (error.code === 'url-too-large') {
    return createImportFailure('url-too-large', error.message, 'url.tooLarge')
  }
  if (error.code === 'unsupported-content-type') {
    return createImportFailure('unsupported-content-type', error.message, 'url.unsupportedType')
  }
  if (error.code === 'url-http-error') {
    return createImportFailure('url-http-error', error.message, error.status === 404 ? 'url.notFound' : 'url.unavailable')
  }
  if (error.code === 'url-unavailable') {
    return createImportFailure('url-unavailable', error.message, 'url.unavailable')
  }
  if (error.status === 403) {
    return createImportFailure('private-url', error.message, 'url.scheme')
  }
  if (error.status === 404) {
    return createImportFailure('url-http-error', error.message, 'url.notFound')
  }
  if (error.status === 413) {
    return createImportFailure('url-too-large', error.message, 'url.tooLarge')
  }
  if (error.status === 415) {
    return createImportFailure('unsupported-content-type', error.message, 'url.unsupportedType')
  }
  if (error.status === 504) {
    return createImportFailure('url-timeout', error.message, 'url.timeout')
  }

  return createImportFailure('url-unavailable', error.message, 'url.unavailable')
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
    if (failure.code === 'empty-input' || failure.code === 'too-short') {
      return { ...failure, variant: 'url.insufficientBody' }
    }
    if (failure.code === 'too-long') {
      return { ...failure, variant: 'url.tooLarge' }
    }
    return { ...failure, variant: 'url.extractFailed' }
  }

  return failure
}
