import { describe, expect, it } from 'vitest'

import {
  deriveArticleCapabilities,
  normalizeIpa,
  sentenceHasIpa,
  sentenceHasTranslation,
} from '@/data/articleCapabilities'
import type { ArticleSentenceRecord } from '@/data/entities'

describe('article capabilities', () => {
  it('normalizes IPA delimiters without manufacturing empty IPA', () => {
    expect([undefined, '', ' ', '/', '//', ' /// '].map(normalizeIpa))
      .toEqual([null, null, null, null, null, null])
    expect(['/wɜːd', 'wɜːd/', '/wɜːd/', ' //wɜːd// '].map(normalizeIpa))
      .toEqual(['/wɜːd/', '/wɜːd/', '/wɜːd/', '/wɜːd/'])
  })

  it('derives translation coverage from non-empty sentence translations', () => {
    const complete = [
      createSentence('s1', { translation: '第一句。' }),
      createSentence('s2', { translation: '第二句。' }),
    ]
    const partial = [complete[0]!, createSentence('s2', { translation: '   ' })]

    expect(complete.every(sentenceHasTranslation)).toBe(true)
    expect(sentenceHasTranslation(partial[1]!)).toBe(false)
    expect(deriveArticleCapabilities(complete).sentenceTranslation).toBe('complete')
    expect(deriveArticleCapabilities(partial).sentenceTranslation).toBe('partial')
    expect(deriveArticleCapabilities([createSentence('s1')]).sentenceTranslation).toBe('none')
  })

  it('treats sentence IPA or IPA on a word token as sentence-level IPA coverage', () => {
    const sentenceIpa = createSentence('s1', { sentenceIpa: '/sentəns/' })
    const tokenIpa = createSentence('s2', {
      tokens: [{ id: 's2:t1', text: 'word', kind: 'word', ipa: '/wɜːd/' }],
    })
    const punctuationIpa = createSentence('s3', {
      tokens: [{ id: 's3:t1', text: '.', kind: 'punctuation', ipa: '/dot/' }],
    })

    expect(sentenceHasIpa(sentenceIpa)).toBe(true)
    expect(sentenceHasIpa(tokenIpa)).toBe(true)
    expect(sentenceHasIpa(punctuationIpa)).toBe(false)
    expect(deriveArticleCapabilities([sentenceIpa, tokenIpa]).sentenceIpa).toBe('complete')
    expect(deriveArticleCapabilities([sentenceIpa, punctuationIpa]).sentenceIpa).toBe('partial')
    expect(deriveArticleCapabilities([punctuationIpa]).sentenceIpa).toBe('none')
  })

  it('ignores delimiter-only IPA while retaining meaningful token fallback', () => {
    const delimiterOnly = createSentence('s1', { sentenceIpa: ' // ' })
    const tokenFallback = createSentence('s2', {
      sentenceIpa: '/',
      tokens: [
        { id: 's2:t1', text: 'word', kind: 'word', ipa: '/wɜːd' },
        { id: 's2:t2', text: 'empty', kind: 'word', ipa: '///' },
      ],
    })

    expect(sentenceHasIpa(delimiterOnly)).toBe(false)
    expect(sentenceHasIpa(tokenFallback)).toBe(true)
    expect(deriveArticleCapabilities([delimiterOnly]).sentenceIpa).toBe('none')
    expect(deriveArticleCapabilities([delimiterOnly, tokenFallback]).sentenceIpa).toBe('partial')
  })

  it('derives meaning coverage across word tokens and ignores punctuation', () => {
    const first = createSentence('s1', {
      tokens: [
        { id: 's1:t1', text: 'first', kind: 'word', meaning: '第一' },
        { id: 's1:t2', text: 'second', kind: 'word' },
        { id: 's1:t3', text: '.', kind: 'punctuation', meaning: '句号' },
      ],
    })
    const second = createSentence('s2', {
      tokens: [{ id: 's2:t1', text: 'third', kind: 'word', meaning: '第三' }],
    })

    expect(deriveArticleCapabilities([first, second]).tokenMeaning).toBe('partial')
    first.tokens[1]!.meaning = '第二'
    expect(deriveArticleCapabilities([first, second]).tokenMeaning).toBe('complete')
    first.tokens[0]!.meaning = ' '
    first.tokens[1]!.meaning = undefined
    second.tokens[0]!.meaning = undefined
    expect(deriveArticleCapabilities([first, second]).tokenMeaning).toBe('none')
    expect(deriveArticleCapabilities([])).toEqual({
      sentenceTranslation: 'none',
      sentenceIpa: 'none',
      tokenMeaning: 'none',
    })
  })
})

function createSentence(
  id: string,
  overrides: Partial<ArticleSentenceRecord> = {},
): ArticleSentenceRecord {
  return {
    id,
    order: Number(id.replace(/\D/g, '')) || 0,
    paragraphIndex: 0,
    textHash: `${id}-hash`,
    original: `Sentence ${id}.`,
    tokens: [],
    ...overrides,
  }
}
