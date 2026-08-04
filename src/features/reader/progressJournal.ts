import type { PreferencesStore } from '@/platform/contracts'

const journalSchemaVersion = 1 as const
const journalKeyPrefix = 'reader-progress-journal:v1:'

export interface ReadingProgressJournal {
  schemaVersion: typeof journalSchemaVersion
  articleId: string
  attemptId: string
  currentSentenceId: string
  activeDurationSec: number
}

export type ReadingProgressSnapshot = Omit<ReadingProgressJournal, 'schemaVersion'>

export function writeReadingProgressJournal(
  preferences: PreferencesStore,
  snapshot: ReadingProgressSnapshot,
): Promise<ReadingProgressJournal> {
  const journal = {
    schemaVersion: journalSchemaVersion,
    ...snapshot,
  } satisfies ReadingProgressJournal
  return preferences.set(journalKey(snapshot.articleId), journal)
    .then(() => journal)
}

export async function readReadingProgressJournal(
  preferences: PreferencesStore,
  articleId: string,
): Promise<ReadingProgressJournal | null> {
  const value = await preferences.get<unknown>(journalKey(articleId))
  if (value === null) {
    return null
  }
  if (isReadingProgressJournal(value) && value.articleId === articleId) {
    return value
  }

  await preferences.remove(journalKey(articleId)).catch(() => {})
  return null
}

export async function clearReadingProgressJournal(
  preferences: PreferencesStore,
  expected: ReadingProgressJournal,
): Promise<void> {
  const current = await preferences.get<unknown>(journalKey(expected.articleId))
  if (!isReadingProgressJournal(current) || !sameProgress(current, expected)) {
    return
  }
  await preferences.remove(journalKey(expected.articleId))
}

export function removeReadingProgressJournal(
  preferences: PreferencesStore,
  articleId: string,
): Promise<void> {
  return preferences.remove(journalKey(articleId))
}

function journalKey(articleId: string): string {
  return `${journalKeyPrefix}${encodeURIComponent(articleId)}`
}

function isReadingProgressJournal(value: unknown): value is ReadingProgressJournal {
  if (!isRecord(value)) {
    return false
  }
  return value.schemaVersion === journalSchemaVersion
    && isBoundedId(value.articleId)
    && isBoundedId(value.attemptId)
    && isBoundedId(value.currentSentenceId)
    && typeof value.activeDurationSec === 'number'
    && Number.isSafeInteger(value.activeDurationSec)
    && value.activeDurationSec >= 0
}

function sameProgress(
  left: ReadingProgressJournal,
  right: ReadingProgressJournal,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.articleId === right.articleId
    && left.attemptId === right.attemptId
    && left.currentSentenceId === right.currentSentenceId
    && left.activeDurationSec === right.activeDurationSec
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
