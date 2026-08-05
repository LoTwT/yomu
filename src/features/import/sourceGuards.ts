import { isHttpMediaType } from '../../httpMediaType'

export const maxImportedTextChars = 80_000
export const minImportedTextChars = 120
export const maxImportedFileBytes = 256_000
export const maxUrlResponseBytes = 512_000

const allowedTextFileExtensions = new Set(['.txt', '.md'])
const unsupportedDocumentExtensions = new Set(['.pdf', '.doc', '.docx', '.rtf'])
const allowedContentTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
])

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
  | 'url-unavailable'
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
  | 'url.unavailable'
  | 'url.timeout'
  | 'url.tooLarge'
  | 'url.unsupportedType'
  | 'url.insufficientBody'
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
  if (url.username || url.password) {
    return createImportFailure('unsupported-url', 'URLs containing embedded credentials cannot be imported.', 'url.scheme')
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    return createImportFailure('private-url', 'Local and private-network URLs cannot be imported.', 'url.scheme')
  }

  url.hash = ''
  return url
}

export function validateUrlResponseMetadata(response: Response): ImportFailure | null {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxUrlResponseBytes) {
    return createImportFailure('url-too-large', 'This page is too large for one read-aloud session.', 'url.tooLarge')
  }

  const contentType = response.headers.get('content-type')
  if (contentType && !isHttpMediaType(contentType, allowedContentTypes)) {
    return createImportFailure('unsupported-content-type', 'This URL does not look like a readable text or HTML page.', 'url.unsupportedType')
  }

  return null
}

export function getFileExtension(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase())
  return match?.[0] ?? ''
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === 'lan'
    || normalized.endsWith('.lan')
    || normalized === 'internal'
    || normalized.endsWith('.internal')
    || normalized === 'home.arpa'
    || normalized.endsWith('.home.arpa')
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
  const hextets = parseIpv6Hextets(hostname)
  if (!hextets) {
    return true
  }

  const [first = 0, second = 0] = hextets
  const isUnspecified = hextets.every(value => value === 0)
  const isLoopback = hextets.slice(0, 7).every(value => value === 0) && hextets[7] === 1
  const isMappedIpv4 = hextets.slice(0, 5).every(value => value === 0) && hextets[5] === 0xffff
  if (isMappedIpv4) {
    return isPrivateOrLocalIpv4(`${thirdByte(hextets[6] ?? 0)}.${fourthByte(hextets[6] ?? 0)}.${thirdByte(hextets[7] ?? 0)}.${fourthByte(hextets[7] ?? 0)}`)
  }

  return isUnspecified
    || isLoopback
    || hextets.slice(0, 6).every(value => value === 0)
    || (hextets.slice(0, 4).every(value => value === 0) && hextets[4] === 0xffff && hextets[5] === 0)
    // IANA currently assigns globally routable unicast addresses only from
    // 2000::/3. Treat every other range as non-public by default.
    || (first & 0xe000) !== 0x2000
    || (first === 0x2001 && second === 0)
    || (first === 0x2001 && second === 0x0002)
    || (first === 0x2001 && second >= 0x0010 && second <= 0x002f)
    || (first === 0x2001 && second === 0x0db8)
    || first === 0x2002
    || (first === 0x3fff && (second & 0xf000) === 0)
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }

  const [first = 0, second = 0] = octets
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 88 && octets[2] === 99)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && octets[2] === 100)
    || (first === 203 && second === 0 && octets[2] === 113)
    || first >= 224
}

function parseIpv6Hextets(hostname: string): number[] | null {
  let value = hostname.split('%')[0] ?? ''
  if (!value.includes(':')) {
    return null
  }

  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(value)?.[1]
  if (ipv4Tail) {
    const octets = ipv4Tail.split('.').map(Number)
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null
    }
    value = value.slice(0, -ipv4Tail.length)
      + `${((octets[0] ?? 0) << 8 | (octets[1] ?? 0)).toString(16)}:${((octets[2] ?? 0) << 8 | (octets[3] ?? 0)).toString(16)}`
  }

  const compressedParts = value.split('::')
  if (compressedParts.length > 2) {
    return null
  }
  const left = compressedParts[0]?.split(':').filter(Boolean) ?? []
  const right = compressedParts[1]?.split(':').filter(Boolean) ?? []
  const missing = compressedParts.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0 || (compressedParts.length === 1 && left.length !== 8)) {
    return null
  }

  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (parts.length !== 8) {
    return null
  }
  const hextets = parts.map(part => Number.parseInt(part, 16))
  if (hextets.some((part, index) => !/^[0-9a-f]{1,4}$/i.test(parts[index] ?? '') || !Number.isInteger(part))) {
    return null
  }
  return hextets
}

function thirdByte(hextet: number): number {
  return (hextet >> 8) & 0xff
}

function fourthByte(hextet: number): number {
  return hextet & 0xff
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
