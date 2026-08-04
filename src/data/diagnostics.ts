import {
  isArticleRecord,
  isReadingAttempt,
  isVocabularyContext,
  isVocabularyTerm,
  type ArticleRecord,
  type ReadingAttempt,
  type VocabularyContext,
  type VocabularyTerm,
} from './entities'
import type { DataDiagnosticIssue, DataStoreName } from './repositories'

export interface RepositorySnapshot {
  articles: unknown[]
  attempts: unknown[]
  vocabularyTerms: unknown[]
  vocabularyContexts: unknown[]
}

export function diagnoseSnapshot(snapshot: RepositorySnapshot): DataDiagnosticIssue[] {
  const issues: DataDiagnosticIssue[] = []
  const articles = validRecords(snapshot.articles, 'articles', isArticleRecord, issues)
  const attempts = validRecords(snapshot.attempts, 'attempts', isReadingAttempt, issues)
  const terms = validRecords(snapshot.vocabularyTerms, 'vocabularyTerms', isVocabularyTerm, issues)
  const contexts = validRecords(snapshot.vocabularyContexts, 'vocabularyContexts', isVocabularyContext, issues)

  const articleIds = new Set(articles.map(article => article.id))
  const termIds = new Set(terms.map(term => term.id))

  diagnoseActiveAttempts(attempts, issues)
  diagnoseAttemptReferences(attempts, articleIds, issues)
  diagnoseContextReferences(contexts, articleIds, termIds, issues)

  return issues
}

function validRecords<T extends { id: string }>(
  records: unknown[],
  store: DataStoreName,
  validate: (value: unknown) => value is T,
  issues: DataDiagnosticIssue[],
): T[] {
  const valid: T[] = []
  records.forEach((record, index) => {
    if (validate(record)) {
      valid.push(record)
      return
    }

    issues.push({
      store,
      key: recordId(record) ?? `index:${index}`,
      code: 'invalid-record',
      message: `The ${store} record does not match the current schema.`,
    })
  })
  return valid
}

function diagnoseActiveAttempts(
  attempts: ReadingAttempt[],
  issues: DataDiagnosticIssue[],
): void {
  const activeByArticle = new Map<string, string>()
  for (const attempt of attempts) {
    if (attempt.status !== 'active') {
      continue
    }

    const existingId = activeByArticle.get(attempt.articleId)
    if (existingId) {
      issues.push({
        store: 'attempts',
        key: attempt.id,
        code: 'duplicate-active-attempt',
        message: `Article ${attempt.articleId} has more than one active attempt (${existingId}, ${attempt.id}).`,
      })
      continue
    }
    activeByArticle.set(attempt.articleId, attempt.id)
  }
}

function diagnoseAttemptReferences(
  attempts: ReadingAttempt[],
  articleIds: Set<string>,
  issues: DataDiagnosticIssue[],
): void {
  for (const attempt of attempts) {
    if (!articleIds.has(attempt.articleId)) {
      issues.push({
        store: 'attempts',
        key: attempt.id,
        code: 'orphaned-reference',
        message: `Attempt ${attempt.id} references missing article ${attempt.articleId}.`,
      })
    }
  }
}

function diagnoseContextReferences(
  contexts: VocabularyContext[],
  articleIds: Set<string>,
  termIds: Set<string>,
  issues: DataDiagnosticIssue[],
): void {
  for (const context of contexts) {
    if (!articleIds.has(context.articleId) || !termIds.has(context.termId)) {
      issues.push({
        store: 'vocabularyContexts',
        key: context.id,
        code: 'orphaned-reference',
        message: `Vocabulary context ${context.id} references a missing article or term.`,
      })
    }
  }
}

function recordId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    return null
  }
  return typeof value.id === 'string' ? value.id : null
}

export type ValidRepositorySnapshot = {
  articles: ArticleRecord[]
  attempts: ReadingAttempt[]
  vocabularyTerms: VocabularyTerm[]
  vocabularyContexts: VocabularyContext[]
}
