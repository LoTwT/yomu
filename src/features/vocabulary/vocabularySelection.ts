import type {
  ArticleRecord,
  ArticleSentenceRecord,
  ArticleTokenRecord,
} from '@/data/entities'
import type { RepositoryScope } from '@/data/repositories'

import { normalizeVocabularyTerm } from './normalizeVocabularyTerm'

export interface VocabularySelectionIds {
  articleId: string
  sentenceId: string
  tokenId: string
}

export interface ResolvedVocabularySelection {
  article: ArticleRecord
  sentence: ArticleSentenceRecord
  token: ArticleTokenRecord & { kind: 'word' }
  normalizedTerm: string
}

export class VocabularyArticleNotFoundError extends Error {
  constructor(readonly articleId: string) {
    super(`Article ${articleId} was not found.`)
    this.name = 'VocabularyArticleNotFoundError'
  }
}

export class VocabularySentenceNotFoundError extends Error {
  constructor(
    readonly articleId: string,
    readonly sentenceId: string,
  ) {
    super(`Sentence ${sentenceId} was not found in article ${articleId}.`)
    this.name = 'VocabularySentenceNotFoundError'
  }
}

export class VocabularyTokenNotFoundError extends Error {
  constructor(
    readonly articleId: string,
    readonly sentenceId: string,
    readonly tokenId: string,
  ) {
    super(`Token ${tokenId} was not found in sentence ${sentenceId} of article ${articleId}.`)
    this.name = 'VocabularyTokenNotFoundError'
  }
}

export class VocabularyTokenNotSaveableError extends Error {
  constructor(readonly tokenId: string) {
    super(`Token ${tokenId} is not a saveable word.`)
    this.name = 'VocabularyTokenNotSaveableError'
  }
}

export async function resolveVocabularySelection(
  scope: Pick<RepositoryScope, 'articles'>,
  selection: VocabularySelectionIds,
): Promise<ResolvedVocabularySelection> {
  const article = await scope.articles.get(selection.articleId)
  if (!article) {
    throw new VocabularyArticleNotFoundError(selection.articleId)
  }

  const sentence = article.sentences.find(candidate => candidate.id === selection.sentenceId)
  if (!sentence) {
    throw new VocabularySentenceNotFoundError(article.id, selection.sentenceId)
  }

  const token = sentence.tokens.find(candidate => candidate.id === selection.tokenId)
  if (!token) {
    throw new VocabularyTokenNotFoundError(article.id, sentence.id, selection.tokenId)
  }

  const normalizedTerm = normalizeVocabularyTerm(token.text)
  if (token.kind !== 'word' || !normalizedTerm) {
    throw new VocabularyTokenNotSaveableError(token.id)
  }

  return {
    article,
    sentence,
    token: { ...token, kind: 'word' },
    normalizedTerm,
  }
}
