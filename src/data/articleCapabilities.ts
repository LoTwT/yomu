import type {
  ArticleRecord,
  ArticleSentenceRecord,
  CapabilityCoverage,
} from './entities'

export function normalizeIpa(value: string | undefined): string | null {
  const transcription = value
    ?.trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  return transcription ? `/${transcription}/` : null
}

export function sentenceHasTranslation(sentence: ArticleSentenceRecord): boolean {
  return hasText(sentence.translation)
}

export function sentenceHasIpa(sentence: ArticleSentenceRecord): boolean {
  return normalizeIpa(sentence.sentenceIpa) !== null
    || sentence.tokens.some(token =>
      token.kind === 'word' && normalizeIpa(token.ipa) !== null)
}

export function deriveArticleCapabilities(
  sentences: readonly ArticleSentenceRecord[],
): ArticleRecord['capabilities'] {
  const wordTokens = sentences.flatMap(sentence =>
    sentence.tokens.filter(token => token.kind === 'word'))

  return {
    sentenceTranslation: coverage(sentences, sentenceHasTranslation),
    sentenceIpa: coverage(sentences, sentenceHasIpa),
    tokenMeaning: coverage(wordTokens, token => hasText(token.meaning)),
  }
}

export function reconcileArticleCapabilities(article: ArticleRecord): ArticleRecord {
  const capabilities = deriveArticleCapabilities(article.sentences)
  if (capabilities.sentenceTranslation === article.capabilities.sentenceTranslation
    && capabilities.sentenceIpa === article.capabilities.sentenceIpa
    && capabilities.tokenMeaning === article.capabilities.tokenMeaning) {
    return article
  }
  return { ...article, capabilities }
}

function coverage<T>(values: readonly T[], present: (value: T) => boolean): CapabilityCoverage {
  const presentCount = values.reduce(
    (count, value) => count + (present(value) ? 1 : 0),
    0,
  )
  if (presentCount === 0) {
    return 'none'
  }
  return presentCount === values.length ? 'complete' : 'partial'
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim())
}
