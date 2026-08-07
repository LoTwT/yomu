import type { PreferencesStore } from '@/platform/contracts'

const journalSchemaVersion = 2 as const
const journalSlotSchemaVersion = 3 as const
const aggregateSlotSchemaVersion = 2 as const
const legacyJournalSchemaVersion = 1 as const
const maxSupersededSources = 1_024
const journalKeyPrefix = 'reader-progress-journal:v3:'
const writerTombstoneKeyPrefix = 'reader-progress-journal-tombstone:v3:'
const aggregateJournalKeyPrefix = 'reader-progress-journal:v2:'
const legacyJournalKeyPrefix = 'reader-progress-journal:v1:'

export interface ReadingProgressSnapshot {
  articleId: string
  attemptId: string
  baseAttemptRevision: number
  cursorMutation: boolean
  currentSentenceId: string
  furthestSentenceOrdinal: number
  activeDurationSec: number
}

export interface ReadingProgressJournalDraft extends ReadingProgressSnapshot {
  writerId: string
  sequence: number
  writtenAt: string
  supersedes?: readonly ReadingProgressJournalSource[]
}

export interface ReadingProgressJournalSource {
  slotVersion: typeof aggregateSlotSchemaVersion | typeof journalSlotSchemaVersion
  key: string
  articleId: string
  attemptId: string
  writerId: string
  sequence: number
  epochId: string
  generation: number
}

export interface CurrentReadingProgressJournal extends ReadingProgressJournalDraft {
  schemaVersion: typeof journalSchemaVersion
  epochId: string
  generation: number
  sources?: readonly ReadingProgressJournalSource[]
}

export interface LegacyReadingProgressJournal {
  schemaVersion: typeof legacyJournalSchemaVersion
  articleId: string
  attemptId: string
  currentSentenceId: string
  activeDurationSec: number
}

export type ReadingProgressJournal =
  | CurrentReadingProgressJournal
  | LegacyReadingProgressJournal

interface StoredReadingProgressJournal extends ReadingProgressJournalDraft {}

interface WriterReadingProgressJournalSlot {
  schemaVersion: typeof journalSlotSchemaVersion
  epochId: string
  articleId: string
  attemptId: string
  writerId: string
  sequence: number
  generation: number
  journal: StoredReadingProgressJournal | null
}

interface WriterReadingProgressJournalTombstone {
  schemaVersion: typeof journalSlotSchemaVersion
  kind: 'writer-tombstone'
  articleId: string
  attemptId: string
  writerId: string
  sequence: number
  epochId: string
  generation: number
}

interface AggregateReadingProgressJournalSlot {
  schemaVersion: typeof aggregateSlotSchemaVersion
  epochId: string
  attemptId: string
  generation: number
  journal: StoredReadingProgressJournal | null
}

export interface ReadingProgressJournalMetadata {
  writerId: string
  sequence: number
  writtenAt?: string
}

export interface AdoptReadingProgressJournalResult {
  journal: CurrentReadingProgressJournal
  sourcesSettled: boolean
}

export class ReadingProgressJournalAttemptConflictError extends Error {
  constructor(readonly attemptId: string) {
    super(`Reading progress belongs to another active attempt, not ${attemptId}.`)
    this.name = 'ReadingProgressJournalAttemptConflictError'
  }
}

export function createReadingProgressJournalWriterId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `journal-writer:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

export function createReadingProgressJournal(
  snapshot: ReadingProgressSnapshot,
  metadata: ReadingProgressJournalMetadata,
): ReadingProgressJournalDraft {
  return {
    writerId: metadata.writerId,
    sequence: metadata.sequence,
    writtenAt: metadata.writtenAt ?? new Date().toISOString(),
    ...snapshot,
  }
}

export function readingProgressJournalOperationId(
  journal: ReadingProgressJournal | ReadingProgressJournalDraft,
): string {
  if ('schemaVersion' in journal
    && journal.schemaVersion === legacyJournalSchemaVersion) {
    return [
      'legacy-v1',
      journal.articleId,
      journal.attemptId,
      journal.currentSentenceId,
      journal.activeDurationSec,
    ].map(value => encodeURIComponent(String(value))).join(':')
  }
  return `${journal.writerId}:${journal.sequence}`
}

export async function storeReadingProgressJournal(
  preferences: PreferencesStore,
  journal: ReadingProgressJournalDraft,
): Promise<CurrentReadingProgressJournal> {
  const key = journalKey(journal.articleId, journal.writerId)
  assertWriterJournalIsNotRetired(
    await preferences.get<unknown>(writerTombstoneKey(
      journal.articleId,
      journal.writerId,
    )),
    journal,
  )
  const next = await preferences.update<WriterReadingProgressJournalSlot>(
    key,
    current => updateWriterJournalSlot(current, journal),
  )
  return requireStoredWriterJournal(next, key)
}

export function storeReadingProgressJournalImmediately(
  preferences: PreferencesStore,
  journal: ReadingProgressJournalDraft,
): CurrentReadingProgressJournal {
  const key = journalKey(journal.articleId, journal.writerId)
  assertWriterJournalIsNotRetired(
    preferences.getImmediately<unknown>(writerTombstoneKey(
      journal.articleId,
      journal.writerId,
    )),
    journal,
  )
  const next = preferences.updateImmediately<WriterReadingProgressJournalSlot>(
    key,
    current => updateWriterJournalSlot(current, journal),
  )
  return requireStoredWriterJournal(next, key)
}

export async function adoptReadingProgressJournal(
  preferences: PreferencesStore,
  recovered: CurrentReadingProgressJournal,
  metadata: ReadingProgressJournalMetadata,
): Promise<AdoptReadingProgressJournalResult> {
  const key = journalKey(recovered.articleId, metadata.writerId)
  const tombstoneValue = await preferences.get<unknown>(writerTombstoneKey(
    recovered.articleId,
    metadata.writerId,
  ))
  const tombstone = isWriterJournalTombstone(tombstoneValue)
    && tombstoneValue.articleId === recovered.articleId
    && tombstoneValue.attemptId === recovered.attemptId
    && tombstoneValue.writerId === metadata.writerId
    ? tombstoneValue
    : null
  if (isWriterJournalTombstone(tombstoneValue)
    && tombstoneValue.writerId === metadata.writerId
    && (tombstoneValue.articleId !== recovered.articleId
      || tombstoneValue.attemptId !== recovered.attemptId)) {
    throw new ReadingProgressJournalAttemptConflictError(recovered.attemptId)
  }
  const recoveredHighWater = Math.max(
    recovered.writerId === metadata.writerId ? recovered.sequence : 0,
    ...(recovered.sources ?? []).filter(source =>
      source.slotVersion === journalSlotSchemaVersion
      && source.writerId === metadata.writerId)
      .map(source => source.sequence),
  )
  const recoveredSources = recovered.sources?.length
    ? recovered.sources
    : fallbackSources(recovered)
  const supersedes = deduplicateSources([
    ...(recovered.supersedes ?? []),
    ...recoveredSources,
  ])
  if (supersedes.length > maxSupersededSources) {
    throw new Error('Reading progress journal supersession history is too large.')
  }
  const next = await preferences.update<WriterReadingProgressJournalSlot>(
    key,
    (current) => {
      const slot = isWriterJournalSlot(current) ? current : null
      if (slot && (slot.articleId !== recovered.articleId
        || slot.attemptId !== recovered.attemptId
        || slot.writerId !== metadata.writerId)) {
        throw new ReadingProgressJournalAttemptConflictError(recovered.attemptId)
      }
      const sequence = nextSequenceAfter(Math.max(
        metadata.sequence - 1,
        recoveredHighWater,
        tombstone?.sequence ?? 0,
        slot?.sequence ?? 0,
      ))
      return updateWriterJournalSlot(current, {
        ...toJournalDraft(recovered),
        writerId: metadata.writerId,
        sequence,
        writtenAt: metadata.writtenAt ?? new Date().toISOString(),
        supersedes,
      })
    },
  )
  const journal = requireStoredWriterJournal(next, key)
  return {
    journal,
    sourcesSettled: await settleJournalSources(preferences, recovered),
  }
}

export function writeReadingProgressJournal(
  preferences: PreferencesStore,
  snapshot: ReadingProgressSnapshot,
  metadata: ReadingProgressJournalMetadata = {
    writerId: createReadingProgressJournalWriterId(),
    sequence: 1,
  },
): Promise<CurrentReadingProgressJournal> {
  return storeReadingProgressJournal(
    preferences,
    createReadingProgressJournal(snapshot, metadata),
  )
}

export async function readReadingProgressJournal(
  preferences: PreferencesStore,
  articleId: string,
  attemptId: string,
  attemptRevision = 0,
): Promise<ReadingProgressJournal | null> {
  let aggregateJournal: ReadingProgressJournal | null = null
  try {
    aggregateJournal = await readAggregateProgressJournal(
      preferences,
      articleId,
      attemptId,
      attemptRevision,
    )
  }
  catch {}

  let fallbackLegacy: LegacyReadingProgressJournal | null = null
  let migratedAggregate: CurrentReadingProgressJournal | null = null
  if (aggregateJournal?.schemaVersion === legacyJournalSchemaVersion) {
    fallbackLegacy = aggregateJournal
  }
  else if (aggregateJournal) {
    try {
      migratedAggregate = await migrateAggregateJournal(preferences, aggregateJournal)
      await clearJournalSources(preferences, aggregateJournal).catch(() => {})
    }
    catch {
      migratedAggregate = aggregateJournal
    }
  }

  let writerJournals: CurrentReadingProgressJournal[] = []
  try {
    writerJournals = await readWriterJournals(preferences, articleId, attemptId)
  }
  catch {}
  if (migratedAggregate) {
    writerJournals.push(migratedAggregate)
  }

  const journals = deduplicateJournals(writerJournals)
  if (journals.length > 0) {
    return mergeWriterJournals(journals)
  }
  return fallbackLegacy
}

export async function clearReadingProgressJournal(
  preferences: PreferencesStore,
  expected: ReadingProgressJournal,
): Promise<void> {
  if (expected.schemaVersion === legacyJournalSchemaVersion) {
    await preferences.compareAndRemove(
      legacyJournalKey(expected.articleId),
      expected,
    )
    return
  }
  await clearJournalSources(preferences, expected)
}

export async function clearSelectedReadingProgressJournal(
  preferences: PreferencesStore,
  expected: ReadingProgressJournal,
): Promise<void> {
  if (expected.schemaVersion === legacyJournalSchemaVersion) {
    const removed = await preferences.compareAndRemove(
      legacyJournalKey(expected.articleId),
      expected,
    )
    if (!removed) {
      throw new Error('The selected legacy reading progress journal could not be retired.')
    }
    return
  }
  if (!await settleJournalSources(
    preferences,
    expected,
    selectedJournalSources(expected),
  )) {
    throw new Error('The selected reading progress journal could not be retired.')
  }
}

async function readAggregateProgressJournal(
  preferences: PreferencesStore,
  articleId: string,
  attemptId: string,
  attemptRevision: number,
): Promise<ReadingProgressJournal | null> {
  const key = aggregateJournalKey(articleId)
  const legacyKey = legacyJournalKey(articleId)
  const legacyValue = await preferences.get<unknown>(legacyKey)
  const legacyJournal = isLegacyReadingProgressJournal(legacyValue)
    && legacyValue.articleId === articleId
    && legacyValue.attemptId === attemptId
    ? legacyValue
    : null
  let migratedLegacy = false

  try {
    const slot = await preferences.update<AggregateReadingProgressJournalSlot>(
      key,
      (current) => {
        const currentSlot = isAggregateJournalSlot(current) ? current : null
        if (currentSlot?.attemptId === attemptId
          && (!currentSlot.journal || currentSlot.journal.articleId === articleId)) {
          if (!currentSlot.journal && legacyJournal && attemptRevision === 0) {
            migratedLegacy = true
            return writeAggregateJournalSlot(
              currentSlot,
              attemptId,
              migrateLegacyJournal(legacyJournal),
            )
          }
          return currentSlot
        }
        if (legacyJournal && attemptRevision === 0) {
          migratedLegacy = true
          return writeAggregateJournalSlot(
            null,
            attemptId,
            migrateLegacyJournal(legacyJournal),
          )
        }
        return createAggregateTombstone(attemptId)
      },
    )
    if (legacyValue !== null) {
      await preferences.compareAndRemove(legacyKey, legacyValue).catch(() => false)
    }
    if (!isAggregateJournalSlot(slot)
      || slot.attemptId !== attemptId
      || !slot.journal) {
      return null
    }
    return restoreAggregateJournal(slot, slot.journal, key)
  }
  catch {
    const current = await preferences.get<unknown>(key).catch(() => null)
    if (isAggregateJournalSlot(current) && current.attemptId === attemptId) {
      return current.journal
        ? restoreAggregateJournal(current, current.journal, key)
        : null
    }
    return attemptRevision === 0 && (migratedLegacy || legacyJournal)
      ? legacyJournal
      : null
  }
}

async function migrateAggregateJournal(
  preferences: PreferencesStore,
  aggregate: CurrentReadingProgressJournal,
): Promise<CurrentReadingProgressJournal | null> {
  const journal = toJournalDraft(aggregate)
  const key = journalKey(journal.articleId, journal.writerId)
  const tombstone = await preferences.get<unknown>(writerTombstoneKey(
    journal.articleId,
    journal.writerId,
  ))
  if (writerJournalIsRetired(tombstone, journal)) {
    return null
  }
  const next = await preferences.update<WriterReadingProgressJournalSlot>(
    key,
    (current) => {
      if (isWriterJournalSlot(current)) {
        return updateWriterJournalSlot(current, journal)
      }
      return {
        schemaVersion: journalSlotSchemaVersion,
        epochId: aggregate.epochId,
        articleId: journal.articleId,
        attemptId: journal.attemptId,
        writerId: journal.writerId,
        sequence: journal.sequence,
        generation: Math.max(1, aggregate.generation),
        journal,
      }
    },
  )
  if (!isWriterJournalSlot(next)) {
    throw new Error('Reading progress journal migration returned an invalid writer slot.')
  }
  return next.journal ? restoreWriterJournal(next, next.journal, key) : null
}

async function readWriterJournals(
  preferences: PreferencesStore,
  articleId: string,
  attemptId: string,
): Promise<CurrentReadingProgressJournal[]> {
  const [entries, tombstoneEntries] = await Promise.all([
    preferences.listByPrefix<unknown>(journalPrefix(articleId)),
    preferences.listByPrefix<unknown>(writerTombstonePrefix(articleId)),
  ])
  const tombstones = new Map<string, WriterReadingProgressJournalTombstone>()
  for (const { key, value } of tombstoneEntries) {
    if (isWriterJournalTombstone(value)
      && value.articleId === articleId
      && value.attemptId === attemptId
      && key === writerTombstoneKey(articleId, value.writerId)) {
      tombstones.set(value.writerId, value)
    }
  }
  return entries.flatMap(({ key, value }) => {
    if (!isWriterJournalSlot(value)
      || value.articleId !== articleId
      || value.attemptId !== attemptId
      || key !== journalKey(articleId, value.writerId)
      || !value.journal
      || (tombstones.get(value.writerId)?.sequence ?? -1) >= value.sequence) {
      return []
    }
    return [restoreWriterJournal(value, value.journal, key)]
  })
}

function deduplicateJournals(
  journals: readonly CurrentReadingProgressJournal[],
): CurrentReadingProgressJournal[] {
  const byOperation = new Map<string, CurrentReadingProgressJournal>()
  for (const journal of journals) {
    const operationId = readingProgressJournalOperationId(journal)
    const existing = byOperation.get(operationId)
    const journalIsWriterSlot = hasOwnWriterSource(journal)
    const existingIsWriterSlot = existing ? hasOwnWriterSource(existing) : false
    if (!existing || (journalIsWriterSlot && !existingIsWriterSlot)) {
      byOperation.set(operationId, journal)
    }
  }
  return [...byOperation.values()]
}

function hasOwnWriterSource(journal: CurrentReadingProgressJournal): boolean {
  return journal.sources?.some(source =>
    source.slotVersion === journalSlotSchemaVersion
    && source.key === journalKey(journal.articleId, journal.writerId)
    && source.writerId === journal.writerId
    && source.sequence === journal.sequence) ?? false
}

function mergeWriterJournals(
  journals: readonly CurrentReadingProgressJournal[],
): CurrentReadingProgressJournal {
  if (journals.length === 1) {
    return journals[0]!
  }
  const selected = selectJournalCandidate(journals)
  const sources = deduplicateSources(journals.flatMap(journal => journal.sources ?? []))
  return {
    schemaVersion: journalSchemaVersion,
    epochId: selected.epochId,
    generation: selected.generation,
    writerId: selected.writerId,
    sequence: selected.sequence,
    writtenAt: selected.writtenAt,
    articleId: selected.articleId,
    attemptId: selected.attemptId,
    baseAttemptRevision: selected.baseAttemptRevision,
    cursorMutation: selected.cursorMutation,
    currentSentenceId: selected.currentSentenceId,
    furthestSentenceOrdinal: Math.max(...journals.map(journal =>
      journal.furthestSentenceOrdinal)),
    activeDurationSec: Math.max(...journals.map(journal => journal.activeDurationSec)),
    ...(selected.supersedes?.length ? { supersedes: selected.supersedes } : {}),
    sources,
  }
}

function selectJournalCandidate(
  candidates: readonly CurrentReadingProgressJournal[],
): CurrentReadingProgressJournal {
  const supersededOperations = new Set<string>()
  for (const candidate of candidates) {
    for (const other of candidates) {
      if (candidate !== other && journalSupersedes(candidate, other)) {
        supersededOperations.add(readingProgressJournalOperationId(other))
      }
    }
  }
  const causalMaxima = candidates.filter(candidate =>
    !supersededOperations.has(readingProgressJournalOperationId(candidate)))
  const maxima = causalMaxima.length > 0 ? causalMaxima : candidates
  const cursorMaxima = maxima.filter(candidate => candidate.cursorMutation)
  return [...(cursorMaxima.length > 0 ? cursorMaxima : maxima)]
    .sort(compareJournalCandidates)[0]!
}

function compareJournalCandidates(
  left: CurrentReadingProgressJournal,
  right: CurrentReadingProgressJournal,
): number {
  if (left.writerId === right.writerId && left.sequence !== right.sequence) {
    return right.sequence - left.sequence
  }
  if (left.baseAttemptRevision !== right.baseAttemptRevision) {
    return right.baseAttemptRevision - left.baseAttemptRevision
  }
  return readingProgressJournalOperationId(right)
    .localeCompare(readingProgressJournalOperationId(left))
}

function journalSupersedes(
  candidate: CurrentReadingProgressJournal,
  other: CurrentReadingProgressJournal,
): boolean {
  return candidate.supersedes?.some(reference =>
    reference.writerId === other.writerId
    && reference.sequence === other.sequence) ?? false
}

function deduplicateSources(
  sources: readonly ReadingProgressJournalSource[],
): ReadingProgressJournalSource[] {
  const unique = new Map<string, ReadingProgressJournalSource>()
  for (const source of sources) {
    unique.set(sourceIdentity(source), source)
  }
  return [...unique.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function sourceIdentity(source: ReadingProgressJournalSource): string {
  return JSON.stringify([
    source.slotVersion,
    source.key,
    source.articleId,
    source.attemptId,
    source.epochId,
    source.generation,
    source.writerId,
    source.sequence,
  ])
}


async function clearJournalSources(
  preferences: PreferencesStore,
  expected: CurrentReadingProgressJournal,
): Promise<void> {
  if (!await settleJournalSources(preferences, expected)) {
    throw new Error('Reading progress journal sources could not all be retired.')
  }
}

async function settleJournalSources(
  preferences: PreferencesStore,
  expected: CurrentReadingProgressJournal,
  sourceOverride?: readonly ReadingProgressJournalSource[],
): Promise<boolean> {
  const sources = sourceOverride?.length
    ? sourceOverride
    : expected.sources?.length
    ? expected.sources
    : fallbackSources(expected)
  const carrier = sources.find(source =>
    source.slotVersion === journalSlotSchemaVersion
    && source.key === journalKey(expected.articleId, expected.writerId)
    && source.writerId === expected.writerId
    && source.sequence === expected.sequence)
    ?? sources.find(source =>
      source.writerId === expected.writerId
      && source.sequence === expected.sequence
      && source.epochId === expected.epochId
      && source.generation === expected.generation)
  let settled = true
  for (const source of sources.filter(source => source !== carrier)) {
    try {
      await clearJournalSource(preferences, source)
    }
    catch {
      settled = false
    }
  }
  if (settled && carrier) {
    try {
      await clearJournalSource(preferences, carrier)
    }
    catch {
      settled = false
    }
  }
  return settled
}

function selectedJournalSources(
  expected: CurrentReadingProgressJournal,
): ReadingProgressJournalSource[] {
  const availableSources = expected.sources?.length
    ? expected.sources
    : fallbackSources(expected)
  const causalSources = expected.supersedes ?? []
  const causalIdentities = new Set(causalSources.map(sourceIdentity))
  return deduplicateSources([
    ...causalSources,
    ...availableSources.filter(source => (
      source.writerId === expected.writerId
      && source.sequence === expected.sequence
    ) || causalIdentities.has(sourceIdentity(source))),
  ])
}

function clearJournalSource(
  preferences: PreferencesStore,
  source: ReadingProgressJournalSource,
): Promise<void> {
  return source.slotVersion === journalSlotSchemaVersion
    ? clearWriterJournalSource(preferences, source)
    : clearAggregateJournalSource(preferences, source)
}

async function clearWriterJournalSource(
  preferences: PreferencesStore,
  expected: ReadingProgressJournalSource,
): Promise<void> {
  const key = writerTombstoneKey(expected.articleId, expected.writerId)
  await preferences.update<WriterReadingProgressJournalTombstone>(
    key,
    (current) => {
      const tombstone = isWriterJournalTombstone(current) ? current : null
      if (tombstone && (tombstone.articleId !== expected.articleId
        || tombstone.attemptId !== expected.attemptId
        || tombstone.writerId !== expected.writerId)) {
        throw new ReadingProgressJournalAttemptConflictError(expected.attemptId)
      }
      if (tombstone && tombstone.sequence >= expected.sequence) {
        return tombstone
      }
      return {
        schemaVersion: journalSlotSchemaVersion,
        kind: 'writer-tombstone',
        articleId: expected.articleId,
        attemptId: expected.attemptId,
        writerId: expected.writerId,
        sequence: expected.sequence,
        epochId: expected.epochId,
        generation: expected.generation,
      }
    },
  )
}

async function clearAggregateJournalSource(
  preferences: PreferencesStore,
  expected: ReadingProgressJournalSource,
): Promise<void> {
  await preferences.update<AggregateReadingProgressJournalSlot>(
    expected.key,
    (current) => {
      if (!isAggregateJournalSlot(current)
        || current.epochId !== expected.epochId
        || current.generation !== expected.generation
        || !current.journal
        || current.journal.writerId !== expected.writerId
        || current.journal.sequence !== expected.sequence) {
        return isAggregateJournalSlot(current) ? current : null
      }
      return { ...current, journal: null }
    },
  )
}

function fallbackSources(
  expected: CurrentReadingProgressJournal,
): ReadingProgressJournalSource[] {
  const base = {
    articleId: expected.articleId,
    attemptId: expected.attemptId,
    writerId: expected.writerId,
    sequence: expected.sequence,
    epochId: expected.epochId,
    generation: expected.generation,
  }
  return [
    {
      ...base,
      slotVersion: journalSlotSchemaVersion,
      key: journalKey(expected.articleId, expected.writerId),
    },
    {
      ...base,
      slotVersion: aggregateSlotSchemaVersion,
      key: aggregateJournalKey(expected.articleId),
    },
  ]
}

function updateWriterJournalSlot(
  current: unknown | null,
  journal: ReadingProgressJournalDraft,
): WriterReadingProgressJournalSlot {
  const slot = isWriterJournalSlot(current) ? current : null
  if (slot && (slot.attemptId !== journal.attemptId
    || slot.articleId !== journal.articleId
    || slot.writerId !== journal.writerId)) {
    throw new ReadingProgressJournalAttemptConflictError(journal.attemptId)
  }
  if (slot && slot.sequence >= journal.sequence) {
    return slot
  }
  const generationOverflowed = slot?.generation === Number.MAX_SAFE_INTEGER
  const epochId = !slot || generationOverflowed
    ? createReadingProgressJournalWriterId()
    : slot.epochId
  return {
    schemaVersion: journalSlotSchemaVersion,
    epochId,
    articleId: journal.articleId,
    attemptId: journal.attemptId,
    writerId: journal.writerId,
    sequence: journal.sequence,
    generation: nextGeneration(slot?.generation),
    journal: mergeDurationCheckpoint(slot?.journal ?? null, journal),
  }
}

function requireStoredWriterJournal(
  value: WriterReadingProgressJournalSlot | null,
  key: string,
): CurrentReadingProgressJournal {
  if (!isWriterJournalSlot(value) || !value.journal) {
    throw new Error('Reading progress journal storage returned an invalid writer slot.')
  }
  return restoreWriterJournal(value, value.journal, key)
}

function mergeDurationCheckpoint(
  current: StoredReadingProgressJournal | null,
  incoming: ReadingProgressJournalDraft,
): StoredReadingProgressJournal {
  const supersedes = deduplicateSources([
    ...(current?.supersedes ?? []),
    ...(incoming.supersedes ?? []),
  ])
  if (incoming.cursorMutation
    || !current?.cursorMutation
    || incoming.baseAttemptRevision !== current.baseAttemptRevision) {
    return {
      ...incoming,
      ...(supersedes.length > 0 ? { supersedes } : {}),
      furthestSentenceOrdinal: Math.max(
        current?.furthestSentenceOrdinal ?? 0,
        incoming.furthestSentenceOrdinal,
      ),
      activeDurationSec: Math.max(
        current?.activeDurationSec ?? 0,
        incoming.activeDurationSec,
      ),
    }
  }
  return {
    ...incoming,
    ...(supersedes.length > 0 ? { supersedes } : {}),
    baseAttemptRevision: current.baseAttemptRevision,
    cursorMutation: true,
    currentSentenceId: current.currentSentenceId,
    furthestSentenceOrdinal: Math.max(
      current.furthestSentenceOrdinal,
      incoming.furthestSentenceOrdinal,
    ),
    activeDurationSec: Math.max(
      current.activeDurationSec,
      incoming.activeDurationSec,
    ),
  }
}

function createAggregateTombstone(attemptId: string): AggregateReadingProgressJournalSlot {
  return {
    schemaVersion: aggregateSlotSchemaVersion,
    epochId: createReadingProgressJournalWriterId(),
    attemptId,
    generation: 0,
    journal: null,
  }
}

function writeAggregateJournalSlot(
  current: AggregateReadingProgressJournalSlot | null,
  attemptId: string,
  journal: StoredReadingProgressJournal,
): AggregateReadingProgressJournalSlot {
  const generationOverflowed = current?.generation === Number.MAX_SAFE_INTEGER
  return {
    schemaVersion: aggregateSlotSchemaVersion,
    epochId: !current || generationOverflowed
      ? createReadingProgressJournalWriterId()
      : current.epochId,
    attemptId,
    generation: nextGeneration(current?.generation),
    journal,
  }
}

function migrateLegacyJournal(
  legacy: LegacyReadingProgressJournal,
): StoredReadingProgressJournal {
  return {
    writerId: `legacy-v1:${createReadingProgressJournalWriterId()}`,
    sequence: 1,
    writtenAt: new Date().toISOString(),
    articleId: legacy.articleId,
    attemptId: legacy.attemptId,
    baseAttemptRevision: 0,
    cursorMutation: true,
    currentSentenceId: legacy.currentSentenceId,
    furthestSentenceOrdinal: 0,
    activeDurationSec: legacy.activeDurationSec,
  }
}

function restoreWriterJournal(
  slot: WriterReadingProgressJournalSlot,
  journal: StoredReadingProgressJournal,
  key: string,
): CurrentReadingProgressJournal {
  const source = journalSource(journalSlotSchemaVersion, key, slot, journal)
  return {
    schemaVersion: journalSchemaVersion,
    epochId: slot.epochId,
    generation: slot.generation,
    ...journal,
    sources: deduplicateSources([source, ...(journal.supersedes ?? [])]),
  }
}

function restoreAggregateJournal(
  slot: AggregateReadingProgressJournalSlot,
  journal: StoredReadingProgressJournal,
  key: string,
): CurrentReadingProgressJournal {
  const source = journalSource(aggregateSlotSchemaVersion, key, slot, journal)
  return {
    schemaVersion: journalSchemaVersion,
    epochId: slot.epochId,
    generation: slot.generation,
    ...journal,
    sources: deduplicateSources([source, ...(journal.supersedes ?? [])]),
  }
}

function journalSource(
  slotVersion: ReadingProgressJournalSource['slotVersion'],
  key: string,
  slot: { epochId: string, generation: number, attemptId: string },
  journal: StoredReadingProgressJournal,
): ReadingProgressJournalSource {
  return {
    slotVersion,
    key,
    articleId: journal.articleId,
    attemptId: slot.attemptId,
    writerId: journal.writerId,
    sequence: journal.sequence,
    epochId: slot.epochId,
    generation: slot.generation,
  }
}

function toJournalDraft(journal: CurrentReadingProgressJournal): ReadingProgressJournalDraft {
  const {
    schemaVersion: _schemaVersion,
    epochId: _epochId,
    generation: _generation,
    sources: _sources,
    ...draft
  } = journal
  return draft
}

function nextGeneration(current?: number): number {
  return current === undefined || current >= Number.MAX_SAFE_INTEGER
    ? 1
    : current + 1
}

function nextSequenceAfter(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Reading progress journal writer sequence is exhausted.')
  }
  return current + 1
}

function journalPrefix(articleId: string): string {
  return `${journalKeyPrefix}${encodeURIComponent(articleId)}:`
}

function journalKey(articleId: string, writerId: string): string {
  return `${journalPrefix(articleId)}${encodeURIComponent(writerId)}`
}

function writerTombstonePrefix(articleId: string): string {
  return `${writerTombstoneKeyPrefix}${encodeURIComponent(articleId)}:`
}

function writerTombstoneKey(articleId: string, writerId: string): string {
  return `${writerTombstonePrefix(articleId)}${encodeURIComponent(writerId)}`
}

function aggregateJournalKey(articleId: string): string {
  return `${aggregateJournalKeyPrefix}${encodeURIComponent(articleId)}`
}

function legacyJournalKey(articleId: string): string {
  return `${legacyJournalKeyPrefix}${encodeURIComponent(articleId)}`
}

function isWriterJournalSlot(value: unknown): value is WriterReadingProgressJournalSlot {
  if (!isRecord(value)) {
    return false
  }
  if (value.schemaVersion !== journalSlotSchemaVersion
    || !isBoundedId(value.epochId)
    || !isBoundedId(value.articleId)
    || !isBoundedId(value.attemptId)
    || !isBoundedId(value.writerId)
    || !isNonNegativeSafeInteger(value.sequence)
    || !isNonNegativeSafeInteger(value.generation)
    || (value.journal !== null && !isStoredReadingProgressJournal(value.journal))) {
    return false
  }
  return value.journal === null || (
    value.sequence === value.journal.sequence
    && value.articleId === value.journal.articleId
    && value.attemptId === value.journal.attemptId
    && value.writerId === value.journal.writerId
  )
}

function isWriterJournalTombstone(
  value: unknown,
): value is WriterReadingProgressJournalTombstone {
  if (!isRecord(value)) {
    return false
  }
  return value.schemaVersion === journalSlotSchemaVersion
    && value.kind === 'writer-tombstone'
    && isBoundedId(value.articleId)
    && isBoundedId(value.attemptId)
    && isBoundedId(value.writerId)
    && isPositiveSafeInteger(value.sequence)
    && isBoundedId(value.epochId)
    && isNonNegativeSafeInteger(value.generation)
}

function writerJournalIsRetired(
  tombstone: unknown,
  journal: ReadingProgressJournalDraft,
): boolean {
  return isWriterJournalTombstone(tombstone)
    && tombstone.articleId === journal.articleId
    && tombstone.attemptId === journal.attemptId
    && tombstone.writerId === journal.writerId
    && tombstone.sequence >= journal.sequence
}

function assertWriterJournalIsNotRetired(
  tombstone: unknown,
  journal: ReadingProgressJournalDraft,
): void {
  if (isWriterJournalTombstone(tombstone)
    && tombstone.writerId === journal.writerId
    && (tombstone.articleId !== journal.articleId
      || tombstone.attemptId !== journal.attemptId)) {
    throw new ReadingProgressJournalAttemptConflictError(journal.attemptId)
  }
  if (writerJournalIsRetired(tombstone, journal)) {
    throw new Error('Reading progress journal storage returned an invalid writer slot.')
  }
}

function isAggregateJournalSlot(value: unknown): value is AggregateReadingProgressJournalSlot {
  if (!isRecord(value)) {
    return false
  }
  return value.schemaVersion === aggregateSlotSchemaVersion
    && isBoundedId(value.epochId)
    && isBoundedId(value.attemptId)
    && isNonNegativeSafeInteger(value.generation)
    && (value.journal === null || isStoredReadingProgressJournal(value.journal))
}

function isStoredReadingProgressJournal(
  value: unknown,
): value is StoredReadingProgressJournal {
  if (!isRecord(value)) {
    return false
  }
  return isBoundedId(value.writerId)
    && isPositiveSafeInteger(value.sequence)
    && isIsoDate(value.writtenAt)
    && isBoundedId(value.articleId)
    && isBoundedId(value.attemptId)
    && isNonNegativeSafeInteger(value.baseAttemptRevision)
    && typeof value.cursorMutation === 'boolean'
    && isBoundedId(value.currentSentenceId)
    && isNonNegativeSafeInteger(value.furthestSentenceOrdinal)
    && isNonNegativeSafeInteger(value.activeDurationSec)
    && (value.supersedes === undefined || (
      isJournalSources(value.supersedes)
      && value.supersedes.every(source =>
        source.articleId === value.articleId
        && source.attemptId === value.attemptId)
    ))
}

function isJournalSources(
  value: unknown,
): value is readonly ReadingProgressJournalSource[] {
  return Array.isArray(value)
    && value.length <= maxSupersededSources
    && value.every(source => isRecord(source)
      && (source.slotVersion === aggregateSlotSchemaVersion
        || source.slotVersion === journalSlotSchemaVersion)
      && isStorageKey(source.key)
      && isBoundedId(source.articleId)
      && isBoundedId(source.attemptId)
      && isBoundedId(source.writerId)
      && isPositiveSafeInteger(source.sequence)
      && isBoundedId(source.epochId)
      && isNonNegativeSafeInteger(source.generation)
      && source.key === (source.slotVersion === journalSlotSchemaVersion
        ? journalKey(source.articleId as string, source.writerId as string)
        : aggregateJournalKey(source.articleId as string)))
}

function isLegacyReadingProgressJournal(
  value: unknown,
): value is LegacyReadingProgressJournal {
  if (!isRecord(value)) {
    return false
  }
  return value.schemaVersion === legacyJournalSchemaVersion
    && isBoundedId(value.articleId)
    && isBoundedId(value.attemptId)
    && isBoundedId(value.currentSentenceId)
    && isNonNegativeSafeInteger(value.activeDurationSec)
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
}

function isStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 16_384
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
