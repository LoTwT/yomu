import {
  DataConstraintError,
  DataReadonlyTransactionError,
  type DataStoreName,
  type RepositoryMode,
} from './repositories'

const mutationOperations = new Set(['put', 'delete', 'deleteByArticle', 'clear'])

export function guardTransactionRepository<T extends object>(
  store: DataStoreName,
  repository: T,
  allowedStores: ReadonlySet<DataStoreName>,
  mode: RepositoryMode,
): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (!allowedStores.has(store)) {
        throw new DataConstraintError(`Store ${store} was not declared for this transaction.`)
      }

      if (mode === 'readonly'
        && typeof property === 'string'
        && mutationOperations.has(property)) {
        const operation = property as 'put' | 'delete' | 'deleteByArticle' | 'clear'
        return async (): Promise<never> => {
          throw new DataReadonlyTransactionError(store, operation)
        }
      }

      return Reflect.get(target, property, receiver)
    },
  })
}
