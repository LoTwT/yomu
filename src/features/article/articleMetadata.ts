export const maxArticleTitleLength = 120

export class ArticleTitleRequiredError extends Error {
  constructor() {
    super('文章标题不能为空。')
    this.name = 'ArticleTitleRequiredError'
  }
}

export function normalizeArticleTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new ArticleTitleRequiredError()
  }
  return normalized.length > maxArticleTitleLength
    ? `${normalized.slice(0, maxArticleTitleLength - 3).trimEnd()}...`
    : normalized
}
