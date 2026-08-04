let pendingArticleId: string | null = null

export function requestLibraryArticleFocus(articleId: string): void {
  pendingArticleId = articleId
}

export function takeLibraryArticleFocus(): string | null {
  const articleId = pendingArticleId
  pendingArticleId = null
  return articleId
}
