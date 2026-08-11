import type {
  ArticleRecord,
  VocabularyContext,
  VocabularyTerm,
} from '@/data/entities'
import type { LocalRepositories } from '@/data/repositories'

import {
  resolveVocabularySelection,
  type VocabularySelectionIds,
} from './vocabularySelection'

export interface VocabularyArticleReference {
  readonly id: string
  readonly title: string
  readonly source: ArticleRecord['source']
}

export interface VocabularyContextEntry {
  readonly context: VocabularyContext
  readonly article: VocabularyArticleReference
}

export interface VocabularyEntry {
  readonly term: VocabularyTerm
  readonly contexts: readonly VocabularyContextEntry[]
  readonly unavailableContextCount: number
}

export interface VocabularySnapshot {
  readonly entries: readonly VocabularyEntry[]
  readonly ignoredContextCount: number
}

export interface FoundVocabularyContext {
  readonly term: VocabularyTerm
  readonly context: VocabularyContext
}

export async function findVocabularyContext(
  repositories: LocalRepositories,
  selection: VocabularySelectionIds,
): Promise<FoundVocabularyContext | null> {
  return repositories.transaction(
    ['articles', 'vocabularyTerms', 'vocabularyContexts'],
    'readonly',
    async (scope) => {
      const resolved = await resolveVocabularySelection(scope, selection)
      const term = await scope.vocabularyTerms.getByNormalizedTerm(resolved.normalizedTerm)
      if (!term) {
        return null
      }
      const context = (await scope.vocabularyContexts.listByTerm(term.id)).find(candidate =>
        candidate.articleId === resolved.article.id
        && candidate.sentenceId === resolved.sentence.id)
      return context ? { term, context } : null
    },
  )
}

export async function listVocabulary(
  repositories: LocalRepositories,
): Promise<VocabularySnapshot> {
  return repositories.transaction(
    ['articles', 'vocabularyTerms', 'vocabularyContexts'],
    'readonly',
    async (scope) => {
      const [terms, contexts] = await Promise.all([
        scope.vocabularyTerms.list(),
        scope.vocabularyContexts.list(),
      ])
      const contextsByTermId = new Map<string, VocabularyContext[]>()
      const termIds = new Set(terms.map(term => term.id))
      let ignoredContextCount = 0

      for (const context of contexts) {
        if (!termIds.has(context.termId)) {
          ignoredContextCount += 1
          continue
        }
        const values = contextsByTermId.get(context.termId) ?? []
        values.push(context)
        contextsByTermId.set(context.termId, values)
      }

      const referencedArticleIds = new Set(
        [...contextsByTermId.values()].flatMap(termContexts =>
          termContexts.map(context => context.articleId)),
      )
      const referencedArticles = await Promise.all(
        [...referencedArticleIds].map(articleId => scope.articles.get(articleId)),
      )
      const articlesById = new Map(
        referencedArticles.flatMap(article => article ? [[article.id, article] as const] : []),
      )

      const entries = terms.map((term): VocabularyEntry => {
        let unavailableStoredContextCount = 0
        const availableContexts = (contextsByTermId.get(term.id) ?? [])
          .flatMap((context): VocabularyContextEntry[] => {
            const article = articlesById.get(context.articleId)
            const sentenceAvailable = article?.sentences.some(sentence =>
              sentence.id === context.sentenceId) ?? false
            if (!article || !sentenceAvailable) {
              unavailableStoredContextCount += 1
              ignoredContextCount += 1
              return []
            }
            return [{
              context,
              article: {
                id: article.id,
                title: article.title,
                source: article.source,
              },
            }]
          })
          .sort(compareContextsNewestFirst)

        return {
          term,
          contexts: availableContexts,
          unavailableContextCount: term.orphanedContextCount
            + unavailableStoredContextCount,
        }
      }).sort(compareTermsNewestFirst)

      return { entries, ignoredContextCount }
    },
  )
}

function compareTermsNewestFirst(left: VocabularyEntry, right: VocabularyEntry): number {
  return right.term.updatedAt.localeCompare(left.term.updatedAt)
    || right.term.savedAt.localeCompare(left.term.savedAt)
    || left.term.normalizedTerm.localeCompare(right.term.normalizedTerm, 'en-US')
    || left.term.id.localeCompare(right.term.id)
}

function compareContextsNewestFirst(
  left: VocabularyContextEntry,
  right: VocabularyContextEntry,
): number {
  return right.context.savedAt.localeCompare(left.context.savedAt)
    || left.context.id.localeCompare(right.context.id)
}
