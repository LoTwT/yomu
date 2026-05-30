import type { ArticleSentence, ArticleToken, DailyArticle, ImportedArticleMetadata } from '@/features/article/types'
import { createTtsCacheKey } from '@/features/tts/cacheKey'
import { defaultMimoTtsFormat, defaultMimoTtsModel, defaultMimoTtsVoice } from '@/features/tts/mimoPayload'

import { segmentEnglishSentences, type ImportedSentenceSegment } from './sentenceSegmenter'
import {
  createImportFailure,
  maxImportedTextChars,
  maxUrlResponseBytes,
  parseSupportedHttpUrl,
  validatePlainTextLength,
  validateTextFile,
  validateUrlResponseMetadata,
  type ImportFailure,
} from './sourceGuards'
import { cleanImportedText } from './textCleaning'
import { createStableTextHash } from './textHash'

export type ImportSourceType = 'paste' | 'file' | 'url'

export interface ImportedArticleSuccess {
  ok: true
  article: DailyArticle
  metadata: ImportedArticleMetadata
  warnings: string[]
}

export type ImportArticleResult = ImportedArticleSuccess | ImportFailure

export interface ImportPasteOptions {
  text: string
  now?: Date
}

export interface ImportTextFileOptions {
  file: {
    name: string
    size: number
    type?: string
    text: () => Promise<string>
  }
  now?: Date
}

export interface ImportUrlOptions {
  url: string
  fetchImpl?: typeof fetch
  importEndpoint?: string
  now?: Date
  timeoutMs?: number
}

export async function importArticleFromPaste(options: ImportPasteOptions): Promise<ImportArticleResult> {
  return importArticleFromRawText({
    rawText: options.text,
    sourceType: 'paste',
    sourceLabel: 'Pasted text',
    contentType: 'text/plain',
    now: options.now,
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
    fileName: options.file.name,
    contentType: options.file.type || 'text/plain',
    now: options.now,
  })
}

export async function importArticleFromUrl(options: ImportUrlOptions): Promise<ImportArticleResult> {
  if (!options.fetchImpl) {
    return importArticleFromUrlEndpoint(options)
  }

  const parsedUrl = parseSupportedHttpUrl(options.url)
  if (!(parsedUrl instanceof URL)) {
    return parsedUrl
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(parsedUrl, {
      headers: { accept: 'text/html,text/plain,text/markdown,application/xhtml+xml;q=0.9,*/*;q=0.1' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return createImportFailure(
        response.status === 404 ? 'url-http-error' : 'url-http-error',
        `This URL returned HTTP ${response.status}.`,
        response.status === 404 ? 'url.notFound' : 'url.extractFailed',
      )
    }

    const metadataFailure = validateUrlResponseMetadata(response)
    if (metadataFailure) {
      return metadataFailure
    }

    const textResult = await readLimitedResponseText(response)
    if (typeof textResult !== 'string') {
      return textResult
    }

    return importArticleFromRawText({
      rawText: textResult,
      sourceType: 'url',
      sourceLabel: parsedUrl.toString(),
      url: parsedUrl.toString(),
      contentType: response.headers.get('content-type'),
      now: options.now,
    })
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return createImportFailure('url-timeout', 'This URL took too long to respond.', 'url.timeout')
    }

    return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
  }
  finally {
    clearTimeout(timeout)
  }
}

async function importArticleFromUrlEndpoint(options: ImportUrlOptions): Promise<ImportArticleResult> {
  const parsedUrl = parseSupportedHttpUrl(options.url)
  if (!(parsedUrl instanceof URL)) {
    return parsedUrl
  }

  const fetchImpl = fetch
  const response = await fetchImpl(options.importEndpoint ?? '/api/import/url', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: parsedUrl.toString(), timeoutMs: options.timeoutMs }),
  })

  if (!response.ok) {
    const failure = await response.json().catch(() => null) as Partial<ImportFailure> | null
    return createImportFailure(
      failure?.code ?? 'extract-failed',
      failure?.message ?? 'This URL could not be imported as readable text.',
      failure?.variant,
    )
  }

  const payload = await response.json() as { text?: unknown, contentType?: unknown, sourceUrl?: unknown }
  if (typeof payload.text !== 'string') {
    return createImportFailure('extract-failed', 'This URL could not be imported as readable text.', 'url.extractFailed')
  }

  return importArticleFromRawText({
    rawText: payload.text,
    sourceType: 'url',
    sourceLabel: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : parsedUrl.toString(),
    url: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : parsedUrl.toString(),
    contentType: typeof payload.contentType === 'string' ? payload.contentType : 'text/plain',
    now: options.now,
  })
}

async function importArticleFromRawText(options: {
  rawText: string
  sourceType: ImportSourceType
  sourceLabel: string
  contentType?: string | null
  fileName?: string
  url?: string
  now?: Date
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

  const now = options.now ?? new Date()
  const textHash = createStableTextHash(cleanResult.text)
  const articleId = `import-${options.sourceType}-${textHash.slice(0, 12)}`
  const title = extractTitle(cleanResult.text)
  const metadata: ImportedArticleMetadata = {
    articleId,
    textHash,
    importedAt: now.toISOString(),
    sourceType: options.sourceType,
    sourceRef: {
      kind: options.sourceType,
      label: options.sourceType === 'url' ? new URL(options.url ?? options.sourceLabel).hostname : options.sourceLabel,
      url: options.url,
      fileName: options.fileName,
    },
    title,
  }

  return {
    ok: true,
    article: buildImportedArticle(metadata, segmentationResult.sentences),
    metadata,
    warnings: cleanResult.removedDangerousBlocks ? ['removed-dangerous-html-blocks'] : [],
  }
}

function buildImportedArticle(
  metadata: ImportedArticleMetadata,
  segments: ImportedSentenceSegment[],
): DailyArticle {
  const wordCount = segments.reduce((sum, segment) => sum + tokenizeImportedSentence(segment.original).filter(token => token.kind === 'word').length, 0)

  return {
    id: metadata.articleId,
    contentVersion: `import-${metadata.importedAt.slice(0, 10)}`,
    language: 'en',
    level: 'B1',
    topic: 'knowledge',
    title: metadata.title,
    deck: `${segments.length} sentences imported for sentence-by-sentence read-aloud practice.`,
    estimatedReadTimeMinutes: Math.max(1, Math.ceil(wordCount / 130)),
    factSources: metadata.sourceRef.url
      ? [{ title: metadata.sourceRef.label, url: metadata.sourceRef.url }]
      : [],
    rights: {
      sourceType: 'user-import',
      rightsStatus: 'owned',
      licenseNote: 'User-imported text. The user is responsible for rights and permission to process it.',
      ttsAllowed: true,
      translationAllowed: false,
      cacheAllowed: true,
    },
    model: {
      provider: 'user-import',
      name: 'byo-import-pipeline',
      version: 'm1',
      promptHash: 'none',
    },
    qaStatus: 'approved',
    importMetadata: metadata,
    sentences: segments.map(toArticleSentence),
  }
}

function toArticleSentence(segment: ImportedSentenceSegment): ArticleSentence {
  const audioCacheKey = createTtsCacheKey({
    provider: 'mimo',
    model: defaultMimoTtsModel,
    voice: defaultMimoTtsVoice,
    format: defaultMimoTtsFormat,
    textHash: segment.textHash,
  })

  return {
    id: segment.id,
    order: segment.order,
    original: segment.original,
    paragraphIndex: segment.paragraphIndex,
    textHash: segment.textHash,
    annotations: {},
    bilingual: {},
    translation: '',
    tokens: tokenizeImportedSentence(segment.original).map((token, index) => ({
      ...token,
      id: `${segment.id}-t${index + 1}`,
    })),
    audioRef: {
      id: `tts-${segment.textHash}`,
      url: `missing://tts-consent-required/${segment.textHash}`,
      durationMs: estimateSentenceDurationMs(segment.original),
    },
    audio: {
      cacheKey: audioCacheKey,
      status: 'idle',
    },
  }
}

function tokenizeImportedSentence(sentence: string): Array<Omit<ArticleToken, 'id'>> {
  return sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+(?:\.[0-9]+)?|[^\sA-Za-z0-9]/g)
    ?.map(token => ({
      text: token,
      kind: /[A-Za-z0-9]/.test(token) ? 'word' : 'punctuation',
    })) ?? []
}

function estimateSentenceDurationMs(sentence: string): number {
  const words = sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 1
  return Math.max(900, Math.round((words / 155) * 60_000))
}

function extractTitle(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length >= 4)?.trim() ?? 'Imported reading'
  const firstSentence = firstLine.split(/[.!?]/)[0]?.trim() ?? firstLine
  return truncateTitle(firstSentence || 'Imported reading')
}

function truncateTitle(title: string): string {
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title
}

async function readLimitedResponseText(response: Response): Promise<string | ImportFailure> {
  const text = await response.text()
  if (text.length > maxUrlResponseBytes || text.length > maxImportedTextChars) {
    return createImportFailure('url-too-large', 'This page is too large for one read-aloud session.', 'url.extractFailed')
  }

  return text
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
