import type { VocabularyContext, VocabularyTerm } from '@/data/entities'
import type { LocalRepositories } from '@/data/repositories'

import {
  resolveVocabularySelection,
  VocabularyArticleNotFoundError,
  VocabularySentenceNotFoundError,
  VocabularyTokenNotFoundError,
  VocabularyTokenNotSaveableError,
  type VocabularySelectionIds,
} from './vocabularySelection'

export {
  VocabularyArticleNotFoundError,
  VocabularySentenceNotFoundError,
  VocabularyTokenNotFoundError,
  VocabularyTokenNotSaveableError,
}
export type { VocabularySelectionIds }

export interface VocabularyCommandDependencies {
  now?: () => Date
  randomUUID?: () => string
}

export type SaveVocabularyContextResult = {
  kind: 'created' | 'existing'
  term: VocabularyTerm
  context: VocabularyContext
}

export type RemoveVocabularyContextResult =
  | {
      kind: 'removed'
      context: VocabularyContext
      term: VocabularyTerm | null
      termDeleted: boolean
    }
  | { kind: 'not-found' }

export type DeleteVocabularyTermResult =
  | {
      kind: 'deleted'
      term: VocabularyTerm
      deletedContexts: VocabularyContext[]
    }
  | { kind: 'not-found' }

export async function saveVocabularyContext(
  repositories: LocalRepositories,
  selection: VocabularySelectionIds,
  dependencies: VocabularyCommandDependencies = {},
): Promise<SaveVocabularyContextResult> {
  const now = dependencies.now ?? (() => new Date())
  const randomUUID = dependencies.randomUUID ?? getRandomUUID

  return repositories.transaction(
    ['articles', 'vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      const resolved = await resolveVocabularySelection(scope, selection)
      const existingTerm = await scope.vocabularyTerms.getByNormalizedTerm(
        resolved.normalizedTerm,
      )
      const existingContext = existingTerm
        ? (await scope.vocabularyContexts.listByTerm(existingTerm.id)).find(context =>
            context.articleId === resolved.article.id
            && context.sentenceId === resolved.sentence.id)
        : undefined

      if (existingTerm && existingContext) {
        return {
          kind: 'existing',
          term: existingTerm,
          context: existingContext,
        }
      }

      const timestamp = now().toISOString()
      const term: VocabularyTerm = existingTerm
        ? {
            ...existingTerm,
            meaning: existingTerm.meaning ?? resolved.token.meaning,
            updatedAt: timestamp,
          }
        : {
            id: randomUUID(),
            normalizedTerm: resolved.normalizedTerm,
            displayTerm: resolved.token.text,
            meaning: resolved.token.meaning,
            orphanedContextCount: 0,
            savedAt: timestamp,
            updatedAt: timestamp,
          }
      const context: VocabularyContext = {
        id: randomUUID(),
        termId: term.id,
        articleId: resolved.article.id,
        sentenceId: resolved.sentence.id,
        sentenceText: resolved.sentence.original,
        displayTerm: resolved.token.text,
        savedAt: timestamp,
      }

      if (!existingTerm || term.updatedAt !== existingTerm.updatedAt
        || term.meaning !== existingTerm.meaning) {
        await scope.vocabularyTerms.put(term)
      }
      await scope.vocabularyContexts.put(context)

      return { kind: 'created', term, context }
    },
  )
}

export async function removeVocabularyContext(
  repositories: LocalRepositories,
  input: { contextId: string },
): Promise<RemoveVocabularyContextResult> {
  return repositories.transaction(
    ['vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      const context = await scope.vocabularyContexts.get(input.contextId)
      if (!context) {
        return { kind: 'not-found' }
      }

      const term = await scope.vocabularyTerms.get(context.termId)
      await scope.vocabularyContexts.delete(context.id)
      if (!term) {
        return {
          kind: 'removed',
          context,
          term: null,
          termDeleted: false,
        }
      }

      const remainingContexts = await scope.vocabularyContexts.listByTerm(term.id)
      const termDeleted = remainingContexts.length === 0 && term.orphanedContextCount === 0
      if (termDeleted) {
        await scope.vocabularyTerms.delete(term.id)
      }

      return {
        kind: 'removed',
        context,
        term,
        termDeleted,
      }
    },
  )
}

export async function deleteVocabularyTerm(
  repositories: LocalRepositories,
  input: { termId: string },
): Promise<DeleteVocabularyTermResult> {
  return repositories.transaction(
    ['vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      const term = await scope.vocabularyTerms.get(input.termId)
      if (!term) {
        return { kind: 'not-found' }
      }

      const contexts = await scope.vocabularyContexts.listByTerm(term.id)
      for (const context of contexts) {
        await scope.vocabularyContexts.delete(context.id)
      }
      await scope.vocabularyTerms.delete(term.id)

      return {
        kind: 'deleted',
        term,
        deletedContexts: contexts,
      }
    },
  )
}

function getRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  throw new Error('A secure random UUID generator is required to save vocabulary.')
}
