import { reconcileArticleCapabilities } from './articleCapabilities'
import { diagnoseSnapshot } from './diagnostics'
import {
  isArticleRecord,
  isReadingAttempt,
  isVocabularyContext,
  isVocabularyTerm,
  type ArticleRecord,
  type ReadingAttempt,
  type VocabularyContext,
  type VocabularyTerm,
  type YomuExportPreferences,
  type YomuExportV1,
} from './entities'
import {
  dataStoreNames,
  type AttemptRepository,
  DataConstraintError,
  DataValidationError,
  type DataStoreName,
  type EntityRepository,
  type LegacyMigrationPayload,
  type LocalRepositories,
  type RepositoryDiagnostics,
  type RepositoryMode,
  type RepositoryScope,
  type VocabularyContextRepository,
  type VocabularyTermRepository,
} from './repositories'
import { guardTransactionRepository } from './repositoryTransactionGuard'

type EntityByStore = {
  articles: ArticleRecord
  attempts: ReadingAttempt
  vocabularyTerms: VocabularyTerm
  vocabularyContexts: VocabularyContext
}

type MemoryState = {
  [Store in DataStoreName]: Map<string, EntityByStore[Store]>
}

interface MemoryDatabaseState {
  stores: MemoryState
  migrationVersion: number
}

type MemorySnapshot = {
  [Store in DataStoreName]: EntityByStore[Store][]
}

export interface MemoryRepositorySeed {
  articles?: ArticleRecord[]
  attempts?: ReadingAttempt[]
  vocabularyTerms?: VocabularyTerm[]
  vocabularyContexts?: VocabularyContext[]
  migrationVersion?: number
}

export function createMemoryLocalRepositories(
  seed: MemoryRepositorySeed = {},
): LocalRepositories {
  return new MemoryLocalRepositories(seed)
}

class MemoryLocalRepositories implements LocalRepositories {
  readonly persistence = 'ephemeral' as const

  private database: MemoryDatabaseState
  private readonly writeQueue = new RecoveringSerialWriteQueue()

  constructor(seed: MemoryRepositorySeed) {
    this.database = createDatabaseState(seed)
  }

  get articles(): EntityRepository<ArticleRecord> {
    return topLevelArticleRepository(this)
  }

  get attempts(): AttemptRepository {
    return topLevelAttemptRepository(this)
  }

  get vocabularyTerms(): VocabularyTermRepository {
    return topLevelVocabularyTermRepository(this)
  }

  get vocabularyContexts(): VocabularyContextRepository {
    return topLevelVocabularyContextRepository(this)
  }

  readonly migration = {
    getVersion: (): Promise<number> => this.readAfterPrecedingWrites(
      () => this.database.migrationVersion,
    ),
    apply: async (payload: LegacyMigrationPayload): Promise<void> => {
      await this.writeQueue.run(async () => {
        if (this.database.migrationVersion >= payload.targetVersion) {
          return
        }

        const workingDatabase = cloneDatabaseState(this.database)
        const scope = createScope(
          workingDatabase.stores,
          new Set(dataStoreNames),
          'readwrite',
        )
        await Promise.all(payload.articles.map(article => scope.articles.put(article)))
        await Promise.all(payload.attempts.map(attempt => scope.attempts.put(attempt)))
        await Promise.all(payload.vocabularyTerms.map(term => scope.vocabularyTerms.put(term)))
        await Promise.all(payload.vocabularyContexts.map(context => scope.vocabularyContexts.put(context)))
        workingDatabase.migrationVersion = payload.targetVersion
        this.database = workingDatabase
      })
    },
  }

  async transaction<T>(
    stores: readonly DataStoreName[],
    mode: RepositoryMode,
    operation: (scope: RepositoryScope) => Promise<T>,
  ): Promise<T> {
    if (stores.length === 0) {
      throw new DataConstraintError('At least one object store must be declared for a transaction.')
    }
    const allowed = new Set(stores)
    if (mode === 'readonly') {
      return this.readAfterPrecedingWrites(() =>
        operation(createScope(cloneState(this.database.stores), allowed, mode)))
    }

    return this.writeQueue.run(async () => {
      const workingDatabase = cloneDatabaseState(this.database)
      const result = await operation(createScope(workingDatabase.stores, allowed, mode))
      this.database = workingDatabase
      return result
    })
  }

  async diagnose(): Promise<RepositoryDiagnostics> {
    return this.readAfterPrecedingWrites(() => {
      const snapshot = snapshotState(this.database.stores)
      return {
        persistence: this.persistence,
        schemaVersion: 2,
        migrationVersion: this.database.migrationVersion,
        counts: {
          articles: snapshot.articles.length,
          attempts: snapshot.attempts.length,
          vocabularyTerms: snapshot.vocabularyTerms.length,
          vocabularyContexts: snapshot.vocabularyContexts.length,
        },
        issues: diagnoseSnapshot(snapshot),
      }
    })
  }

  async exportData(
    preferences: YomuExportPreferences,
    exportedAt = new Date().toISOString(),
  ): Promise<YomuExportV1> {
    return this.readAfterPrecedingWrites(() => {
      const snapshot = snapshotState(this.database.stores)
      return {
        format: 'yomu-export',
        formatVersion: 1,
        exportedAt,
        articles: sortById(snapshot.articles.map(reconcileArticleCapabilities)),
        attempts: sortById(snapshot.attempts),
        vocabularyTerms: sortById(snapshot.vocabularyTerms),
        vocabularyContexts: sortById(snapshot.vocabularyContexts),
        preferences: clone(preferences),
      }
    })
  }

  async clearAll(): Promise<void> {
    await this.writeQueue.run(async () => {
      this.database = createDatabaseState({})
    })
  }

  close(): void {}

  private async readAfterPrecedingWrites<T>(operation: () => T | Promise<T>): Promise<T> {
    const precedingWrites = this.writeQueue.precedingWrites()
    await precedingWrites
    return operation()
  }
}

class RecoveringSerialWriteQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  precedingWrites(): Promise<void> {
    return this.tail
  }
}

function createDatabaseState(seed: MemoryRepositorySeed): MemoryDatabaseState {
  return {
    stores: createState(seed),
    migrationVersion: seed.migrationVersion ?? 0,
  }
}

function cloneDatabaseState(database: MemoryDatabaseState): MemoryDatabaseState {
  return {
    stores: cloneState(database.stores),
    migrationVersion: database.migrationVersion,
  }
}

function createState(seed: MemoryRepositorySeed): MemoryState {
  return {
    articles: toMap('articles', seed.articles ?? [], isArticleRecord),
    attempts: toMap('attempts', seed.attempts ?? [], isReadingAttempt),
    vocabularyTerms: toMap(
      'vocabularyTerms',
      seed.vocabularyTerms ?? [],
      isVocabularyTerm,
    ),
    vocabularyContexts: toMap(
      'vocabularyContexts',
      seed.vocabularyContexts ?? [],
      isVocabularyContext,
    ),
  }
}

function cloneState(state: MemoryState): MemoryState {
  return {
    articles: cloneMap(state.articles),
    attempts: cloneMap(state.attempts),
    vocabularyTerms: cloneMap(state.vocabularyTerms),
    vocabularyContexts: cloneMap(state.vocabularyContexts),
  }
}

function snapshotState(state: MemoryState): MemorySnapshot {
  return {
    articles: [...state.articles.values()].map(clone),
    attempts: [...state.attempts.values()].map(clone),
    vocabularyTerms: [...state.vocabularyTerms.values()].map(clone),
    vocabularyContexts: [...state.vocabularyContexts.values()].map(clone),
  }
}

function createScope(
  state: MemoryState,
  allowed = new Set<DataStoreName>(dataStoreNames),
  mode: RepositoryMode = 'readwrite',
): RepositoryScope {
  return {
    articles: guardTransactionRepository('articles', createArticleRepository(state), allowed, mode),
    attempts: guardTransactionRepository('attempts', createAttemptRepository(state), allowed, mode),
    vocabularyTerms: guardTransactionRepository('vocabularyTerms', createVocabularyTermRepository(state), allowed, mode),
    vocabularyContexts: guardTransactionRepository('vocabularyContexts', createVocabularyContextRepository(state), allowed, mode),
  }
}

function createArticleRepository(state: MemoryState): EntityRepository<ArticleRecord> {
  const base = createEntityRepository('articles', state.articles, isArticleRecord)
  return {
    ...base,
    get: async (id) => {
      const article = await base.get(id)
      return article ? reconcileArticleCapabilities(article) : null
    },
    list: async () => (await base.list()).map(reconcileArticleCapabilities),
  }
}

function createAttemptRepository(state: MemoryState): AttemptRepository {
  const base = createEntityRepository('attempts', state.attempts, isReadingAttempt, (record) => {
    if (record.status !== 'active') {
      return
    }
    const duplicate = [...state.attempts.values()].find(attempt =>
      attempt.status === 'active'
      && attempt.articleId === record.articleId
      && attempt.id !== record.id,
    )
    if (duplicate) {
      throw new DataConstraintError(`Article ${record.articleId} already has active attempt ${duplicate.id}.`)
    }
  })
  return {
    ...base,
    listByArticle: async articleId => sortById(
      [...state.attempts.values()]
        .filter(attempt => attempt.articleId === articleId)
        .map(clone),
    ),
    getActiveByArticle: async articleId => {
      const value = [...state.attempts.values()].find(attempt =>
        attempt.articleId === articleId && attempt.status === 'active',
      )
      return value ? clone(value) : null
    },
    deleteByArticle: async articleId => deleteMapEntriesByArticle(state.attempts, articleId),
  }
}

function createVocabularyTermRepository(state: MemoryState): VocabularyTermRepository {
  const base = createEntityRepository('vocabularyTerms', state.vocabularyTerms, isVocabularyTerm, (record) => {
    const duplicate = [...state.vocabularyTerms.values()].find(term =>
      term.normalizedTerm === record.normalizedTerm && term.id !== record.id,
    )
    if (duplicate) {
      throw new DataConstraintError(`Vocabulary term ${record.normalizedTerm} already exists as ${duplicate.id}.`)
    }
  })
  return {
    ...base,
    getByNormalizedTerm: async normalizedTerm => {
      const value = [...state.vocabularyTerms.values()].find(term => term.normalizedTerm === normalizedTerm)
      return value ? clone(value) : null
    },
  }
}

function createVocabularyContextRepository(state: MemoryState): VocabularyContextRepository {
  const base = createEntityRepository('vocabularyContexts', state.vocabularyContexts, isVocabularyContext, (record) => {
    const duplicate = [...state.vocabularyContexts.values()].find(context =>
      context.termId === record.termId
      && context.articleId === record.articleId
      && context.sentenceId === record.sentenceId
      && context.id !== record.id,
    )
    if (duplicate) {
      throw new DataConstraintError(`Vocabulary context already exists as ${duplicate.id}.`)
    }
  })
  return {
    ...base,
    listByTerm: async termId => sortById(
      [...state.vocabularyContexts.values()]
        .filter(context => context.termId === termId)
        .map(clone),
    ),
    listByArticle: async articleId => sortById(
      [...state.vocabularyContexts.values()]
        .filter(context => context.articleId === articleId)
        .map(clone),
    ),
    deleteByArticle: async articleId => deleteMapEntriesByArticle(
      state.vocabularyContexts,
      articleId,
    ),
  }
}

function topLevelArticleRepository(owner: MemoryLocalRepositories): EntityRepository<ArticleRecord> {
  return topLevelEntityRepository(owner, 'articles', scope => scope.articles)
}

function topLevelAttemptRepository(owner: MemoryLocalRepositories): AttemptRepository {
  const base = topLevelEntityRepository(owner, 'attempts', scope => scope.attempts)
  return {
    ...base,
    listByArticle: articleId => owner.transaction(['attempts'], 'readonly', scope =>
      scope.attempts.listByArticle(articleId)),
    getActiveByArticle: articleId => owner.transaction(['attempts'], 'readonly', scope =>
      scope.attempts.getActiveByArticle(articleId)),
    deleteByArticle: articleId => owner.transaction(['attempts'], 'readwrite', scope =>
      scope.attempts.deleteByArticle(articleId)),
  }
}

function topLevelVocabularyTermRepository(owner: MemoryLocalRepositories): VocabularyTermRepository {
  const base = topLevelEntityRepository(owner, 'vocabularyTerms', scope => scope.vocabularyTerms)
  return {
    ...base,
    getByNormalizedTerm: normalizedTerm => owner.transaction(['vocabularyTerms'], 'readonly', scope =>
      scope.vocabularyTerms.getByNormalizedTerm(normalizedTerm)),
  }
}

function topLevelVocabularyContextRepository(owner: MemoryLocalRepositories): VocabularyContextRepository {
  const base = topLevelEntityRepository(owner, 'vocabularyContexts', scope => scope.vocabularyContexts)
  return {
    ...base,
    listByTerm: termId => owner.transaction(['vocabularyContexts'], 'readonly', scope =>
      scope.vocabularyContexts.listByTerm(termId)),
    listByArticle: articleId => owner.transaction(['vocabularyContexts'], 'readonly', scope =>
      scope.vocabularyContexts.listByArticle(articleId)),
    deleteByArticle: articleId => owner.transaction(
      ['vocabularyContexts'],
      'readwrite',
      scope => scope.vocabularyContexts.deleteByArticle(articleId),
    ),
  }
}

function deleteMapEntriesByArticle<T extends { articleId: string }>(
  records: Map<string, T>,
  articleId: string,
): number {
  let deletedCount = 0
  for (const [recordId, record] of records) {
    if (record.articleId !== articleId) {
      continue
    }
    records.delete(recordId)
    deletedCount += 1
  }
  return deletedCount
}

function topLevelEntityRepository<T extends { id: string }>(
  owner: MemoryLocalRepositories,
  store: DataStoreName,
  select: (scope: RepositoryScope) => EntityRepository<T>,
): EntityRepository<T> {
  return {
    get: id => owner.transaction([store], 'readonly', scope => select(scope).get(id)),
    list: () => owner.transaction([store], 'readonly', scope => select(scope).list()),
    put: record => owner.transaction([store], 'readwrite', scope => select(scope).put(record)),
    delete: id => owner.transaction([store], 'readwrite', scope => select(scope).delete(id)),
    clear: () => owner.transaction([store], 'readwrite', scope => select(scope).clear()),
    count: () => owner.transaction([store], 'readonly', scope => select(scope).count()),
  }
}

function createEntityRepository<T extends { id: string }>(
  store: DataStoreName,
  records: Map<string, T>,
  validate: (value: unknown) => value is T,
  beforePut?: (record: T) => void,
): EntityRepository<T> {
  return {
    get: async (id) => {
      const value = records.get(id)
      return value ? clone(value) : null
    },
    list: async () => sortById([...records.values()].map(clone)),
    put: async (record) => {
      const recordId = record.id
      if (!validate(record as unknown)) {
        throw new DataValidationError(store, recordId)
      }
      beforePut?.(record)
      records.set(record.id, clone(record))
    },
    delete: async (id) => {
      records.delete(id)
    },
    clear: async () => {
      records.clear()
    },
    count: async () => records.size,
  }
}

function toMap<T extends { id: string }>(
  store: DataStoreName,
  values: T[],
  validate: (value: unknown) => value is T,
): Map<string, T> {
  return new Map(values.map((value) => {
    const recordId = value.id
    if (!validate(value as unknown)) {
      throw new DataValidationError(store, recordId)
    }
    return [recordId, clone(value)]
  }))
}

function cloneMap<T extends { id: string }>(values: Map<string, T>): Map<string, T> {
  return new Map([...values].map(([key, value]) => [key, clone(value)]))
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return values.sort((left, right) => left.id.localeCompare(right.id))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
