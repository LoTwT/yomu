export const YOMU_DATABASE_NAME = 'yomu-v2'
export const YOMU_INDEXED_DB_VERSION = 1

export const yomuObjectStoreNames = {
  articles: 'articles',
  attempts: 'attempts',
  vocabularyTerms: 'vocabularyTerms',
  vocabularyContexts: 'vocabularyContexts',
  meta: 'meta',
} as const

export type YomuObjectStoreName = typeof yomuObjectStoreNames[keyof typeof yomuObjectStoreNames]

export function openYomuIndexedDb(
  factory: IDBFactory,
  databaseName = YOMU_DATABASE_NAME,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, YOMU_INDEXED_DB_VERSION)
    request.onupgradeneeded = () => configureSchema(request.result, request.transaction)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open the Yomu database.'))
    request.onblocked = () => reject(new Error('The Yomu database upgrade is blocked by another tab.'))
  })
}

function configureSchema(database: IDBDatabase, transaction: IDBTransaction | null): void {
  const articles = ensureStore(database, transaction, yomuObjectStoreNames.articles)
  ensureIndex(articles, 'byUpdatedAt', 'updatedAt')

  const attempts = ensureStore(database, transaction, yomuObjectStoreNames.attempts)
  ensureIndex(attempts, 'byArticleId', 'articleId')
  ensureIndex(attempts, 'byLastOpenedAt', 'lastOpenedAt')
  ensureIndex(attempts, 'byArticleStatus', ['articleId', 'status'])

  const terms = ensureStore(database, transaction, yomuObjectStoreNames.vocabularyTerms)
  ensureIndex(terms, 'byNormalizedTerm', 'normalizedTerm', { unique: true })

  const contexts = ensureStore(database, transaction, yomuObjectStoreNames.vocabularyContexts)
  ensureIndex(contexts, 'byTermId', 'termId')
  ensureIndex(contexts, 'byArticleId', 'articleId')
  ensureIndex(contexts, 'byTermArticleSentence', ['termId', 'articleId', 'sentenceId'], { unique: true })

  ensureStore(database, transaction, yomuObjectStoreNames.meta)
}

function ensureStore(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
  name: YomuObjectStoreName,
): IDBObjectStore {
  if (!database.objectStoreNames.contains(name)) {
    return database.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' })
  }
  if (!transaction) {
    throw new Error(`Missing upgrade transaction for object store ${name}.`)
  }
  return transaction.objectStore(name)
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters,
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options)
  }
}
