import { createStableTextHash } from './textHash'
import { createImportFailure, type ImportFailure } from './sourceGuards'

export interface ImportedSentenceSegment {
  id: string
  order: number
  original: string
  paragraphIndex: number
  textHash: string
}

export type SentenceSegmentationResult =
  | { ok: true, sentences: ImportedSentenceSegment[] }
  | ImportFailure

const protectedAbbreviations = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'u.s',
  'u.k',
  'a.m',
  'p.m',
])

const maxSentenceChars = 360
const minEffectiveSentenceCount = 2

export function segmentEnglishSentences(text: string): SentenceSegmentationResult {
  if (!isMostlyEnglish(text)) {
    return createImportFailure('not-english', 'This text does not look like an English read-aloud article.', 'content.lowEnglish')
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const sentences: ImportedSentenceSegment[] = []

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphSentences = splitParagraphIntoSentences(paragraph)
    paragraphSentences.forEach((sentence, sentenceIndex) => {
      const order = sentences.length
      sentences.push({
        id: `p${paragraphIndex + 1}-s${sentenceIndex + 1}`,
        order,
        original: sentence,
        paragraphIndex,
        textHash: createStableTextHash(sentence),
      })
    })
  })

  if (sentences.length < minEffectiveSentenceCount) {
    return createImportFailure('not-enough-sentences', 'This text needs at least two readable English sentences.', 'content.lowEnglish')
  }

  if (sentences.some(sentence => sentence.original.length > maxSentenceChars)) {
    return createImportFailure('overlong-sentence', 'One or more sentences are too long for sentence-by-sentence read-aloud.', 'content.lowEnglish')
  }

  const fragmentCount = sentences.filter(sentence => countEnglishWords(sentence.original) < 3).length
  if (fragmentCount > 0 && fragmentCount / sentences.length >= 0.34) {
    return createImportFailure('fragment-sentences', 'This text has too many fragments for a sentence-by-sentence read-aloud session.', 'content.lowEnglish')
  }

  return { ok: true, sentences }
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const result: string[] = []
  let sentenceStart = 0
  let index = 0

  while (index < paragraph.length) {
    const char = paragraph[index]
    if ((char === '.' || char === '!' || char === '?') && !isProtectedTerminator(paragraph, index, char)) {
      let end = index + 1
      while (end < paragraph.length && /["'”’)\]]/.test(paragraph[end] ?? '')) {
        end += 1
      }

      const sentence = paragraph.slice(sentenceStart, end).trim()
      if (sentence) {
        result.push(sentence)
      }

      sentenceStart = end
      while (sentenceStart < paragraph.length && /\s/.test(paragraph[sentenceStart] ?? '')) {
        sentenceStart += 1
      }
      index = sentenceStart
      continue
    }

    index += 1
  }

  const remainder = paragraph.slice(sentenceStart).trim()
  if (remainder) {
    result.push(remainder)
  }

  return result
}

function isProtectedTerminator(text: string, index: number, char: string): boolean {
  if (char !== '.') {
    return false
  }

  const previous = text[index - 1] ?? ''
  const next = text[index + 1] ?? ''
  if (/\d/.test(previous) && /\d/.test(next)) {
    return true
  }

  const token = getTokenBeforePeriod(text, index)
  const normalized = token.toLowerCase().replace(/\.$/, '')
  if (protectedAbbreviations.has(normalized)) {
    return true
  }
  if (/^[A-Za-z]$/.test(token) && /^[A-Za-z]\./.test(text.slice(index + 1, index + 3))) {
    return true
  }

  return /^[A-Z]$/.test(token)
}

function getTokenBeforePeriod(text: string, index: number): string {
  let start = index - 1
  while (start >= 0 && /[A-Za-z.]/.test(text[start] ?? '')) {
    start -= 1
  }

  return text.slice(start + 1, index)
}

function isMostlyEnglish(text: string): boolean {
  const letters = Array.from(text).filter(char => /\p{Letter}/u.test(char))
  if (letters.length === 0) {
    return false
  }

  const latinLetters = letters.filter(char => /\p{Script=Latin}/u.test(char))
  return latinLetters.length / letters.length >= 0.7
}

function countEnglishWords(sentence: string): number {
  return sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0
}
