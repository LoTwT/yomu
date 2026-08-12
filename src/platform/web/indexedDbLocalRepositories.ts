import { reconcileArticleCapabilities } from '@/data/articleCapabilities'
import { diagnoseSnapshot } from '@/data/diagnostics'
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
} from '@/data/entities'
import {
  DataConstraintError,
  DataValidationError,
  dataStoreNames,
  type AttemptRepository,
  type ArticleRepository,
  type DataDiagnosticIssue,
  type DataStoreName,
  type EntityRepository,
  type LegacyMigrationPayload,
  type LocalRepositories,
  type RepositoryDiagnostics,
  type RepositoryMode,
  type RepositoryScope,
  type VocabularyContextRepository,
  type VocabularyTermRepository,
} from '@/data/repositories'
import { guardTransactionRepository } from '@/data/repositoryTransactionGuard'

import {
  openYomuIndexedDb,
  YOMU_INDEXED_DB_VERSION,
  yomuObjectStoreNames,
} from './indexedDbSchema'

const migrationMetaKey = 'legacy-migration-version'

export async function createIndexedDbLocalRepositories(options: {
  factory: IDBFactory
  databaseName?: string
}): Promise<LocalRepositories> {
  const database = await openYomuIndexedDb(options.factory, options.databaseName)
  return new IndexedDbLocalRepositories(database)
}

class IndexedDbLocalRepositories implements LocalRepositories {
  readonly persistence = 'persistent' as const

  private readonly readIssues = new Map<string, DataDiagnosticIssue>()

  constructor(private readonly database: IDBDatabase) {}

  get articles(): ArticleRepository {
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
    getVersion: async (): Promise<number> => {
      return this.withInternalTransaction([yomuObjectStoreNames.meta], 'readonly', async (transaction) => {
        const record = await requestToPromise<{ key: string, value: unknown } | undefined>(
          transaction.objectStore(yomuObjectStoreNames.meta).get(migrationMetaKey),
        )
        return typeof record?.value === 'number' ? record.value : 0
      })
    },
    apply: async (payload: LegacyMigrationPayload): Promise<void> => {
      await this.withInternalTransaction(
        [...dataStoreNames, yomuObjectStoreNames.meta],
        'readwrite',
        async (transaction) => {
          const meta = transaction.objectStore(yomuObjectStoreNames.meta)
          const versionRecord = await requestToPromise<{ key: string, value: unknown } | undefined>(
            meta.get(migrationMetaKey),
          )
          const currentVersion = typeof versionRecord?.value === 'number'
            ? versionRecord.value
            : 0
          if (currentVersion >= payload.targetVersion) {
            return
          }

          const scope = createIndexedDbScope(transaction, issue => this.recordReadIssue(issue))
          await Promise.all([
            ...payload.articles.map(article => scope.articles.put(article)),
            ...payload.attempts.map(attempt => scope.attempts.put(attempt)),
            ...payload.vocabularyTerms.map(term => scope.vocabularyTerms.put(term)),
            ...payload.vocabularyContexts.map(context => scope.vocabularyContexts.put(context)),
            requestToPromise(meta.put({ key: migrationMetaKey, value: payload.targetVersion })),
          ])
        },
      )
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
    return this.withInternalTransaction([...new Set(stores)], mode, transaction =>
      operation(createIndexedDbScope(transaction, issue => this.recordReadIssue(issue))),
    )
  }

  async diagnose(): Promise<RepositoryDiagnostics> {
    this.readIssues.clear()
    const [snapshot, migrationVersion] = await Promise.all([
      this.readSnapshot(),
      this.migration.getVersion(),
    ])
    return {
      persistence: this.persistence,
      schemaVersion: YOMU_INDEXED_DB_VERSION,
      migrationVersion,
      counts: {
        articles: snapshot.articles.length,
        attempts: snapshot.attempts.length,
        vocabularyTerms: snapshot.vocabularyTerms.length,
        vocabularyContexts: snapshot.vocabularyContexts.length,
      },
      issues: [
        ...diagnoseSnapshot(snapshot),
        ...this.readIssues.values(),
      ],
    }
  }

  async exportData(
    preferences: YomuExportPreferences,
    exportedAt = new Date().toISOString(),
  ): Promise<YomuExportV1> {
    const snapshot = await this.readSnapshot()
    return {
      format: 'yomu-export',
      formatVersion: 1,
      exportedAt,
      articles: sortById(snapshot.articles),
      attempts: sortById(snapshot.attempts),
      vocabularyTerms: sortById(snapshot.vocabularyTerms),
      vocabularyContexts: sortById(snapshot.vocabularyContexts),
      preferences: clone(preferences),
    }
  }

  async clearAll(): Promise<void> {
    await this.withInternalTransaction(
      [...dataStoreNames, yomuObjectStoreNames.meta],
      'readwrite',
      async (transaction) => {
        await Promise.all(
          [...dataStoreNames, yomuObjectStoreNames.meta]
            .map(store => requestToPromise(transaction.objectStore(store).clear())),
        )
      },
    )
  }

  close(): void {
    this.database.close()
  }

  private recordReadIssue(issue: DataDiagnosticIssue): void {
    this.readIssues.set(`${issue.store}:${issue.key}:${issue.code}`, issue)
  }

  private readSnapshot(): Promise<{
    articles: ArticleRecord[]
    attempts: ReadingAttempt[]
    vocabularyTerms: VocabularyTerm[]
    vocabularyContexts: VocabularyContext[]
  }> {
    return this.transaction(dataStoreNames, 'readonly', async (scope) => {
      const [articles, attempts, vocabularyTerms, vocabularyContexts] = await Promise.all([
        scope.articles.list(),
        scope.attempts.list(),
        scope.vocabularyTerms.list(),
        scope.vocabularyContexts.list(),
      ])
      return { articles, attempts, vocabularyTerms, vocabularyContexts }
    })
  }

  private async withInternalTransaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = this.database.transaction(stores, mode)
    const completion = transactionCompletion(transaction)
    const stopKeepAlive = keepTransactionAlive(transaction)
    try {
      const result = await operation(transaction)
      stopKeepAlive()
      await completion
      return result
    }
    catch (error) {
      stopKeepAlive()
      try {
        transaction.abort()
      }
      catch {}
      await completion.catch(() => {})
      throw error
    }
  }
}

type ReadIssueReporter = (issue: DataDiagnosticIssue) => void

function createIndexedDbScope(
  transaction: IDBTransaction,
  reportIssue: ReadIssueReporter = () => {},
): RepositoryScope {
  const allowedStores = new Set<DataStoreName>(
    Array.from(transaction.objectStoreNames)
      .filter((store): store is DataStoreName => dataStoreNames.includes(store as DataStoreName)),
  )
  const mode: RepositoryMode = transaction.mode === 'readonly' ? 'readonly' : 'readwrite'
  return {
    articles: guardTransactionRepository(
      'articles',
      indexedDbArticleRepository(transaction, reportIssue),
      allowedStores,
      mode,
    ),
    attempts: guardTransactionRepository(
      'attempts',
      indexedDbAttemptRepository(transaction, reportIssue),
      allowedStores,
      mode,
    ),
    vocabularyTerms: guardTransactionRepository(
      'vocabularyTerms',
      indexedDbVocabularyTermRepository(transaction, reportIssue),
      allowedStores,
      mode,
    ),
    vocabularyContexts: guardTransactionRepository(
      'vocabularyContexts',
      indexedDbVocabularyContextRepository(transaction, reportIssue),
      allowedStores,
      mode,
    ),
  }
}

function indexedDbArticleRepository(
  transaction: IDBTransaction,
  reportIssue: ReadIssueReporter,
): ArticleRepository {
  const base = indexedDbEntityRepository(
    transaction,
    'articles',
    isArticleRecord,
    reportIssue,
  )
  return {
    ...base,
    add: async (article) => {
      const value: unknown = article
      if (!isArticleRecord(value)) {
        throw new DataValidationError('articles', article.id)
      }
      try {
        await requestToPromise(transaction.objectStore('articles').add(clone(article)))
      }
      catch (error) {
        if (isIndexedDbConstraintError(error)) {
          throw new DataConstraintError(`Article ${article.id} already exists.`)
        }
        throw error
      }
    },
    get: async (id) => {
      const article = await base.get(id)
      return article ? reconcileArticleCapabilities(article) : null
    },
    list: async () => (await base.list()).map(reconcileArticleCapabilities),
  }
}

function indexedDbAttemptRepository(
  transaction: IDBTransaction,
  reportIssue: ReadIssueReporter,
): AttemptRepository {
  const runPut = createRecoveringSerialExecutor()
  const base = indexedDbEntityRepository(transaction, 'attempts', isReadingAttempt, reportIssue, async (record) => {
    if (record.status !== 'active') {
      return
    }
    const active = await readValidValues(
      transaction.objectStore('attempts').index('byArticleStatus'),
      [record.articleId, 'active'],
      'attempts',
      isReadingAttempt,
      reportIssue,
    )
    const duplicate = active.find(attempt => attempt.id !== record.id)
    if (duplicate) {
      throw new DataConstraintError(`Article ${record.articleId} already has active attempt ${duplicate.id}.`)
    }
  })
  return {
    ...base,
    put: record => runPut(() => base.put(record)),
    listByArticle: async articleId => sortById(await readValidValues(
      transaction.objectStore('attempts').index('byArticleId'),
      articleId,
      'attempts',
      isReadingAttempt,
      reportIssue,
    )),
    getActiveByArticle: async articleId => {
      const values = await readValidValues(
        transaction.objectStore('attempts').index('byArticleStatus'),
        [articleId, 'active'],
        'attempts',
        isReadingAttempt,
        reportIssue,
      )
      return values[0] ?? null
    },
    deleteByArticle: articleId => deleteIndexedEntriesByPrimaryKey(
      transaction.objectStore('attempts').index('byArticleId'),
      articleId,
    ),
  }
}

function createRecoveringSerialExecutor(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function indexedDbVocabularyTermRepository(
  transaction: IDBTransaction,
  reportIssue: ReadIssueReporter,
): VocabularyTermRepository {
  const base = indexedDbEntityRepository(
    transaction,
    'vocabularyTerms',
    isVocabularyTerm,
    reportIssue,
    async (record) => {
      const matches = await readValidValues(
        transaction.objectStore('vocabularyTerms').index('byNormalizedTerm'),
        record.normalizedTerm,
        'vocabularyTerms',
        isVocabularyTerm,
        reportIssue,
      )
      const duplicate = matches.find(term => term.id !== record.id)
      if (duplicate) {
        throw new DataConstraintError(`Vocabulary term ${record.normalizedTerm} already exists as ${duplicate.id}.`)
      }
    },
  )
  return {
    ...base,
    getByNormalizedTerm: async normalizedTerm => {
      const values = await readValidValues(
        transaction.objectStore('vocabularyTerms').index('byNormalizedTerm'),
        normalizedTerm,
        'vocabularyTerms',
        isVocabularyTerm,
        reportIssue,
      )
      return values[0] ?? null
    },
  }
}

function indexedDbVocabularyContextRepository(
  transaction: IDBTransaction,
  reportIssue: ReadIssueReporter,
): VocabularyContextRepository {
  const base = indexedDbEntityRepository(
    transaction,
    'vocabularyContexts',
    isVocabularyContext,
    reportIssue,
    async (record) => {
      const matches = await readValidValues(
        transaction.objectStore('vocabularyContexts').index('byTermArticleSentence'),
        [record.termId, record.articleId, record.sentenceId],
        'vocabularyContexts',
        isVocabularyContext,
        reportIssue,
      )
      const duplicate = matches.find(context => context.id !== record.id)
      if (duplicate) {
        throw new DataConstraintError(`Vocabulary context already exists as ${duplicate.id}.`)
      }
    },
  )
  return {
    ...base,
    listByTerm: async termId => sortById(await readValidValues(
      transaction.objectStore('vocabularyContexts').index('byTermId'),
      termId,
      'vocabularyContexts',
      isVocabularyContext,
      reportIssue,
    )),
    listByArticle: async articleId => sortById(await readValidValues(
      transaction.objectStore('vocabularyContexts').index('byArticleId'),
      articleId,
      'vocabularyContexts',
      isVocabularyContext,
      reportIssue,
    )),
    deleteByArticle: articleId => deleteIndexedEntriesByPrimaryKey(
      transaction.objectStore('vocabularyContexts').index('byArticleId'),
      articleId,
    ),
  }
}

function indexedDbEntityRepository<T extends { id: string }>(
  transaction: IDBTransaction,
  storeName: DataStoreName,
  validate: (value: unknown) => value is T,
  reportIssue: ReadIssueReporter,
  beforePut?: (record: T) => Promise<void>,
): EntityRepository<T> {
  const store = (): IDBObjectStore => transaction.objectStore(storeName)
  return {
    get: async (id) => {
      const value = await requestToPromise<unknown>(store().get(id))
      if (value === undefined) {
        return null
      }
      return validateReadRecord(value, id, storeName, validate, reportIssue)
    },
    list: async () => sortById(await readValidValues(
      store(),
      undefined,
      storeName,
      validate,
      reportIssue,
    )),
    put: async (record) => {
      const recordId = record.id
      if (!validate(record as unknown)) {
        throw new DataValidationError(storeName, recordId)
      }
      await beforePut?.(record)
      try {
        await requestToPromise(store().put(clone(record)))
      }
      catch (error) {
        if (isIndexedDbConstraintError(error)) {
          throw new DataConstraintError(`Record ${recordId} violates a ${storeName} constraint.`)
        }
        throw error
      }
    },
    delete: async (id) => {
      await requestToPromise(store().delete(id))
    },
    clear: async () => {
      await requestToPromise(store().clear())
    },
    count: async () => (await readValidValues(
      store(),
      undefined,
      storeName,
      validate,
      reportIssue,
    )).length,
  }
}

function readValidValues<T extends { id: string }>(
  source: IDBObjectStore | IDBIndex,
  query: IDBValidKey | IDBKeyRange | undefined,
  storeName: DataStoreName,
  validate: (value: unknown) => value is T,
  reportIssue: ReadIssueReporter,
): Promise<T[]> {
  return readCursorEntries(source, query).then(entries => entries.flatMap(({ key, value }) => {
    const record = validateReadRecord(value, key, storeName, validate, reportIssue)
    return record ? [record] : []
  }))
}

function validateReadRecord<T extends { id: string }>(
  value: unknown,
  key: IDBValidKey,
  storeName: DataStoreName,
  validate: (value: unknown) => value is T,
  reportIssue: ReadIssueReporter,
): T | null {
  if (validate(value)) {
    return value
  }

  const recordKey = formatIndexedDbKey(key)
  reportIssue({
    store: storeName,
    key: recordKey,
    code: 'invalid-record',
    message: `Ignored an invalid ${storeName} record at key ${recordKey}.`,
  })
  return null
}

function readCursorEntries(
  source: IDBObjectStore | IDBIndex,
  query?: IDBValidKey | IDBKeyRange,
): Promise<Array<{ key: IDBValidKey, value: unknown }>> {
  return new Promise((resolve, reject) => {
    const entries: Array<{ key: IDBValidKey, value: unknown }> = []
    const request = source.openCursor(query)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(entries)
        return
      }
      entries.push({ key: cursor.primaryKey, value: cursor.value })
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor read failed.'))
  })
}

function deleteIndexedEntriesByPrimaryKey(
  index: IDBIndex,
  query: IDBValidKey | IDBKeyRange,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let deletedCount = 0
    const request = index.openKeyCursor(query)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(deletedCount)
        return
      }

      const deletion = index.objectStore.delete(cursor.primaryKey)
      deletion.onsuccess = () => {
        deletedCount += 1
        cursor.continue()
      }
      deletion.onerror = () => reject(deletion.error ?? new Error('IndexedDB deletion failed.'))
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor read failed.'))
  })
}

function formatIndexedDbKey(key: IDBValidKey): string {
  if (Array.isArray(key)) {
    return JSON.stringify(key)
  }
  if (key instanceof ArrayBuffer) {
    return `[ArrayBuffer ${key.byteLength}]`
  }
  if (ArrayBuffer.isView(key)) {
    return `[${key.constructor.name} ${key.byteLength}]`
  }
  return String(key)
}

function isIndexedDbConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'ConstraintError'
}

function topLevelArticleRepository(owner: IndexedDbLocalRepositories): ArticleRepository {
  const base = topLevelEntityRepository(owner, 'articles', scope => scope.articles)
  return {
    ...base,
    add: article => owner.transaction(['articles'], 'readwrite', scope =>
      scope.articles.add(article)),
  }
}

function topLevelAttemptRepository(owner: IndexedDbLocalRepositories): AttemptRepository {
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

function topLevelVocabularyTermRepository(owner: IndexedDbLocalRepositories): VocabularyTermRepository {
  const base = topLevelEntityRepository(owner, 'vocabularyTerms', scope => scope.vocabularyTerms)
  return {
    ...base,
    getByNormalizedTerm: normalizedTerm => owner.transaction(['vocabularyTerms'], 'readonly', scope =>
      scope.vocabularyTerms.getByNormalizedTerm(normalizedTerm)),
  }
}

function topLevelVocabularyContextRepository(owner: IndexedDbLocalRepositories): VocabularyContextRepository {
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

function topLevelEntityRepository<T extends { id: string }>(
  owner: IndexedDbLocalRepositories,
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

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

function keepTransactionAlive(transaction: IDBTransaction): () => void {
  const [storeName] = Array.from(transaction.objectStoreNames)
  if (!storeName) {
    return () => {}
  }

  // IndexedDB auto-commits when its request queue empties, even if the public
  // async transaction callback is still pending. Keep one harmless request queued
  // so a later callback failure can still abort every write atomically.
  const store = transaction.objectStore(storeName)
  let stopped = false
  const issueKeepAliveRequest = (): void => {
    if (stopped) {
      return
    }

    try {
      const request = store.count()
      request.onsuccess = issueKeepAliveRequest
      request.onerror = () => {
        stopped = true
      }
    }
    catch {
      stopped = true
    }
  }
  issueKeepAliveRequest()

  return () => {
    stopped = true
  }
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return values.sort((left, right) => left.id.localeCompare(right.id))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
