import type { DailyArticle } from '@/features/article/types'

import type { ExpansionToken, ReadExpansionRank, ReadExpansionTerm } from './types'

const maxTerms = 10

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'for',
  'from',
  'has',
  'have',
  'her',
  'his',
  'in',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'she',
  'that',
  'the',
  'their',
  'there',
  'they',
  'this',
  'to',
  'up',
  'was',
  'were',
  'while',
  'with',
  'you',
  'your',
])

const localGlossary = new Map<string, string>([
  ['afternoon', '下午'],
  ['another', '另一个'],
  ['background', '背景'],
  ['brain', '大脑'],
  ['breathing', '呼吸'],
  ['change', '改变'],
  ['difficult', '困难的'],
  ['dreams', '梦'],
  ['exercise', '锻炼'],
  ['important', '重要的'],
  ['memory', '记忆'],
  ['moment', '片刻'],
  ['overhead', '头顶上方'],
  ['passage', '通道'],
  ['quiet', '安静的'],
  ['reset', '重置'],
  ['shape', '状态、形态'],
  ['screen', '屏幕'],
  ['sleep', '睡眠'],
])

interface Candidate {
  term: string
  normalizedTerm: string
  ipa?: string
  gloss?: string
  occurrences: number
  sentenceIds: Set<string>
  tokenIds: Set<string>
  contexts: string[]
  hasArticleGloss: boolean
}

export function extractReadExpansionTerms(article: DailyArticle): ReadExpansionTerm[] {
  const candidates = new Map<string, Candidate>()

  for (const sentence of article.sentences) {
    for (const token of sentence.tokens as ExpansionToken[]) {
      if (token.kind === 'punctuation') {
        continue
      }

      const normalizedTerm = normalizeTerm(token.text)
      if (!normalizedTerm || stopWords.has(normalizedTerm)) {
        continue
      }

      const candidate = getOrCreateCandidate(candidates, token.text, normalizedTerm, sentence.original)
      candidate.occurrences += 1
      candidate.sentenceIds.add(sentence.id)
      candidate.tokenIds.add(token.id)
      candidate.ipa ??= token.ipa

      if (token.meaning) {
        candidate.gloss ??= token.meaning
        candidate.hasArticleGloss = true
      }
    }

    for (const vocab of sentence.vocab ?? []) {
      const normalizedTerm = normalizeTerm(vocab.term)
      if (!normalizedTerm || stopWords.has(normalizedTerm)) {
        continue
      }

      const candidate = getOrCreateCandidate(candidates, vocab.term, normalizedTerm, sentence.original)
      candidate.gloss ??= vocab.meaning
      candidate.hasArticleGloss = true
      candidate.sentenceIds.add(sentence.id)
    }
  }

  return [...candidates.values()]
    .map(toReadExpansionTerm)
    .filter(term =>
      term.source !== 'frequency-rule'
      || term.occurrences > 1
      || isLikelyAboveLevel(term.normalizedTerm),
    )
    .sort(compareTerms)
    .slice(0, maxTerms)
}

export function findReadExpansionTermForToken(
  terms: ReadExpansionTerm[],
  token: ExpansionToken,
  options: { context?: string, sentenceId?: string } = {},
): ReadExpansionTerm | null {
  const normalizedTerm = normalizeTerm(token.text)
  if (!normalizedTerm) {
    return null
  }

  const matchedTerm = terms.find(term =>
    term.normalizedTerm === normalizedTerm
    || term.tokenIds.includes(token.id),
  )
  if (matchedTerm) {
    return matchedTerm
  }

  return {
    id: `term-${normalizedTerm}`,
    term: token.text,
    normalizedTerm,
    ipa: token.ipa,
    localGloss: token.meaning ?? localGlossary.get(normalizedTerm) ?? '本地抽取的关键词;建议结合原句理解。',
    rank: token.meaning || localGlossary.has(normalizedTerm) ? 'key' : 'frequent',
    occurrences: 1,
    sentenceIds: options.sentenceId ? [options.sentenceId] : [],
    context: options.context ?? token.text,
    tokenIds: [token.id],
    source: token.meaning ? 'article-glossary' : localGlossary.has(normalizedTerm) ? 'local-dictionary' : 'frequency-rule',
  }
}

function getOrCreateCandidate(
  candidates: Map<string, Candidate>,
  term: string,
  normalizedTerm: string,
  context: string,
): Candidate {
  const existing = candidates.get(normalizedTerm)
  if (existing) {
    if (!existing.contexts.includes(context)) {
      existing.contexts.push(context)
    }
    return existing
  }

  const candidate: Candidate = {
    term,
    normalizedTerm,
    occurrences: 0,
    sentenceIds: new Set(),
    tokenIds: new Set(),
    contexts: [context],
    hasArticleGloss: false,
  }
  candidates.set(normalizedTerm, candidate)
  return candidate
}

function toReadExpansionTerm(candidate: Candidate): ReadExpansionTerm {
  const localDictionaryGloss = localGlossary.get(candidate.normalizedTerm)
  const rank = getRank(candidate)
  const source = candidate.hasArticleGloss
    ? 'article-glossary'
    : localDictionaryGloss
      ? 'local-dictionary'
      : 'frequency-rule'

  return {
    id: `term-${candidate.normalizedTerm}`,
    term: candidate.term,
    normalizedTerm: candidate.normalizedTerm,
    ipa: candidate.ipa,
    localGloss: candidate.gloss
      ?? localDictionaryGloss
      ?? '本地抽取的关键词;建议结合原句理解。',
    rank,
    occurrences: candidate.occurrences,
    sentenceIds: [...candidate.sentenceIds],
    context: candidate.contexts[0] ?? candidate.term,
    tokenIds: [...candidate.tokenIds],
    source,
  }
}

function getRank(candidate: Candidate): ReadExpansionRank {
  if (isLikelyAboveLevel(candidate.normalizedTerm)) {
    return 'above-level'
  }
  if (candidate.hasArticleGloss || localGlossary.has(candidate.normalizedTerm)) {
    return 'key'
  }
  return 'frequent'
}

function compareTerms(a: ReadExpansionTerm, b: ReadExpansionTerm): number {
  const rankWeight: Record<ReadExpansionRank, number> = {
    'above-level': 0,
    key: 1,
    frequent: 2,
  }

  return rankWeight[a.rank] - rankWeight[b.rank]
    || b.occurrences - a.occurrences
    || a.term.localeCompare(b.term)
}

function isLikelyAboveLevel(term: string): boolean {
  return term.length >= 8 || /(tion|ment|ness|able|ible|ous|ive|ally|ward|overhead)$/.test(term)
}

function normalizeTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}
