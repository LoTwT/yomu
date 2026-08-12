import type { PreferencesStore } from '@/platform/contracts'

const journalSchemaVersion = 2 as const
const journalSlotSchemaVersion = 3 as const
const journalOperationSlotSchemaVersion = 4 as const
const aggregateSlotSchemaVersion = 2 as const
const legacyJournalSchemaVersion = 1 as const
const maxStoredSupersededSources = 1_024
const maxStoredWriterGapLineages = 1_024
const maxRuntimeCausalClosureLineages = maxStoredSupersededSources
  + maxStoredWriterGapLineages
const maxExpandedJournalSources = maxStoredSupersededSources + 1
const maxCompactedWriterSlotsPerRun = 16
const supersededWriterPruneDeadlineMs = 25
const journalKeyPrefix = 'reader-progress-journal:v3:'
const journalOperationKeyPrefix = 'reader-progress-journal:v4:'
const writerTombstoneKeyPrefix = 'reader-progress-journal-tombstone:v3:'
const retiredArticleKeyPrefix = 'reader-progress-journal-retired-article:v1:'
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

export interface ReadingProgressJournalWriterGapLineage {
  writerId: string
  sequence: number
}

export interface ReadingProgressJournalDraft extends ReadingProgressSnapshot {
  writerId: string
  sequence: number
  writtenAt: string
  writerSequenceHighWater?: number
  writerSequenceHasGap?: true
  writerGapLineages?: readonly ReadingProgressJournalWriterGapLineage[]
  supersedes?: readonly ReadingProgressJournalSource[]
}

export interface ReadingProgressJournalSource {
  slotVersion:
    | typeof aggregateSlotSchemaVersion
    | typeof journalSlotSchemaVersion
    | typeof journalOperationSlotSchemaVersion
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
  /** Runtime-only closure roots from the candidate selected during a synthetic merge. */
  selectedCausalClosureLineages?: readonly ReadingProgressJournalWriterGapLineage[]
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

interface WriterReadingProgressJournalOperationSlot {
  schemaVersion: typeof journalOperationSlotSchemaVersion
  epochId: string
  articleId: string
  attemptId: string
  writerId: string
  sequence: number
  generation: number
  journal: StoredReadingProgressJournal
}

interface WriterReadingProgressJournalTombstone {
  schemaVersion: typeof journalSlotSchemaVersion
  kind: 'writer-tombstone'
  articleId: string
  attemptId: string
  writerId: string
  sequence: number
  causalClosureSequence?: number
  epochId: string
  generation: number
}

interface RetiredReadingProgressArticle {
  schemaVersion: 1
  kind: 'retired-reading-progress-article'
  articleId: string
}

interface AggregateReadingProgressJournalSlot {
  schemaVersion: typeof aggregateSlotSchemaVersion
  epochId: string
  attemptId: string
  generation: number
  journal: StoredReadingProgressJournal | null
}

interface ReadingProgressJournalSettlementOverrides {
  sources: readonly ReadingProgressJournalSource[]
  causalClosureLineages: readonly ReadingProgressJournalWriterGapLineage[]
}

interface WriterGapCausalReadIndex {
  operationJournalsByWriter: ReadonlyMap<
    string,
    readonly StoredReadingProgressJournal[]
  >
  legacyJournalsByWriter: ReadonlyMap<
    string,
    readonly StoredReadingProgressJournal[]
  >
  tombstonesByWriter: ReadonlyMap<string, WriterReadingProgressJournalTombstone>
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

export interface CompactReadingProgressJournalSlotsOptions {
  maxRemovals?: number
}

export class ReadingProgressJournalAttemptConflictError extends Error {
  constructor(readonly attemptId: string) {
    super(`Reading progress belongs to another active attempt, not ${attemptId}.`)
    this.name = 'ReadingProgressJournalAttemptConflictError'
  }
}

export class ReadingProgressJournalArticleRetiredError extends Error {
  constructor(readonly articleId: string) {
    super(`Reading progress cannot be written for retired article ${articleId}.`)
    this.name = 'ReadingProgressJournalArticleRetiredError'
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
  const key = journalOperationKey(
    journal.articleId,
    journal.writerId,
    journal.sequence,
  )
  const tombstoneKey = writerTombstoneKey(journal.articleId, journal.writerId)
  const previousKey = previousJournalOperationKey(journal)
  const [tombstone, previousValue, legacyValue] = await Promise.all([
    preferences.get<unknown>(tombstoneKey),
    previousKey ? preferences.get<unknown>(previousKey) : Promise.resolve(null),
    preferences.get<unknown>(journalKey(journal.articleId, journal.writerId)),
  ])
  assertWriterJournalIsNotRetired(
    tombstone,
    journal,
  )
  const prepared = prepareWriterJournalOperation(
    journal,
    tombstone,
    previousKey,
    previousValue,
    legacyValue,
  )
  const next = await updateActiveArticleJournal<WriterReadingProgressJournalOperationSlot>(
    preferences,
    journal.articleId,
    key,
    current => updateWriterJournalOperationSlot(current, prepared),
  )
  const stored = requireStoredWriterJournalOperation(next, key)
  await waitForSupersededWriterPrune(
    prunePreviousWriterOperation(
      preferences,
      stored,
      previousKey,
      previousValue,
    ),
  )
  return stored
}

export function storeReadingProgressJournalImmediately(
  preferences: PreferencesStore,
  journal: ReadingProgressJournalDraft,
): CurrentReadingProgressJournal {
  const key = journalOperationKey(
    journal.articleId,
    journal.writerId,
    journal.sequence,
  )
  const tombstoneKey = writerTombstoneKey(journal.articleId, journal.writerId)
  const tombstone = preferences.getImmediately<unknown>(tombstoneKey)
  assertWriterJournalIsNotRetired(
    tombstone,
    journal,
  )
  const previousKey = previousJournalOperationKey(journal)
  const prepared = prepareWriterJournalOperation(
    journal,
    tombstone,
    previousKey,
    previousKey ? preferences.getImmediately<unknown>(previousKey) : null,
    preferences.getImmediately<unknown>(journalKey(
      journal.articleId,
      journal.writerId,
    )),
  )
  const next = updateActiveArticleJournalImmediately<WriterReadingProgressJournalOperationSlot>(
    preferences,
    journal.articleId,
    key,
    current => updateWriterJournalOperationSlot(current, prepared),
  )
  const stored = requireStoredWriterJournalOperation(next, key)
  return stored
}

export async function adoptReadingProgressJournal(
  preferences: PreferencesStore,
  recovered: CurrentReadingProgressJournal,
  metadata: ReadingProgressJournalMetadata,
): Promise<AdoptReadingProgressJournalResult> {
  const [tombstoneValue, operationEntries, legacySlotValue] = await Promise.all([
    preferences.get<unknown>(writerTombstoneKey(
      recovered.articleId,
      metadata.writerId,
    )),
    preferences.listByPrefix<unknown>(journalOperationWriterPrefix(
      recovered.articleId,
      metadata.writerId,
    )),
    preferences.get<unknown>(journalKey(recovered.articleId, metadata.writerId)),
  ])
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
      isWriterJournalSource(source)
      && source.writerId === metadata.writerId)
      .map(source => source.sequence),
  )
  const legacySlot = isWriterJournalSlot(legacySlotValue)
    ? legacySlotValue
    : null
  if (legacySlot && (legacySlot.articleId !== recovered.articleId
    || legacySlot.attemptId !== recovered.attemptId
    || legacySlot.writerId !== metadata.writerId)) {
    throw new ReadingProgressJournalAttemptConflictError(recovered.attemptId)
  }
  let operationHighWater = 0
  for (const { key, value } of operationEntries) {
    if (!isWriterJournalOperationSlot(value)
      || value.articleId !== recovered.articleId
      || value.writerId !== metadata.writerId
      || key !== journalOperationKey(
        recovered.articleId,
        metadata.writerId,
        value.sequence,
      )) {
      continue
    }
    if (value.attemptId !== recovered.attemptId) {
      throw new ReadingProgressJournalAttemptConflictError(recovered.attemptId)
    }
    operationHighWater = Math.max(operationHighWater, value.sequence)
  }
  const recoveredSources = recovered.sources?.length
    ? recovered.sources
    : fallbackSources(recovered)
  const supersedes = deduplicateSources([
    ...(recovered.supersedes ?? []),
    ...recoveredSources,
  ])
  if (supersedes.length > maxStoredSupersededSources) {
    throw new Error('Reading progress journal supersession history is too large.')
  }
  const sequence = nextSequenceAfter(Math.max(
    metadata.sequence - 1,
    recoveredHighWater,
    tombstone?.sequence ?? 0,
    legacySlot?.sequence ?? 0,
    operationHighWater,
  ))
  const key = journalOperationKey(
    recovered.articleId,
    metadata.writerId,
    sequence,
  )
  const previousKey = sequence > 1
    ? journalOperationKey(recovered.articleId, metadata.writerId, sequence - 1)
    : null
  const previousValue = previousKey
    ? operationEntries.find(entry => entry.key === previousKey)?.value ?? null
    : null
  const prepared = prepareWriterJournalOperation(
    {
      ...toJournalDraft(recovered),
      writerId: metadata.writerId,
      sequence,
      writtenAt: metadata.writtenAt ?? new Date().toISOString(),
      writerSequenceHighWater: recovered.writerId === metadata.writerId
        ? recovered.writerSequenceHighWater
        : undefined,
      writerSequenceHasGap: recovered.writerId === metadata.writerId
        ? recovered.writerSequenceHasGap
        : undefined,
      writerGapLineages: journalWriterGapLineages(recovered),
      supersedes,
    },
    tombstoneValue,
    previousKey,
    previousValue,
    legacySlotValue,
  )
  const next = await updateActiveArticleJournal<WriterReadingProgressJournalOperationSlot>(
    preferences,
    recovered.articleId,
    key,
    current => updateWriterJournalOperationSlot(current, prepared),
  )
  const journal = requireStoredWriterJournalOperation(next, key)
  await waitForSupersededWriterPrune(
    prunePreviousWriterOperation(
      preferences,
      journal,
      previousKey,
      previousValue,
    ),
  )
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
  if (await readingProgressArticleIsRetired(preferences, articleId)) {
    return null
  }
  const aggregateJournal = await readAggregateProgressJournal(
    preferences,
    articleId,
    attemptId,
    attemptRevision,
  )

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
      if (await readingProgressArticleIsRetired(preferences, articleId)) {
        return null
      }
      migratedAggregate = aggregateJournal
    }
  }

  if (await readingProgressArticleIsRetired(preferences, articleId)) {
    return null
  }

  const {
    journals: writerJournals,
    causalIndex,
  } = await readWriterJournals(preferences, articleId, attemptId)
  if (migratedAggregate) {
    writerJournals.push(migratedAggregate)
  }

  const journals = await Promise.all(deduplicateJournals(writerJournals)
    .map(journal => expandWriterGapCausalHistory(
      preferences,
      journal,
      causalIndex,
    )))
  if (journals.length > 0) {
    return await readingProgressArticleIsRetired(preferences, articleId)
      ? null
      : mergeWriterJournals(journals)
  }
  return await readingProgressArticleIsRetired(preferences, articleId)
    ? null
    : fallbackLegacy
}

export async function clearReadingProgressJournal(
  preferences: PreferencesStore,
  expected: ReadingProgressJournal,
): Promise<void> {
  if (await readingProgressArticleIsRetired(preferences, expected.articleId)) {
    return
  }
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
  if (await readingProgressArticleIsRetired(preferences, expected.articleId)) {
    return
  }
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
  const sources = selectedJournalSources(expected)
  if (!await settleJournalSources(
    preferences,
    expected,
    {
      sources,
      causalClosureLineages: expected.selectedCausalClosureLineages
        ?? journalCausalClosureLineages(expected),
    },
  )) {
    throw new Error('The selected reading progress journal could not be retired.')
  }
}

export async function retireReadingProgressJournalsForArticle(
  preferences: PreferencesStore,
  articleId: string,
): Promise<void> {
  await markReadingProgressArticleRetired(preferences, articleId)
  await clearRetiredReadingProgressJournals(preferences, articleId)
}

export async function markReadingProgressArticleRetired(
  preferences: PreferencesStore,
  articleId: string,
): Promise<void> {
  if (!isBoundedId(articleId)) {
    throw new Error('Reading progress journal retirement requires a valid article ID.')
  }
  await preferences.update<RetiredReadingProgressArticle>(
    retiredArticleKey(articleId),
    current => isRetiredReadingProgressArticle(current, articleId)
      ? current
      : {
          schemaVersion: 1,
          kind: 'retired-reading-progress-article',
          articleId,
        },
  )
}

export async function retryRetiredReadingProgressJournalCleanup(
  preferences: PreferencesStore,
): Promise<void> {
  const markers = await preferences.listByPrefix<unknown>(retiredArticleKeyPrefix)
  for (const { value } of markers) {
    if (isRetiredReadingProgressArticle(value)) {
      await clearRetiredReadingProgressJournals(preferences, value.articleId)
    }
  }
}

export async function clearRetiredReadingProgressJournals(
  preferences: PreferencesStore,
  articleId: string,
): Promise<void> {
  if (!isBoundedId(articleId)) {
    throw new Error('Reading progress journal cleanup requires a valid article ID.')
  }
  if (!await readingProgressArticleIsRetired(preferences, articleId)) {
    return
  }
  const entries = await Promise.all([
    preferences.listByPrefix<unknown>(journalPrefix(articleId)),
    preferences.listByPrefix<unknown>(journalOperationPrefix(articleId)),
    preferences.listByPrefix<unknown>(writerTombstonePrefix(articleId)),
  ])
  const keys = new Set([
    aggregateJournalKey(articleId),
    legacyJournalKey(articleId),
    ...entries.flatMap(values => values.map(({ key }) => key)),
  ])
  await Promise.all([...keys].map(key => preferences.remove(key)))
}

export async function compactReadingProgressJournalSlots(
  preferences: PreferencesStore,
  articleId: string,
  options: CompactReadingProgressJournalSlotsOptions = {},
): Promise<number> {
  if (!isBoundedId(articleId)) {
    throw new Error('Reading progress journal compaction requires a valid article ID.')
  }
  const maxRemovals = compactedWriterSlotBatchSize(options.maxRemovals)
  if (maxRemovals === 0) {
    return 0
  }

  // v3 writer keys are reusable by older tabs, so they are migration inputs only.
  // v4 operation keys are immutable and can be removed independently by sequence.
  const slotEntries = await preferences.listByPrefix<unknown>(
    journalOperationPrefix(articleId),
  )
  const slots = slotEntries.flatMap(({ key, value }) => (
    isWriterJournalOperationSlot(value)
    && value.articleId === articleId
    && key === journalOperationKey(articleId, value.writerId, value.sequence)
      ? [{ key, value }]
      : []
  ))
  const tombstones = new Map<string, WriterReadingProgressJournalTombstone>()
  const referencedWriterIds = new Set(slots.flatMap(entry => [
    entry.value.writerId,
    ...(entry.value.journal.supersedes ?? [])
      .filter(source => isWriterJournalSource(source))
      .map(source => source.writerId),
    ...(entry.value.journal.writerGapLineages ?? [])
      .map(lineage => lineage.writerId),
  ]))
  await Promise.all([...referencedWriterIds]
    .map(async (writerId) => {
      const value = await preferences.get<unknown>(writerTombstoneKey(
        articleId,
        writerId,
      ))
      if (isWriterJournalTombstone(value)
        && value.articleId === articleId
        && value.writerId === writerId) {
        tombstones.set(value.writerId, value)
      }
    }))

  const slotsByOperation = new Map(
    slots.map(entry => [writerSlotCompactionIdentity(entry.value), entry] as const),
  )
  const absorbedWriterSequences = new Map<string, number>()
  for (const entry of slots) {
    const tombstone = tombstones.get(entry.value.writerId)
    if (writerSlotIsRetired(entry.value, tombstone)) {
      continue
    }
    const identity = writerLineageIdentity(entry.value.attemptId, entry.value.writerId)
    absorbedWriterSequences.set(identity, Math.max(
      absorbedWriterSequences.get(identity) ?? 0,
      entry.value.journal.writerSequenceHighWater ?? 0,
    ))
  }
  const isAbsorbed = (entry: typeof slots[number]): boolean => (
    absorbedWriterSequences.get(writerLineageIdentity(
      entry.value.attemptId,
      entry.value.writerId,
    )) ?? 0
  ) >= entry.value.sequence
  const openGapLineages = new Map<string, number>()
  const requestOpenGapLineage = (identity: string, sequence: number): boolean => {
    if ((openGapLineages.get(identity) ?? 0) >= sequence) {
      return false
    }
    openGapLineages.set(identity, sequence)
    return true
  }
  for (const entry of slots) {
    const tombstone = tombstones.get(entry.value.writerId)
    if (writerSlotIsRetired(entry.value, tombstone)) {
      continue
    }
    for (const lineage of unsettledWriterCausalClosureLineages(
      entry.value.journal,
      tombstones,
    )) {
      requestOpenGapLineage(
        writerLineageIdentity(entry.value.attemptId, lineage.writerId),
        lineage.sequence,
      )
    }
  }
  const nestedGapLineages = new Map<string, Array<{
    sourceSequence: number
    targetIdentity: string
    targetSequence: number
  }>>()
  const slotsByLineage = new Map<string, typeof slots>()
  for (const entry of slots) {
    const identity = writerLineageIdentity(
      entry.value.attemptId,
      entry.value.writerId,
    )
    const lineageSlots = slotsByLineage.get(identity) ?? []
    lineageSlots.push(entry)
    slotsByLineage.set(identity, lineageSlots)
    const nested = nestedGapLineages.get(identity) ?? []
    for (const lineage of unsettledWriterCausalClosureLineages(
      entry.value.journal,
      tombstones,
    )) {
      nested.push({
        sourceSequence: entry.value.sequence,
        targetIdentity: writerLineageIdentity(
          entry.value.attemptId,
          lineage.writerId,
        ),
        targetSequence: lineage.sequence,
      })
    }
    nestedGapLineages.set(identity, nested)
  }
  const pendingOpenGapLineages = [...openGapLineages.keys()]
  const scannedOpenGapLineages = new Map<string, number>()
  for (let index = 0; index < pendingOpenGapLineages.length; index += 1) {
    const identity = pendingOpenGapLineages[index]!
    const requestedSequence = openGapLineages.get(identity) ?? 0
    if ((scannedOpenGapLineages.get(identity) ?? 0) >= requestedSequence) {
      continue
    }
    scannedOpenGapLineages.set(identity, requestedSequence)
    for (const nested of nestedGapLineages.get(identity) ?? []) {
      if (nested.sourceSequence <= requestedSequence
        && requestOpenGapLineage(
          nested.targetIdentity,
          nested.targetSequence,
        )) {
        pendingOpenGapLineages.push(nested.targetIdentity)
      }
    }
  }
  const selectedGapAnchorKeys = new Set<string>()
  for (const [identity, requestedSequence] of openGapLineages) {
    const coveredSources = new Set<string>()
    const coveredLineages = new Map<string, number>()
    const candidates = [...(slotsByLineage.get(identity) ?? [])]
      .filter(entry => entry.value.sequence <= requestedSequence)
      .sort((left, right) => right.value.sequence - left.value.sequence)
    for (const candidate of candidates) {
      const debt = writerSlotGapAnchorDebt(candidate.value, tombstones)
      const contributesSource = debt.sources.some(source =>
        !coveredSources.has(sourceIdentity(source)))
      const contributesLineage = debt.lineages.some(lineage =>
        lineage.sequence > (coveredLineages.get(lineage.writerId) ?? 0))
      if (!contributesSource && !contributesLineage) {
        continue
      }
      selectedGapAnchorKeys.add(candidate.key)
      for (const source of debt.sources) {
        coveredSources.add(sourceIdentity(source))
      }
      for (const lineage of debt.lineages) {
        coveredLineages.set(lineage.writerId, Math.max(
          coveredLineages.get(lineage.writerId) ?? 0,
          lineage.sequence,
        ))
      }
    }
  }
  const protectedKeys = new Set<string>()
  const protectCausalClosure = (entry: typeof slots[number]): void => {
    if (protectedKeys.has(entry.key)) {
      return
    }
    protectedKeys.add(entry.key)
    for (const source of entry.value.journal.supersedes ?? []) {
      if (source.slotVersion !== journalOperationSlotSchemaVersion
        || source.articleId !== articleId
        || source.attemptId !== entry.value.attemptId) {
        continue
      }
      const causalEntry = slotsByOperation.get(writerSourceCompactionIdentity(source))
      if (causalEntry) {
        const causalRetired = writerSlotIsRetired(
          causalEntry.value,
          tombstones.get(causalEntry.value.writerId),
        )
        const preservesOpenGap = selectedGapAnchorKeys.has(causalEntry.key)
        if (!causalRetired || preservesOpenGap) {
          protectCausalClosure(causalEntry)
        }
      }
    }
  }
  for (const entry of slots) {
    const tombstone = tombstones.get(entry.value.writerId)
    const retired = writerSlotIsRetired(entry.value, tombstone)
    const preservesOpenGap = selectedGapAnchorKeys.has(entry.key)
    // A sequence gap can leave an older live slot as the only carrier of a
    // cross-writer causal edge. Keep that anchor, even if an older tombstone
    // covers it, until the open gap lineage is fully settled.
    if ((!retired && !isAbsorbed(entry)) || preservesOpenGap) {
      protectCausalClosure(entry)
    }
  }

  // Operation keys include their sequence and are never reused by a newer write.
  // Tombstones remain as the high-water fence for delayed writes.
  const candidates = slots
    .filter(entry => !protectedKeys.has(entry.key)
      && (isAbsorbed(entry) || writerSlotIsRetired(
          entry.value,
          tombstones.get(entry.value.writerId),
        )))
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(0, maxRemovals)
  let removed = 0
  for (const candidate of candidates) {
    if (await preferences.compareAndRemove(candidate.key, candidate.value)) {
      removed += 1
    }
  }
  return removed
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
    const slot = await updateActiveArticleJournal<AggregateReadingProgressJournalSlot>(
      preferences,
      articleId,
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
    if (await readingProgressArticleIsRetired(preferences, articleId)) {
      return null
    }
    const current = await preferences.get<unknown>(key)
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
  const key = journalOperationKey(
    journal.articleId,
    journal.writerId,
    journal.sequence,
  )
  const tombstone = await preferences.get<unknown>(writerTombstoneKey(
    journal.articleId,
    journal.writerId,
  ))
  if (writerJournalIsRetired(tombstone, journal)) {
    return null
  }
  const next = await updateActiveArticleJournal<WriterReadingProgressJournalOperationSlot>(
    preferences,
    journal.articleId,
    key,
    (current) => {
      if (isWriterJournalOperationSlot(current)) {
        return updateWriterJournalOperationSlot(current, journal)
      }
      return {
        schemaVersion: journalOperationSlotSchemaVersion,
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
  if (!isWriterJournalOperationSlot(next)) {
    throw new Error('Reading progress journal migration returned an invalid writer slot.')
  }
  return restoreWriterJournalOperation(next, key)
}

async function readWriterJournals(
  preferences: PreferencesStore,
  articleId: string,
  attemptId: string,
): Promise<{
  journals: CurrentReadingProgressJournal[]
  causalIndex: WriterGapCausalReadIndex
}> {
  const [legacyEntries, operationEntries, tombstoneEntries] = await Promise.all([
    preferences.listByPrefix<unknown>(journalPrefix(articleId)),
    preferences.listByPrefix<unknown>(journalOperationPrefix(articleId)),
    preferences.listByPrefix<unknown>(writerTombstonePrefix(articleId)),
  ])
  const causalIndex = createWriterGapCausalReadIndex(
    articleId,
    attemptId,
    legacyEntries,
    operationEntries,
    tombstoneEntries,
  )
  const tombstones = causalIndex.tombstonesByWriter
  const legacyJournals = legacyEntries.flatMap(({ key, value }) => {
    if (!isWriterJournalSlot(value)
      || value.articleId !== articleId
      || value.attemptId !== attemptId
      || key !== journalKey(articleId, value.writerId)
      || !value.journal
      || (tombstones.get(value.writerId)?.sequence ?? -1) >= value.sequence) {
      return []
    }
    return [restoreWriterJournal(
      value,
      removeSettledWriterCausalHistory(value.journal, tombstones),
      key,
    )]
  })
  const operationJournals = operationEntries.flatMap(({ key, value }) => {
    if (!isWriterJournalOperationSlot(value)
      || value.articleId !== articleId
      || value.attemptId !== attemptId
      || key !== journalOperationKey(articleId, value.writerId, value.sequence)
      || (tombstones.get(value.writerId)?.sequence ?? -1) >= value.sequence) {
      return []
    }
    return [restoreWriterJournalOperation(
      value,
      key,
      removeSettledWriterCausalHistory(value.journal, tombstones),
    )]
  })
  return {
    journals: [...legacyJournals, ...operationJournals],
    causalIndex,
  }
}

function createWriterGapCausalReadIndex(
  articleId: string,
  attemptId: string,
  legacyEntries: readonly { key: string, value: unknown }[],
  operationEntries: readonly { key: string, value: unknown }[],
  tombstoneEntries: readonly { key: string, value: unknown }[],
): WriterGapCausalReadIndex {
  const operationJournalsByWriter = new Map<
    string,
    StoredReadingProgressJournal[]
  >()
  for (const { key, value } of operationEntries) {
    if (!isWriterJournalOperationSlot(value)
      || value.articleId !== articleId
      || value.attemptId !== attemptId
      || key !== journalOperationKey(articleId, value.writerId, value.sequence)) {
      continue
    }
    const journals = operationJournalsByWriter.get(value.writerId) ?? []
    journals.push(value.journal)
    operationJournalsByWriter.set(value.writerId, journals)
  }

  const legacyJournalsByWriter = new Map<
    string,
    StoredReadingProgressJournal[]
  >()
  for (const { key, value } of legacyEntries) {
    if (!isWriterJournalSlot(value)
      || value.articleId !== articleId
      || value.attemptId !== attemptId
      || key !== journalKey(articleId, value.writerId)
      || !value.journal) {
      continue
    }
    const journals = legacyJournalsByWriter.get(value.writerId) ?? []
    journals.push(value.journal)
    legacyJournalsByWriter.set(value.writerId, journals)
  }

  const tombstonesByWriter = new Map<
    string,
    WriterReadingProgressJournalTombstone
  >()
  for (const { key, value } of tombstoneEntries) {
    if (isWriterJournalTombstone(value)
      && value.articleId === articleId
      && value.attemptId === attemptId
      && key === writerTombstoneKey(articleId, value.writerId)) {
      tombstonesByWriter.set(value.writerId, value)
    }
  }
  return {
    operationJournalsByWriter,
    legacyJournalsByWriter,
    tombstonesByWriter,
  }
}

async function expandWriterGapCausalHistory(
  preferences: PreferencesStore,
  journal: CurrentReadingProgressJournal,
  causalIndex: WriterGapCausalReadIndex,
): Promise<CurrentReadingProgressJournal> {
  const gapLineages = journalCausalClosureLineages(journal)
  if (gapLineages.length === 0) {
    return journal
  }
  const hiddenSources = await readWriterGapCausalClosure(
    preferences,
    journal,
    gapLineages,
    causalIndex,
  )
  const supersedes = deduplicateSources([
    ...(journal.supersedes ?? []),
    ...hiddenSources.sources,
  ])
  const sources = deduplicateSources([
    ...(journal.sources ?? fallbackSources(journal)),
    ...hiddenSources.sources,
  ])
  if (supersedes.length > maxStoredSupersededSources
    || sources.length > maxExpandedJournalSources) {
    throw new Error('Reading progress journal gap closure is too large.')
  }
  return {
    ...journal,
    ...(supersedes.length > 0 ? { supersedes } : {}),
    sources,
  }
}

function removeSettledWriterCausalHistory(
  journal: StoredReadingProgressJournal,
  tombstones: ReadonlyMap<string, WriterReadingProgressJournalTombstone>,
): StoredReadingProgressJournal {
  const supersedes = (journal.supersedes ?? []).filter((source) => {
    if (!isWriterJournalSource(source)) {
      return true
    }
    return !writerCausalClosureIsSettled(
      tombstones,
      journal.articleId,
      journal.attemptId,
      { writerId: source.writerId, sequence: source.sequence },
    )
  })
  // An ordinary lineage tombstone may precede a deeper dependency failure.
  // Only a carrier-last closure proof can retire the corresponding gap debt.
  const writerGapLineages = unsettledWriterGapLineages(journal, tombstones)
  const {
    supersedes: _supersedes,
    writerGapLineages: _writerGapLineages,
    ...payload
  } = journal
  return {
    ...payload,
    ...(supersedes.length > 0 ? { supersedes } : {}),
    ...(writerGapLineages.length > 0 ? { writerGapLineages } : {}),
  }
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
    isWriterJournalSource(source)
    && source.key === (source.slotVersion === journalOperationSlotSchemaVersion
      ? journalOperationKey(journal.articleId, journal.writerId, journal.sequence)
      : journalKey(journal.articleId, journal.writerId))
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
  const writerGapLineages = deduplicateWriterGapLineages(
    writerGapLineagesForJournals(journals),
    maxRuntimeCausalClosureLineages,
  )
  const selectedCausalClosureLineages = journalCausalClosureLineages(selected)
  const merged: CurrentReadingProgressJournal = {
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
    ...(selected.writerSequenceHighWater !== undefined
      ? { writerSequenceHighWater: selected.writerSequenceHighWater }
      : {}),
    ...(selected.writerSequenceHasGap ? { writerSequenceHasGap: true as const } : {}),
    ...(writerGapLineages.length > 0 ? { writerGapLineages } : {}),
    selectedCausalClosureLineages,
    ...(selected.supersedes?.length ? { supersedes: selected.supersedes } : {}),
    sources,
  }
  // Synthetic gaps and the selected supersession history share one runtime budget.
  journalCausalClosureLineages(merged)
  return merged
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
  return (candidate.writerId === other.writerId
    && (candidate.writerSequenceHighWater ?? 0) >= other.sequence)
    || candidate.supersedes?.some(reference =>
    reference.writerId === other.writerId
    && reference.sequence === other.sequence) === true
}

function journalWriterGapLineages(
  journal: ReadingProgressJournalDraft,
  maximum = maxStoredWriterGapLineages,
): ReadingProgressJournalWriterGapLineage[] {
  return deduplicateWriterGapLineages([
    ...(journal.writerGapLineages ?? []),
    ...(journal.writerSequenceHasGap
      ? [{ writerId: journal.writerId, sequence: journal.sequence }]
      : []),
  ], maximum)
}

function journalCausalClosureLineages(
  journal: ReadingProgressJournalDraft,
): ReadingProgressJournalWriterGapLineage[] {
  return deduplicateWriterGapLineages([
    ...journalWriterGapLineages(journal, maxRuntimeCausalClosureLineages),
    ...(journal.supersedes ?? []).flatMap(source => isWriterJournalSource(source)
      ? [{ writerId: source.writerId, sequence: source.sequence }]
      : []),
  ], maxRuntimeCausalClosureLineages)
}

function deduplicateWriterGapLineages(
  lineages: Iterable<ReadingProgressJournalWriterGapLineage>,
  maximum = maxStoredWriterGapLineages,
): ReadingProgressJournalWriterGapLineage[] {
  const byWriter = new Map<string, number>()
  for (const lineage of lineages) {
    byWriter.set(lineage.writerId, Math.max(
      byWriter.get(lineage.writerId) ?? 0,
      lineage.sequence,
    ))
    if (byWriter.size > maximum) {
      throw new Error('Reading progress journal gap lineage history is too large.')
    }
  }
  return [...byWriter]
    .map(([writerId, sequence]) => ({ writerId, sequence }))
    .sort((left, right) => left.writerId.localeCompare(right.writerId))
}

function deduplicateSources(
  sources: Iterable<ReadingProgressJournalSource>,
  maximum?: number,
): ReadingProgressJournalSource[] {
  const unique = new Map<string, ReadingProgressJournalSource>()
  for (const source of sources) {
    addDeduplicatedSource(unique, source, maximum)
  }
  return [...unique.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function addDeduplicatedSource(
  unique: Map<string, ReadingProgressJournalSource>,
  source: ReadingProgressJournalSource,
  maximum?: number,
): void {
  unique.set(sourceIdentity(source), source)
  if (maximum !== undefined && unique.size > maximum) {
    throw new Error('Reading progress journal gap closure is too large.')
  }
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
  overrides?: ReadingProgressJournalSettlementOverrides,
): Promise<boolean> {
  const directSources = overrides?.sources
    ?? (expected.sources?.length ? expected.sources : fallbackSources(expected))
  const gapLineages = overrides?.causalClosureLineages
    ?? journalCausalClosureLineages(expected)
  const gapClosure = gapLineages.length > 0
    ? await readWriterGapCausalClosure(preferences, expected, gapLineages)
    : { sources: [], lineages: [] }
  const sources = deduplicateSources([...directSources, ...gapClosure.sources])
  if (sources.length > maxExpandedJournalSources) {
    throw new Error('Reading progress journal gap closure is too large.')
  }
  const carrier = sources.find(source =>
    isWriterJournalSource(source)
    && source.key === writerJournalSourceKey(source)
    && source.writerId === expected.writerId
    && source.sequence === expected.sequence)
    ?? sources.find(source =>
      source.writerId === expected.writerId
      && source.sequence === expected.sequence
      && source.epochId === expected.epochId
      && source.generation === expected.generation)
  if (!carrier) {
    return false
  }
  let settled = true
  for (const source of sources.filter(source => source !== carrier)) {
    try {
      await clearJournalSource(preferences, source)
    }
    catch {
      settled = false
    }
  }
  if (settled) {
    for (const lineage of gapClosure.lineages) {
      if (lineage.writerId === expected.writerId) {
        if (lineage.sequence > expected.sequence) {
          settled = false
        }
        continue
      }
      try {
        await markWriterCausalClosureSettled(
          preferences,
          expected.articleId,
          expected.attemptId,
          lineage,
        )
      }
      catch {
        settled = false
      }
    }
  }
  if (settled && carrier) {
    try {
      await clearJournalSource(preferences, carrier, true)
    }
    catch {
      settled = false
    }
  }
  return settled
}

async function readWriterGapCausalClosure(
  preferences: PreferencesStore,
  expected: CurrentReadingProgressJournal,
  initialLineages: readonly ReadingProgressJournalWriterGapLineage[],
  existingIndex?: WriterGapCausalReadIndex,
): Promise<{
  sources: ReadingProgressJournalSource[]
  lineages: ReadingProgressJournalWriterGapLineage[]
}> {
  const normalizedLineages = deduplicateWriterGapLineages(
    initialLineages,
    maxRuntimeCausalClosureLineages,
  )
  const requestedHighWater = new Map(normalizedLineages.map(lineage => [
    lineage.writerId,
    lineage.sequence,
  ] as const))
  const scannedHighWater = new Map<string, number>()
  const pending = [...normalizedLineages]
  const sources = new Map<string, ReadingProgressJournalSource>()
  const tombstones = new Map<
    string,
    WriterReadingProgressJournalTombstone | null
  >()
  for (let index = 0; index < pending.length; index += 1) {
    const writerId = pending[index]!.writerId
    const sequence = requestedHighWater.get(writerId) ?? 0
    if ((scannedHighWater.get(writerId) ?? 0) >= sequence) {
      continue
    }
    const result = existingIndex
      ? readWriterGapCausalLayerFromIndex(
          existingIndex,
          expected,
          { writerId, sequence },
        )
      : await readWriterGapCausalLayerFromStore(
          preferences,
          expected,
          { writerId, sequence },
          tombstones,
        )
    scannedHighWater.set(writerId, sequence)
    for (const source of result.sources) {
      addDeduplicatedSource(sources, source, maxExpandedJournalSources)
    }
    for (const lineage of result.lineages) {
      const current = requestedHighWater.get(lineage.writerId) ?? 0
      if (lineage.sequence <= current) {
        continue
      }
      requestedHighWater.set(lineage.writerId, lineage.sequence)
      pending.push(lineage)
      if (requestedHighWater.size > maxRuntimeCausalClosureLineages) {
        throw new Error('Reading progress journal gap closure is too large.')
      }
    }
  }
  return {
    sources: [...sources.values()]
      .sort((left, right) => left.key.localeCompare(right.key)),
    lineages: [...requestedHighWater]
      .map(([writerId, sequence]) => ({ writerId, sequence })),
  }
}

function readWriterGapCausalLayerFromIndex(
  causalIndex: WriterGapCausalReadIndex,
  expected: CurrentReadingProgressJournal,
  lineage: ReadingProgressJournalWriterGapLineage,
): {
  sources: ReadingProgressJournalSource[]
  lineages: ReadingProgressJournalWriterGapLineage[]
} {
  const journals = [
    ...(causalIndex.operationJournalsByWriter.get(lineage.writerId) ?? []),
    ...(causalIndex.legacyJournalsByWriter.get(lineage.writerId) ?? []),
  ].filter(journal => journal.sequence <= lineage.sequence)
  const lineages = deduplicateWriterGapLineages(
    causalClosureLineagesForJournals(journals),
    maxRuntimeCausalClosureLineages,
  )
  return {
    sources: deduplicateSources(
      supersededSourcesForJournals(journals),
      maxExpandedJournalSources,
    ),
    lineages: lineages.filter(lineage => !writerCausalClosureIsSettled(
      causalIndex.tombstonesByWriter,
      expected.articleId,
      expected.attemptId,
      lineage,
    )),
  }
}

async function readWriterGapCausalLayerFromStore(
  preferences: PreferencesStore,
  expected: CurrentReadingProgressJournal,
  lineage: ReadingProgressJournalWriterGapLineage,
  tombstoneCache: Map<string, WriterReadingProgressJournalTombstone | null>,
): Promise<{
  sources: ReadingProgressJournalSource[]
  lineages: ReadingProgressJournalWriterGapLineage[]
}> {
  const [operationEntries, legacyValue] = await Promise.all([
    preferences.listByPrefix<unknown>(journalOperationWriterPrefix(
      expected.articleId,
      lineage.writerId,
    )),
    preferences.get<unknown>(journalKey(expected.articleId, lineage.writerId)),
  ])
  const journals = operationEntries.flatMap(({ key, value }) => (
    isWriterJournalOperationSlot(value)
    && value.articleId === expected.articleId
    && value.attemptId === expected.attemptId
    && value.writerId === lineage.writerId
    && value.sequence <= lineage.sequence
    && key === journalOperationKey(
      expected.articleId,
      lineage.writerId,
      value.sequence,
    )
      ? [value.journal]
      : []
  ))
  if (isWriterJournalSlot(legacyValue)
    && legacyValue.journal
    && legacyValue.articleId === expected.articleId
    && legacyValue.attemptId === expected.attemptId
    && legacyValue.writerId === lineage.writerId
    && legacyValue.sequence <= lineage.sequence) {
    journals.push(legacyValue.journal)
  }
  const lineages = deduplicateWriterGapLineages(
    causalClosureLineagesForJournals(journals),
    maxRuntimeCausalClosureLineages,
  )
  const missingWriterIds = [...new Set(lineages.map(lineage => lineage.writerId))]
    .filter(writerId => !tombstoneCache.has(writerId))
  await Promise.all(missingWriterIds.map(async (writerId) => {
    const value = await preferences.get<unknown>(writerTombstoneKey(
      expected.articleId,
      writerId,
    ))
    tombstoneCache.set(writerId, isWriterJournalTombstone(value)
      && value.articleId === expected.articleId
      && value.attemptId === expected.attemptId
      && value.writerId === writerId
      ? value
      : null)
  }))
  const tombstones = new Map<string, WriterReadingProgressJournalTombstone>()
  for (const nestedLineage of lineages) {
    const tombstone = tombstoneCache.get(nestedLineage.writerId)
    if (tombstone) {
      tombstones.set(nestedLineage.writerId, tombstone)
    }
  }
  return {
    sources: deduplicateSources(
      supersededSourcesForJournals(journals),
      maxExpandedJournalSources,
    ),
    lineages: lineages.filter(lineage => !writerCausalClosureIsSettled(
      tombstones,
      expected.articleId,
      expected.attemptId,
      lineage,
    )),
  }
}

function* causalClosureLineagesForJournals(
  journals: Iterable<ReadingProgressJournalDraft>,
): Generator<ReadingProgressJournalWriterGapLineage> {
  for (const journal of journals) {
    yield* journalCausalClosureLineages(journal)
  }
}

function* writerGapLineagesForJournals(
  journals: Iterable<ReadingProgressJournalDraft>,
): Generator<ReadingProgressJournalWriterGapLineage> {
  for (const journal of journals) {
    yield* journalWriterGapLineages(journal)
  }
}

function* supersededSourcesForJournals(
  journals: Iterable<ReadingProgressJournalDraft>,
): Generator<ReadingProgressJournalSource> {
  for (const journal of journals) {
    yield* journal.supersedes ?? []
  }
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
  settlesCausalClosure = false,
): Promise<void> {
  return isWriterJournalSource(source)
    ? clearWriterJournalSource(preferences, source, settlesCausalClosure)
    : clearAggregateJournalSource(preferences, source)
}

async function clearWriterJournalSource(
  preferences: PreferencesStore,
  expected: ReadingProgressJournalSource,
  settlesCausalClosure: boolean,
): Promise<void> {
  const key = writerTombstoneKey(expected.articleId, expected.writerId)
  await updateActiveArticleJournal<WriterReadingProgressJournalTombstone>(
    preferences,
    expected.articleId,
    key,
    (current) => {
      const tombstone = isWriterJournalTombstone(current) ? current : null
      if (tombstone && (tombstone.articleId !== expected.articleId
        || tombstone.attemptId !== expected.attemptId
        || tombstone.writerId !== expected.writerId)) {
        throw new ReadingProgressJournalAttemptConflictError(expected.attemptId)
      }
      if (tombstone && tombstone.sequence >= expected.sequence) {
        if (!settlesCausalClosure
          || (tombstone.causalClosureSequence ?? 0) >= expected.sequence) {
          return tombstone
        }
        return {
          ...tombstone,
          causalClosureSequence: expected.sequence,
        }
      }
      const causalClosureSequence = Math.max(
        tombstone?.causalClosureSequence ?? 0,
        settlesCausalClosure ? expected.sequence : 0,
      )
      return {
        schemaVersion: journalSlotSchemaVersion,
        kind: 'writer-tombstone',
        articleId: expected.articleId,
        attemptId: expected.attemptId,
        writerId: expected.writerId,
        sequence: expected.sequence,
        ...(causalClosureSequence > 0 ? { causalClosureSequence } : {}),
        epochId: expected.epochId,
        generation: expected.generation,
      }
    },
  )
}

async function markWriterCausalClosureSettled(
  preferences: PreferencesStore,
  articleId: string,
  attemptId: string,
  lineage: ReadingProgressJournalWriterGapLineage,
): Promise<void> {
  await updateActiveArticleJournal<WriterReadingProgressJournalTombstone>(
    preferences,
    articleId,
    writerTombstoneKey(articleId, lineage.writerId),
    (current) => {
      if (!isWriterJournalTombstone(current)
        || current.articleId !== articleId
        || current.attemptId !== attemptId
        || current.writerId !== lineage.writerId
        || current.sequence < lineage.sequence) {
        throw new Error('Reading progress journal causal closure is not retired.')
      }
      if ((current.causalClosureSequence ?? 0) >= lineage.sequence) {
        return current
      }
      return {
        ...current,
        causalClosureSequence: lineage.sequence,
      }
    },
  )
}

async function clearAggregateJournalSource(
  preferences: PreferencesStore,
  expected: ReadingProgressJournalSource,
): Promise<void> {
  await updateActiveArticleJournal<AggregateReadingProgressJournalSlot>(
    preferences,
    expected.articleId,
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
      slotVersion: journalOperationSlotSchemaVersion,
      key: journalOperationKey(
        expected.articleId,
        expected.writerId,
        expected.sequence,
      ),
    },
    {
      ...base,
      slotVersion: aggregateSlotSchemaVersion,
      key: aggregateJournalKey(expected.articleId),
    },
  ]
}

function previousJournalOperationKey(
  journal: ReadingProgressJournalDraft,
): string | null {
  return journal.sequence > 1
    ? journalOperationKey(journal.articleId, journal.writerId, journal.sequence - 1)
    : null
}

function prepareWriterJournalOperation(
  journal: ReadingProgressJournalDraft,
  tombstone: unknown,
  previousKey: string | null,
  previousValue: unknown,
  legacyValue: unknown,
): ReadingProgressJournalDraft {
  const previousOperation = previousKey
    && isWriterJournalOperationSlot(previousValue)
    && previousValue.articleId === journal.articleId
    && previousValue.attemptId === journal.attemptId
    && previousValue.writerId === journal.writerId
    && previousValue.sequence === journal.sequence - 1
    && previousKey === journalOperationKey(
      journal.articleId,
      journal.writerId,
      previousValue.sequence,
    )
    ? previousValue
    : null
  const legacySlot = !previousOperation
    && isWriterJournalSlot(legacyValue)
    && legacyValue.journal
    && legacyValue.articleId === journal.articleId
    && legacyValue.attemptId === journal.attemptId
    && legacyValue.writerId === journal.writerId
    && legacyValue.sequence === journal.sequence - 1
    ? legacyValue
    : null
  const previousJournal = previousOperation?.journal ?? legacySlot?.journal ?? null
  const previousIsLive = previousJournal
    && !writerJournalIsRetired(tombstone, previousJournal)
  const previousSequenceIsSettled = isWriterJournalTombstone(tombstone)
    && tombstone.articleId === journal.articleId
    && tombstone.attemptId === journal.attemptId
    && tombstone.writerId === journal.writerId
    && tombstone.sequence >= journal.sequence - 1
  const writerSequenceHasGap = !previousSequenceIsSettled && (
    journal.writerSequenceHasGap === true
    || previousJournal?.writerSequenceHasGap === true
    || (journal.sequence > 1 && !previousIsLive)
  )
  const writerGapLineages = deduplicateWriterGapLineages([
    ...(journal.writerGapLineages ?? []),
    ...(!previousSequenceIsSettled && previousJournal
      ? journalWriterGapLineages(previousJournal)
      : []),
    ...(writerSequenceHasGap
      ? [{ writerId: journal.writerId, sequence: journal.sequence }]
      : []),
  ])
  const merged = previousIsLive
    ? mergeDurationCheckpoint(previousJournal, journal)
    : journal
  const writerSequenceHighWater = Math.max(
    journal.sequence - 1,
    journal.writerSequenceHighWater ?? 0,
    ...writerSourceSequences(journal.supersedes, journal.writerId),
    ...(previousIsLive
      ? [
          previousJournal.sequence,
          previousJournal.writerSequenceHighWater ?? 0,
          ...writerSourceSequences(previousJournal.supersedes, journal.writerId),
        ]
      : []),
  )
  if (writerSequenceHighWater >= journal.sequence) {
    throw new Error('Reading progress journal writer high-water is invalid.')
  }
  const supersedes = deduplicateSources(merged.supersedes ?? [])
    .filter(source => !isWriterJournalSource(source)
      || source.writerId !== journal.writerId
      || source.sequence > writerSequenceHighWater)
  if (supersedes.length > maxStoredSupersededSources) {
    throw new Error('Reading progress journal supersession history is too large.')
  }
  const {
    supersedes: _supersedes,
    writerSequenceHighWater: _writerSequenceHighWater,
    writerSequenceHasGap: _writerSequenceHasGap,
    writerGapLineages: _writerGapLineages,
    ...payload
  } = merged
  return {
    ...payload,
    ...(writerSequenceHighWater > 0 ? { writerSequenceHighWater } : {}),
    ...(writerSequenceHasGap ? { writerSequenceHasGap: true as const } : {}),
    ...(writerGapLineages.length > 0 ? { writerGapLineages } : {}),
    ...(supersedes.length > 0 ? { supersedes } : {}),
  }
}

function writerSourceSequences(
  sources: readonly ReadingProgressJournalSource[] | undefined,
  writerId: string,
): number[] {
  return (sources ?? [])
    .filter(source => isWriterJournalSource(source) && source.writerId === writerId)
    .map(source => source.sequence)
}

function updateWriterJournalOperationSlot(
  current: unknown | null,
  journal: ReadingProgressJournalDraft,
): WriterReadingProgressJournalOperationSlot {
  const slot = isWriterJournalOperationSlot(current) ? current : null
  if (slot && (slot.attemptId !== journal.attemptId
    || slot.articleId !== journal.articleId
    || slot.writerId !== journal.writerId
    || slot.sequence !== journal.sequence)) {
    throw new ReadingProgressJournalAttemptConflictError(journal.attemptId)
  }
  if (slot) {
    return slot
  }
  return {
    schemaVersion: journalOperationSlotSchemaVersion,
    epochId: journal.writerId,
    articleId: journal.articleId,
    attemptId: journal.attemptId,
    writerId: journal.writerId,
    sequence: journal.sequence,
    generation: journal.sequence,
    journal: mergeDurationCheckpoint(null, journal),
  }
}

function requireStoredWriterJournalOperation(
  value: WriterReadingProgressJournalOperationSlot | null,
  key: string,
): CurrentReadingProgressJournal {
  if (!isWriterJournalOperationSlot(value)) {
    throw new Error('Reading progress journal storage returned an invalid writer slot.')
  }
  return restoreWriterJournalOperation(value, key)
}

function prunePreviousWriterOperation(
  preferences: PreferencesStore,
  carrier: CurrentReadingProgressJournal,
  previousKey: string | null,
  previousValue: unknown,
): Promise<void> {
  const highWater = carrier.writerSequenceHighWater ?? 0
  if (!previousKey
    || !isWriterJournalOperationSlot(previousValue)
    || previousValue.articleId !== carrier.articleId
    || previousValue.attemptId !== carrier.attemptId
    || previousValue.writerId !== carrier.writerId
    || previousValue.sequence !== carrier.sequence - 1
    || previousValue.sequence > highWater
    || previousKey !== journalOperationKey(
      carrier.articleId,
      carrier.writerId,
      previousValue.sequence,
    )) {
    return Promise.resolve()
  }
  return preferences.compareAndRemove(previousKey, previousValue)
    .then(() => undefined, () => undefined)
}

async function waitForSupersededWriterPrune(
  operation: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolve()
    }
    timer = setTimeout(finish, supersededWriterPruneDeadlineMs)
    void operation.then(finish, finish)
  })
}

function mergeDurationCheckpoint(
  current: StoredReadingProgressJournal | null,
  incoming: ReadingProgressJournalDraft,
): StoredReadingProgressJournal {
  const storedCurrent = current ? toStoredJournalDraft(current) : null
  const storedIncoming = toStoredJournalDraft(incoming)
  const supersedes = deduplicateSources([
    ...(storedCurrent?.supersedes ?? []),
    ...(storedIncoming.supersedes ?? []),
  ])
  if (storedIncoming.cursorMutation
    || !storedCurrent?.cursorMutation
    || storedIncoming.baseAttemptRevision !== storedCurrent.baseAttemptRevision) {
    return {
      ...storedIncoming,
      ...(supersedes.length > 0 ? { supersedes } : {}),
      furthestSentenceOrdinal: Math.max(
        storedCurrent?.furthestSentenceOrdinal ?? 0,
        storedIncoming.furthestSentenceOrdinal,
      ),
      activeDurationSec: Math.max(
        storedCurrent?.activeDurationSec ?? 0,
        storedIncoming.activeDurationSec,
      ),
    }
  }
  return {
    ...storedIncoming,
    ...(supersedes.length > 0 ? { supersedes } : {}),
    baseAttemptRevision: storedCurrent.baseAttemptRevision,
    cursorMutation: true,
    currentSentenceId: storedCurrent.currentSentenceId,
    furthestSentenceOrdinal: Math.max(
      storedCurrent.furthestSentenceOrdinal,
      storedIncoming.furthestSentenceOrdinal,
    ),
    activeDurationSec: Math.max(
      storedCurrent.activeDurationSec,
      storedIncoming.activeDurationSec,
    ),
  }
}

function toStoredJournalDraft(
  journal: ReadingProgressJournalDraft,
): StoredReadingProgressJournal {
  const {
    schemaVersion: _schemaVersion,
    epochId: _epochId,
    generation: _generation,
    sources: _sources,
    selectedCausalClosureLineages: _selectedCausalClosureLineages,
    ...stored
  } = journal as ReadingProgressJournalDraft & Partial<Pick<
    CurrentReadingProgressJournal,
    | 'schemaVersion'
    | 'epochId'
    | 'generation'
    | 'sources'
    | 'selectedCausalClosureLineages'
  >>
  return stored
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
  const stored = toStoredJournalDraft(journal)
  const source = journalSource(journalSlotSchemaVersion, key, slot, stored)
  return {
    schemaVersion: journalSchemaVersion,
    epochId: slot.epochId,
    generation: slot.generation,
    ...stored,
    sources: deduplicateSources([source, ...(stored.supersedes ?? [])]),
  }
}

function restoreWriterJournalOperation(
  slot: WriterReadingProgressJournalOperationSlot,
  key: string,
  journal: StoredReadingProgressJournal = slot.journal,
): CurrentReadingProgressJournal {
  const stored = toStoredJournalDraft(journal)
  const source = journalSource(
    journalOperationSlotSchemaVersion,
    key,
    slot,
    stored,
  )
  return {
    schemaVersion: journalSchemaVersion,
    epochId: slot.epochId,
    generation: slot.generation,
    ...stored,
    sources: deduplicateSources([source, ...(stored.supersedes ?? [])]),
  }
}

function restoreAggregateJournal(
  slot: AggregateReadingProgressJournalSlot,
  journal: StoredReadingProgressJournal,
  key: string,
): CurrentReadingProgressJournal {
  const stored = toStoredJournalDraft(journal)
  const source = journalSource(aggregateSlotSchemaVersion, key, slot, stored)
  return {
    schemaVersion: journalSchemaVersion,
    epochId: slot.epochId,
    generation: slot.generation,
    ...stored,
    sources: deduplicateSources([source, ...(stored.supersedes ?? [])]),
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
  return toStoredJournalDraft(journal)
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

function retiredArticleKey(articleId: string): string {
  return `${retiredArticleKeyPrefix}${encodeURIComponent(articleId)}`
}

function isRetiredReadingProgressArticle(
  value: unknown,
  articleId?: string,
): value is RetiredReadingProgressArticle {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.kind === 'retired-reading-progress-article'
    && isBoundedId(value.articleId)
    && (articleId === undefined || value.articleId === articleId)
}

async function readingProgressArticleIsRetired(
  preferences: PreferencesStore,
  articleId: string,
): Promise<boolean> {
  return isRetiredReadingProgressArticle(
    await preferences.get<unknown>(retiredArticleKey(articleId)),
    articleId,
  )
}

function readingProgressArticleIsRetiredImmediately(
  preferences: PreferencesStore,
  articleId: string,
): boolean {
  return isRetiredReadingProgressArticle(
    preferences.getImmediately<unknown>(retiredArticleKey(articleId)),
    articleId,
  )
}

async function updateActiveArticleJournal<T>(
  preferences: PreferencesStore,
  articleId: string,
  key: string,
  updater: (current: unknown | null) => T | null,
): Promise<T | null> {
  if (await readingProgressArticleIsRetired(preferences, articleId)) {
    throw new ReadingProgressJournalArticleRetiredError(articleId)
  }
  const next = await preferences.update(key, updater)
  if (!await readingProgressArticleIsRetired(preferences, articleId)) {
    return next
  }
  if (next !== null) {
    await preferences.compareAndRemove(key, next)
  }
  throw new ReadingProgressJournalArticleRetiredError(articleId)
}

function updateActiveArticleJournalImmediately<T>(
  preferences: PreferencesStore,
  articleId: string,
  key: string,
  updater: (current: unknown | null) => T | null,
): T | null {
  if (readingProgressArticleIsRetiredImmediately(preferences, articleId)) {
    throw new ReadingProgressJournalArticleRetiredError(articleId)
  }
  const next = preferences.updateImmediately(key, updater)
  if (!readingProgressArticleIsRetiredImmediately(preferences, articleId)) {
    return next
  }
  preferences.updateImmediately(key, () => null)
  throw new ReadingProgressJournalArticleRetiredError(articleId)
}

function journalKey(articleId: string, writerId: string): string {
  return `${journalPrefix(articleId)}${encodeURIComponent(writerId)}`
}

function journalOperationPrefix(articleId: string): string {
  return `${journalOperationKeyPrefix}${encodeURIComponent(articleId)}:`
}

function journalOperationWriterPrefix(articleId: string, writerId: string): string {
  return `${journalOperationPrefix(articleId)}${encodeURIComponent(writerId)}:`
}

function journalOperationKey(
  articleId: string,
  writerId: string,
  sequence: number,
): string {
  return `${journalOperationWriterPrefix(articleId, writerId)}${sequence}`
}

function writerTombstonePrefix(articleId: string): string {
  return `${writerTombstoneKeyPrefix}${encodeURIComponent(articleId)}:`
}

function writerTombstoneKey(articleId: string, writerId: string): string {
  return `${writerTombstonePrefix(articleId)}${encodeURIComponent(writerId)}`
}

function compactedWriterSlotBatchSize(requested?: number): number {
  if (requested === undefined) {
    return maxCompactedWriterSlotsPerRun
  }
  if (!isNonNegativeSafeInteger(requested)) {
    throw new Error('Reading progress journal compaction requires a valid batch size.')
  }
  return Math.min(requested, maxCompactedWriterSlotsPerRun)
}

function writerSlotIsRetired(
  slot: WriterReadingProgressJournalOperationSlot,
  tombstone?: WriterReadingProgressJournalTombstone,
): boolean {
  return tombstone !== undefined
    && tombstone.articleId === slot.articleId
    && tombstone.attemptId === slot.attemptId
    && tombstone.writerId === slot.writerId
    && tombstone.sequence >= slot.sequence
}

function writerSlotGapAnchorDebt(
  slot: WriterReadingProgressJournalOperationSlot,
  tombstones: ReadonlyMap<string, WriterReadingProgressJournalTombstone>,
): {
  sources: ReadingProgressJournalSource[]
  lineages: ReadingProgressJournalWriterGapLineage[]
} {
  return {
    sources: (slot.journal.supersedes ?? []).filter((source) => {
      if (isWriterJournalSource(source)) {
        if (source.writerId === slot.writerId
          && source.sequence <= slot.sequence) {
          return false
        }
        if (writerCausalClosureIsSettled(
          tombstones,
          source.articleId,
          source.attemptId,
          { writerId: source.writerId, sequence: source.sequence },
        )) {
          return false
        }
      }
      return true
    }),
    // writerSequenceHasGap synthesizes a self lineage for searching, but it
    // carries no causal payload and must not turn every old gap into an anchor.
    lineages: (slot.journal.writerGapLineages ?? []).filter(lineage =>
      !writerCausalClosureIsSettled(
        tombstones,
        slot.articleId,
        slot.attemptId,
        lineage,
      ) && (lineage.writerId !== slot.writerId
        || lineage.sequence > slot.sequence)),
  }
}

function writerCausalClosureIsSettled(
  tombstones: ReadonlyMap<string, WriterReadingProgressJournalTombstone>,
  articleId: string,
  attemptId: string,
  lineage: ReadingProgressJournalWriterGapLineage,
): boolean {
  const tombstone = tombstones.get(lineage.writerId)
  return tombstone !== undefined
    && tombstone.articleId === articleId
    && tombstone.attemptId === attemptId
    && tombstone.writerId === lineage.writerId
    && (tombstone.causalClosureSequence ?? 0) >= lineage.sequence
}

function unsettledWriterGapLineages(
  journal: ReadingProgressJournalDraft,
  tombstones: ReadonlyMap<string, WriterReadingProgressJournalTombstone>,
): ReadingProgressJournalWriterGapLineage[] {
  return journalWriterGapLineages(journal)
    .filter(lineage => !writerCausalClosureIsSettled(
      tombstones,
      journal.articleId,
      journal.attemptId,
      lineage,
    ))
}

function unsettledWriterCausalClosureLineages(
  journal: ReadingProgressJournalDraft,
  tombstones: ReadonlyMap<string, WriterReadingProgressJournalTombstone>,
): ReadingProgressJournalWriterGapLineage[] {
  return journalCausalClosureLineages(journal)
    .filter(lineage => !writerCausalClosureIsSettled(
      tombstones,
      journal.articleId,
      journal.attemptId,
      lineage,
    ))
}

function writerSlotCompactionIdentity(
  slot: WriterReadingProgressJournalOperationSlot,
): string {
  return writerCompactionIdentity(slot.attemptId, slot.writerId, slot.sequence)
}

function writerSourceCompactionIdentity(
  source: ReadingProgressJournalSource,
): string {
  return writerCompactionIdentity(source.attemptId, source.writerId, source.sequence)
}

function writerCompactionIdentity(
  attemptId: string,
  writerId: string,
  sequence: number,
): string {
  return [attemptId, writerId, sequence]
    .map(value => encodeURIComponent(String(value)))
    .join(':')
}

function writerLineageIdentity(attemptId: string, writerId: string): string {
  return [attemptId, writerId]
    .map(value => encodeURIComponent(value))
    .join(':')
}

function isWriterJournalSource(
  source: ReadingProgressJournalSource,
): boolean {
  return source.slotVersion === journalSlotSchemaVersion
    || source.slotVersion === journalOperationSlotSchemaVersion
}

function writerJournalSourceKey(source: ReadingProgressJournalSource): string {
  return source.slotVersion === journalOperationSlotSchemaVersion
    ? journalOperationKey(source.articleId, source.writerId, source.sequence)
    : journalKey(source.articleId, source.writerId)
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

function isWriterJournalOperationSlot(
  value: unknown,
): value is WriterReadingProgressJournalOperationSlot {
  if (!isRecord(value)) {
    return false
  }
  return value.schemaVersion === journalOperationSlotSchemaVersion
    && isBoundedId(value.epochId)
    && isBoundedId(value.articleId)
    && isBoundedId(value.attemptId)
    && isBoundedId(value.writerId)
    && isPositiveSafeInteger(value.sequence)
    && isPositiveSafeInteger(value.generation)
    && isStoredReadingProgressJournal(value.journal)
    && value.sequence === value.journal.sequence
    && value.articleId === value.journal.articleId
    && value.attemptId === value.journal.attemptId
    && value.writerId === value.journal.writerId
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
    && (value.causalClosureSequence === undefined || (
      isPositiveSafeInteger(value.causalClosureSequence)
      && value.causalClosureSequence <= value.sequence
    ))
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
    && (value.writerSequenceHighWater === undefined || (
      isNonNegativeSafeInteger(value.writerSequenceHighWater)
      && value.writerSequenceHighWater < value.sequence
    ))
    && (value.writerSequenceHasGap === undefined
      || value.writerSequenceHasGap === true)
    && isStoredWriterGapHistory(
      value.writerGapLineages,
      value.writerId,
      value.writerSequenceHasGap,
    )
    && (value.supersedes === undefined || (
      isJournalSources(value.supersedes)
      && value.supersedes.every(source =>
        source.articleId === value.articleId
        && source.attemptId === value.attemptId)
    ))
}

function isWriterGapLineages(
  value: unknown,
): value is readonly ReadingProgressJournalWriterGapLineage[] {
  return Array.isArray(value)
    && value.length <= maxStoredWriterGapLineages
    && value.every(lineage => isRecord(lineage)
      && isBoundedId(lineage.writerId)
      && isPositiveSafeInteger(lineage.sequence))
}

function isStoredWriterGapHistory(
  value: unknown,
  writerId: unknown,
  writerSequenceHasGap: unknown,
): boolean {
  const lineages = value === undefined
    ? []
    : isWriterGapLineages(value) ? value : null
  if (!lineages) {
    return false
  }
  if (writerSequenceHasGap !== true) {
    return true
  }
  if (!isBoundedId(writerId)) {
    return false
  }
  const writers = new Set(lineages.map(lineage => lineage.writerId))
  writers.add(writerId)
  return writers.size <= maxStoredWriterGapLineages
}

function isJournalSources(
  value: unknown,
): value is readonly ReadingProgressJournalSource[] {
  return Array.isArray(value)
    && value.length <= maxStoredSupersededSources
    && value.every(source => isRecord(source)
      && (source.slotVersion === aggregateSlotSchemaVersion
        || source.slotVersion === journalSlotSchemaVersion
        || source.slotVersion === journalOperationSlotSchemaVersion)
      && isStorageKey(source.key)
      && isBoundedId(source.articleId)
      && isBoundedId(source.attemptId)
      && isBoundedId(source.writerId)
      && isPositiveSafeInteger(source.sequence)
      && isBoundedId(source.epochId)
      && isNonNegativeSafeInteger(source.generation)
      && source.key === (source.slotVersion === journalOperationSlotSchemaVersion
        ? journalOperationKey(
            source.articleId as string,
            source.writerId as string,
            source.sequence as number,
          )
        : source.slotVersion === journalSlotSchemaVersion
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
