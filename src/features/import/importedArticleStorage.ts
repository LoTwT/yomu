import type { DailyArticle, ImportedArticleMetadata } from '@/features/article/types'

export interface ImportedArticleSummary {
  articleId: string
  title: string
  importedAt: string
  sourceType: ImportedArticleMetadata['sourceType']
  sourceLabel: string
  sentenceCount: number
  textHash: string
}

const importedArticleKeyPrefix = 'yomu:imported-article:'
const importedArticleIndexKey = 'yomu:imported-article:index'

export function saveImportedArticle(storage: Storage, article: DailyArticle): void {
  if (!article.importMetadata) {
    return
  }

  storage.setItem(`${importedArticleKeyPrefix}${article.id}`, JSON.stringify(article))
  const summaries = loadImportedArticleSummaries(storage)
  const nextSummary = toSummary(article)
  const nextSummaries = [
    nextSummary,
    ...summaries.filter(summary => summary.articleId !== article.id),
  ].sort((left, right) => right.importedAt.localeCompare(left.importedAt))

  storage.setItem(importedArticleIndexKey, JSON.stringify(nextSummaries))
}

export function loadImportedArticle(storage: Storage, articleId: string): DailyArticle | null {
  const raw = storage.getItem(`${importedArticleKeyPrefix}${articleId}`)
  if (!raw) {
    return null
  }

  try {
    const article = JSON.parse(raw) as DailyArticle
    return article.importMetadata?.articleId === article.id ? article : null
  }
  catch {
    return null
  }
}

export function loadImportedArticleSummaries(storage: Storage): ImportedArticleSummary[] {
  const raw = storage.getItem(importedArticleIndexKey)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isImportedArticleSummary)
  }
  catch {
    return []
  }
}

export function deleteImportedArticle(storage: Storage, articleId: string): void {
  storage.removeItem(`${importedArticleKeyPrefix}${articleId}`)
  const nextSummaries = loadImportedArticleSummaries(storage)
    .filter(summary => summary.articleId !== articleId)
  storage.setItem(importedArticleIndexKey, JSON.stringify(nextSummaries))
}

function toSummary(article: DailyArticle): ImportedArticleSummary {
  const metadata = article.importMetadata
  if (!metadata) {
    throw new Error('Imported article metadata is required.')
  }

  return {
    articleId: article.id,
    title: article.title,
    importedAt: metadata.importedAt,
    sourceType: metadata.sourceType,
    sourceLabel: metadata.sourceRef.label,
    sentenceCount: article.sentences.length,
    textHash: metadata.textHash,
  }
}

function isImportedArticleSummary(value: unknown): value is ImportedArticleSummary {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ImportedArticleSummary).articleId === 'string'
    && typeof (value as ImportedArticleSummary).title === 'string'
    && typeof (value as ImportedArticleSummary).importedAt === 'string'
    && ((value as ImportedArticleSummary).sourceType === 'paste'
      || (value as ImportedArticleSummary).sourceType === 'file'
      || (value as ImportedArticleSummary).sourceType === 'url')
    && typeof (value as ImportedArticleSummary).sourceLabel === 'string'
    && typeof (value as ImportedArticleSummary).sentenceCount === 'number'
    && typeof (value as ImportedArticleSummary).textHash === 'string'
}
