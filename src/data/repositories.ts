import type {
  ArticleRecord,
  ReadingAttempt,
  VocabularyContext,
  VocabularyTerm,
  YomuExportPreferences,
  YomuExportV1,
} from './entities'

export const dataStoreNames = [
  'articles',
  'attempts',
  'vocabularyTerms',
  'vocabularyContexts',
] as const

export type DataStoreName = typeof dataStoreNames[number]
export type RepositoryMode = 'readonly' | 'readwrite'
export type RepositoryPersistence = 'persistent' | 'ephemeral'

export class DataValidationError extends Error {
  constructor(
    readonly store: DataStoreName,
    readonly recordId: string,
  ) {
    super(`Invalid ${store} record: ${recordId}`)
    this.name = 'DataValidationError'
  }
}

export class DataConstraintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataConstraintError'
  }
}

export class DataReadonlyTransactionError extends DataConstraintError {
  constructor(
    readonly store: DataStoreName,
    readonly operation: 'add' | 'put' | 'delete' | 'deleteByArticle' | 'clear',
  ) {
    super(`Cannot ${operation} ${store} records inside a readonly transaction.`)
    this.name = 'DataReadonlyTransactionError'
  }
}

export interface EntityRepository<T extends { id: string }> {
  get: (id: string) => Promise<T | null>
  list: () => Promise<T[]>
  put: (record: T) => Promise<void>
  delete: (id: string) => Promise<void>
  clear: () => Promise<void>
  count: () => Promise<number>
}

export interface ArticleRepository extends EntityRepository<ArticleRecord> {
  /** Creates only when the physical primary key is absent; never replaces invalid data. */
  add: (record: ArticleRecord) => Promise<void>
}

export interface AttemptRepository extends EntityRepository<ReadingAttempt> {
  listByArticle: (articleId: string) => Promise<ReadingAttempt[]>
  getActiveByArticle: (articleId: string) => Promise<ReadingAttempt | null>
  /** Deletes every indexed physical record, even when entity validation fails. */
  deleteByArticle: (articleId: string) => Promise<number>
}

export interface VocabularyTermRepository extends EntityRepository<VocabularyTerm> {
  getByNormalizedTerm: (normalizedTerm: string) => Promise<VocabularyTerm | null>
}

export interface VocabularyContextRepository extends EntityRepository<VocabularyContext> {
  listByTerm: (termId: string) => Promise<VocabularyContext[]>
  listByArticle: (articleId: string) => Promise<VocabularyContext[]>
  /** Deletes every indexed physical record, even when entity validation fails. */
  deleteByArticle: (articleId: string) => Promise<number>
}

export interface RepositoryScope {
  articles: ArticleRepository
  attempts: AttemptRepository
  vocabularyTerms: VocabularyTermRepository
  vocabularyContexts: VocabularyContextRepository
}

export interface DataDiagnosticIssue {
  store: DataStoreName | 'meta'
  key: string
  code: 'invalid-record' | 'duplicate-active-attempt' | 'orphaned-reference' | 'read-failed'
  message: string
}

export interface RepositoryDiagnostics {
  persistence: RepositoryPersistence
  schemaVersion: number
  migrationVersion: number
  counts: Record<DataStoreName, number>
  issues: DataDiagnosticIssue[]
}

export interface LegacyMigrationPayload {
  targetVersion: number
  articles: ArticleRecord[]
  attempts: ReadingAttempt[]
  vocabularyTerms: VocabularyTerm[]
  vocabularyContexts: VocabularyContext[]
}

export interface MigrationStateRepository {
  getVersion: () => Promise<number>
  apply: (payload: LegacyMigrationPayload) => Promise<void>
}

export interface LocalRepositories extends RepositoryScope {
  readonly persistence: RepositoryPersistence
  readonly migration: MigrationStateRepository
  transaction: <T>(
    stores: readonly DataStoreName[],
    mode: RepositoryMode,
    operation: (scope: RepositoryScope) => Promise<T>,
  ) => Promise<T>
  diagnose: () => Promise<RepositoryDiagnostics>
  exportData: (
    preferences: YomuExportPreferences,
    exportedAt?: string,
  ) => Promise<YomuExportV1>
  clearAll: () => Promise<void>
  close: () => void
}
