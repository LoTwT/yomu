export const maxImportedTextChars = 80_000
export const minImportedTextChars = 120
export const maxImportedFileBytes = 256_000
export const maxUrlResponseBytes = 512_000

const allowedTextFileExtensions = new Set(['.txt', '.md'])
const unsupportedDocumentExtensions = new Set(['.pdf', '.doc', '.docx', '.rtf'])
const allowedContentTypes = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
]

export type ImportFailureCode =
  | 'empty-input'
  | 'too-short'
  | 'too-long'
  | 'unsafe-html'
  | 'unsupported-file-type'
  | 'file-too-large'
  | 'file-read-failed'
  | 'unsupported-url'
  | 'private-url'
  | 'url-timeout'
  | 'url-too-large'
  | 'url-http-error'
  | 'unsupported-content-type'
  | 'extract-failed'
  | 'not-english'
  | 'not-enough-sentences'
  | 'overlong-sentence'
  | 'fragment-sentences'

export type ImportErrorVariant =
  | 'paste.empty'
  | 'paste.tooShort'
  | 'paste.tooLong'
  | 'paste.htmlDetected'
  | 'url.scheme'
  | 'url.notFound'
  | 'url.timeout'
  | 'url.extractFailed'
  | 'file.unsupported'
  | 'file.empty'
  | 'file.tooLarge'
  | 'file.encoding'
  | 'content.lowEnglish'

export interface ImportFailure {
  ok: false
  code: ImportFailureCode
  variant?: ImportErrorVariant
  message: string
}

export function createImportFailure(
  code: ImportFailureCode,
  message: string,
  variant?: ImportErrorVariant,
): ImportFailure {
  return { ok: false, code, variant, message }
}

export function validatePlainTextLength(text: string): ImportFailure | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return createImportFailure('empty-input', 'Please add some English text to import.')
  }
  if (trimmed.length < minImportedTextChars) {
    return createImportFailure('too-short', 'This text is too short for a read-aloud practice article.')
  }
  if (trimmed.length > maxImportedTextChars) {
    return createImportFailure('too-long', 'This text is too long for one read-aloud session.')
  }

  return null
}

export function validateTextFile(file: { name: string, size: number, type?: string }): ImportFailure | null {
  const extension = getFileExtension(file.name)

  if (unsupportedDocumentExtensions.has(extension)) {
    return createImportFailure('unsupported-file-type', 'PDF, Word, and rich-text files are not supported yet. Please import .txt or .md.', 'file.unsupported')
  }
  if (!allowedTextFileExtensions.has(extension)) {
    return createImportFailure('unsupported-file-type', 'Only .txt and .md files are supported for now.', 'file.unsupported')
  }
  if (file.size > maxImportedFileBytes) {
    return createImportFailure('file-too-large', 'This file is too large for one read-aloud session.', 'file.tooLarge')
  }

  return null
}

export function parseSupportedHttpUrl(input: string): URL | ImportFailure {
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    return createImportFailure('unsupported-url', 'Please import from a valid http or https URL.', 'url.scheme')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return createImportFailure('unsupported-url', 'Only http and https URLs are supported.', 'url.scheme')
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    return createImportFailure('private-url', 'Local and private-network URLs cannot be imported.', 'url.scheme')
  }

  return url
}

export function validateUrlResponseMetadata(response: Response): ImportFailure | null {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxUrlResponseBytes) {
    return createImportFailure('url-too-large', 'This page is too large for one read-aloud session.', 'url.extractFailed')
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType && !allowedContentTypes.some(type => contentType.includes(type))) {
    return createImportFailure('unsupported-content-type', 'This URL does not look like a readable text or HTML page.', 'url.extractFailed')
  }

  return null
}

export function getFileExtension(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase())
  return match?.[0] ?? ''
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized === '::'
  ) {
    return true
  }

  const mappedIpv4 = extractIpv4MappedIpv6(normalized)
  if (mappedIpv4) {
    return isPrivateOrLocalIpv4(mappedIpv4)
  }

  if (normalized.includes(':')) {
    return isPrivateOrLocalIpv6(normalized)
  }

  return isPrivateOrLocalIpv4(normalized)
}

function isPrivateOrLocalIpv6(hostname: string): boolean {
  const firstHextet = Number.parseInt(hostname.split(':')[0] ?? '', 16)
  if (!Number.isFinite(firstHextet)) {
    return false
  }

  return (firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
    || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }

  const [first = 0, second = 0] = octets
  return first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
}

function extractIpv4MappedIpv6(hostname: string): string | null {
  if (!hostname.includes(':ffff:')) {
    return null
  }

  const tail = hostname.split(':ffff:').at(-1) ?? ''
  if (tail.includes('.')) {
    return tail
  }

  const parts = tail.split(':')
  if (parts.length !== 2) {
    return null
  }

  const high = Number.parseInt(parts[0] ?? '', 16)
  const low = Number.parseInt(parts[1] ?? '', 16)
  if (
    !Number.isInteger(high)
    || !Number.isInteger(low)
    || high < 0
    || high > 0xffff
    || low < 0
    || low > 0xffff
  ) {
    return null
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.')
}
