import type { ArticleRecord } from '@/data/entities'
import type { LocalRepositories, RepositoryScope } from '@/data/repositories'
import { normalizeArticleTitle } from '@/features/article/articleMetadata'

export class ArticleManagementNotFoundError extends Error {
  constructor(readonly articleId: string) {
    super(`Article ${articleId} was not found.`)
    this.name = 'ArticleManagementNotFoundError'
  }
}

export interface ArticleManagementDetails {
  article: ArticleRecord
  attemptCount: number
  vocabularyContextCount: number
  contextlessTermCount: number
}

export interface RenameArticleDependencies {
  now?: () => Date
}

export interface DeleteArticleResult {
  article: ArticleRecord
  deletedAttemptCount: number
  deletedContextCount: number
  updatedTermCount: number
  deletedTermCount: number
}

export async function getArticleManagementDetails(
  repositories: LocalRepositories,
  articleId: string,
): Promise<ArticleManagementDetails> {
  return repositories.transaction(
    ['articles', 'attempts', 'vocabularyTerms', 'vocabularyContexts'],
    'readonly',
    async (scope) => {
      const article = await requireArticle(scope, articleId)
      const [attempts, contexts] = await Promise.all([
        scope.attempts.listByArticle(article.id),
        scope.vocabularyContexts.listByArticle(article.id),
      ])
      const contextlessTermCount = await countTermsLeftWithoutLiveContexts(scope, contexts)

      return {
        article,
        attemptCount: attempts.length,
        vocabularyContextCount: contexts.length,
        contextlessTermCount,
      }
    },
  )
}

export async function renameArticle(
  repositories: LocalRepositories,
  input: { articleId: string, title: string },
  dependencies: RenameArticleDependencies = {},
): Promise<ArticleRecord> {
  const title = normalizeArticleTitle(input.title)
  const now = dependencies.now ?? (() => new Date())

  return repositories.transaction(['articles'], 'readwrite', async (scope) => {
    const article = await requireArticle(scope, input.articleId)
    const renamedArticle: ArticleRecord = {
      ...article,
      title,
      updatedAt: now().toISOString(),
    }
    await scope.articles.put(renamedArticle)
    return renamedArticle
  })
}

export async function deleteArticle(
  repositories: LocalRepositories,
  input: { articleId: string, deleteContextlessTerms: boolean },
): Promise<DeleteArticleResult> {
  return repositories.transaction(
    ['articles', 'attempts', 'vocabularyTerms', 'vocabularyContexts'],
    'readwrite',
    async (scope) => {
      const article = await requireArticle(scope, input.articleId)
      const contexts = await scope.vocabularyContexts.listByArticle(article.id)
      const termStates = await readAffectedTermStates(scope, contexts)

      const [deletedAttemptCount, deletedContextCount] = await Promise.all([
        scope.attempts.deleteByArticle(article.id),
        scope.vocabularyContexts.deleteByArticle(article.id),
      ])

      let updatedTermCount = 0
      let deletedTermCount = 0
      for (const state of termStates) {
        if (input.deleteContextlessTerms && state.remainingContextCount === 0) {
          await scope.vocabularyTerms.delete(state.term.id)
          deletedTermCount += 1
          continue
        }

        await scope.vocabularyTerms.put({
          ...state.term,
          orphanedContextCount:
            state.term.orphanedContextCount + state.removedContextCount,
        })
        updatedTermCount += 1
      }

      await scope.articles.delete(article.id)

      return {
        article,
        deletedAttemptCount,
        deletedContextCount,
        updatedTermCount,
        deletedTermCount,
      }
    },
  )
}

interface AffectedTermState {
  term: NonNullable<Awaited<ReturnType<RepositoryScope['vocabularyTerms']['get']>>>
  removedContextCount: number
  remainingContextCount: number
}

async function requireArticle(
  scope: Pick<RepositoryScope, 'articles'>,
  articleId: string,
): Promise<ArticleRecord> {
  const article = await scope.articles.get(articleId)
  if (!article) {
    throw new ArticleManagementNotFoundError(articleId)
  }
  return article
}

async function countTermsLeftWithoutLiveContexts(
  scope: Pick<RepositoryScope, 'vocabularyTerms' | 'vocabularyContexts'>,
  contexts: Awaited<ReturnType<RepositoryScope['vocabularyContexts']['listByArticle']>>,
): Promise<number> {
  const states = await readAffectedTermStates(scope, contexts)
  return states.filter(state => state.remainingContextCount === 0).length
}

async function readAffectedTermStates(
  scope: Pick<RepositoryScope, 'vocabularyTerms' | 'vocabularyContexts'>,
  contexts: Awaited<ReturnType<RepositoryScope['vocabularyContexts']['listByArticle']>>,
): Promise<AffectedTermState[]> {
  const removedContextCounts = new Map<string, number>()
  for (const context of contexts) {
    removedContextCounts.set(
      context.termId,
      (removedContextCounts.get(context.termId) ?? 0) + 1,
    )
  }

  const states: AffectedTermState[] = []
  for (const [termId, removedContextCount] of removedContextCounts) {
    const term = await scope.vocabularyTerms.get(termId)
    if (!term) {
      continue
    }
    const liveContexts = await scope.vocabularyContexts.listByTerm(term.id)
    states.push({
      term,
      removedContextCount,
      remainingContextCount: liveContexts.length - removedContextCount,
    })
  }
  return states
}
