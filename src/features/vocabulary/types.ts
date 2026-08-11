export interface VocabularyContextListItem {
  id: string
  articleId: string
  articleTitle: string
  articleSourceLabel: string
  sentenceId: string
  sentenceText: string
  displayTerm: string
  savedAt: string
}

export interface VocabularyListItem {
  id: string
  normalizedTerm: string
  displayTerm: string
  meaning?: string
  savedAt: string
  updatedAt: string
  unavailableContextCount: number
  contexts: readonly VocabularyContextListItem[]
}

export interface VocabularyContextAction {
  termId: string
  contextId: string
  articleId: string
  sentenceId: string
}

export interface VocabularyTermAction {
  termId: string
}

export interface VocabularySourceLocation {
  articleId: string
  sentenceId: string
}

export type VocabularyLibraryFocusTarget =
  | { kind: 'context', contextId: string }
  | { kind: 'term-heading' }
  | { kind: 'term-delete' }
  | { kind: 'term', termId: string }
  | { kind: 'empty' }
  | { kind: 'no-results' }
  | { kind: 'retry' }

export interface VocabularyLibraryFocusRequest {
  id: number
  target: VocabularyLibraryFocusTarget
}

export type ReviewVocabularyFocusTarget =
  | { kind: 'context', contextId: string }
  | { kind: 'heading' }
  | { kind: 'retry' }

export interface ReviewVocabularyFocusRequest {
  id: number
  target: ReviewVocabularyFocusTarget
}
