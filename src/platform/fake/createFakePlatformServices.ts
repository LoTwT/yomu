import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'

import { availableCapability, createCapabilitySnapshot, unavailableCapability } from '../capabilities'
import {
  PlatformCapabilityError,
  type AppLifecycleAdapter,
  type AppLifecycleEvent,
  type AppLifecycleState,
  type AudioPlaybackAdapter,
  type AudioPlaybackHandle,
  type AudioPlaybackRequest,
  type CloudSpeechAdapter,
  type CloudSpeechCredentials,
  type CloudSpeechSessionAdapter,
  type CloudSpeechSynthesisRequest,
  type CloudSpeechSynthesisResult,
  type ArticleDeletedEvent,
  type ArticleEventsAdapter,
  type ArticleContentExtractor,
  type BackNavigationAdapter,
  type BackNavigationEvent,
  type CapabilitySnapshot,
  type ExternalNavigationAdapter,
  type FileImportAdapter,
  type FileImportOptions,
  type ImportedTextFile,
  type LegacyImportedContentAdapter,
  type NetworkStatusAdapter,
  type PlatformKind,
  type PlatformServices,
  type ExtractedArticleContent,
  type RemoteArticleContent,
  type RemoteServiceRequest,
  type RemoteServicesAdapter,
  type ReadingAttemptCompletedEvent,
  type ReadingAttemptEventsAdapter,
  type SharedImportPayload,
  type ShareImportAdapter,
  type SpeechAdapter,
  type SpeechPlaybackHandle,
  type SpeechRequest,
  type SpeechVoice,
} from '../contracts'
import { MemoryPreferencesStore, MemorySecretStore } from '../memoryStores'

export interface FakePlatformOptions {
  kind?: PlatformKind
  repositories?: LocalRepositories
  capabilities?: Partial<CapabilitySnapshot>
  online?: boolean
  speechAvailable?: boolean
  audioAvailable?: boolean
  cloudSpeechAvailable?: boolean
  fileImportAvailable?: boolean
  urlImportAvailable?: boolean
  serviceWorkerAvailable?: boolean
  voices?: SpeechVoice[]
  files?: ImportedTextFile[]
  remoteHandler?: <TResponse>(request: RemoteServiceRequest) => Promise<TResponse>
  articleExtractionHandler?: (input: RemoteArticleContent) => ExtractedArticleContent | null
}

export interface FakePlatformHarness {
  services: PlatformServices
  lifecycle: FakeLifecycleAdapter
  network: FakeNetworkAdapter
  speech: FakeSpeechAdapter
  audio: FakeAudioPlaybackAdapter
  cloudSpeech: FakeCloudSpeechAdapter
  files: FakeFileImportAdapter
  remote: FakeRemoteServicesAdapter
  articleExtractor: FakeArticleContentExtractor
  externalNavigation: FakeExternalNavigationAdapter
  backNavigation: FakeBackNavigationAdapter
  articleEvents: FakeArticleEventsAdapter
  readingAttemptEvents: FakeReadingAttemptEventsAdapter
  shareInbox: FakeShareImportAdapter
  legacyImportedContent: FakeLegacyImportedContentAdapter
  preferences: MemoryPreferencesStore
  secrets: MemorySecretStore
}

export function createFakePlatformServices(
  options: FakePlatformOptions = {},
): FakePlatformHarness {
  const repositories = options.repositories ?? createMemoryLocalRepositories()
  const lifecycle = new FakeLifecycleAdapter()
  const network = new FakeNetworkAdapter(options.online ?? true)
  const speech = new FakeSpeechAdapter(options.speechAvailable ?? true, options.voices ?? [])
  const audio = new FakeAudioPlaybackAdapter(options.audioAvailable ?? true)
  const files = new FakeFileImportAdapter(options.fileImportAvailable ?? true, options.files ?? [])
  const remote = new FakeRemoteServicesAdapter(options.remoteHandler)
  const cloudSpeech = new FakeCloudSpeechAdapter(
    remote,
    options.cloudSpeechAvailable ?? options.remoteHandler !== undefined,
  )
  const urlImportAvailable = options.urlImportAvailable ?? options.remoteHandler !== undefined
  const articleExtractor = new FakeArticleContentExtractor(
    urlImportAvailable,
    options.articleExtractionHandler,
  )
  const externalNavigation = new FakeExternalNavigationAdapter()
  const backNavigation = new FakeBackNavigationAdapter()
  const articleEvents = new FakeArticleEventsAdapter()
  const readingAttemptEvents = new FakeReadingAttemptEventsAdapter()
  const shareInbox = new FakeShareImportAdapter()
  const legacyImportedContent = new FakeLegacyImportedContentAdapter()
  const preferences = new MemoryPreferencesStore()
  const secrets = new MemorySecretStore()
  const capabilities = createCapabilitySnapshot({
    localPersistence: repositories.persistence === 'persistent'
      ? availableCapability
      : unavailableCapability('Fake repositories are ephemeral.'),
    persistentSecrets: availableCapability,
    localSpeech: speech.isAvailable()
      ? availableCapability
      : unavailableCapability('Fake speech is disabled.'),
    fileImport: files.isAvailable()
      ? availableCapability
      : unavailableCapability('Fake file import is disabled.'),
    urlImport: articleExtractor.isAvailable()
      ? availableCapability
      : unavailableCapability('Fake URL import is disabled.'),
    shareImport: availableCapability,
    systemBack: availableCapability,
    serviceWorker: options.serviceWorkerAvailable
      ? availableCapability
      : unavailableCapability('Fake Service Worker is disabled.'),
    ...options.capabilities,
  })

  return {
    services: {
      kind: options.kind ?? 'web',
      capabilities,
      repositories,
      preferences,
      secrets,
      speech,
      audio,
      cloudSpeech,
      files,
      lifecycle,
      network,
      remote,
      articleExtractor,
      externalNavigation,
      backNavigation,
      articleEvents,
      readingAttemptEvents,
      shareInbox,
      legacyImportedContent,
    },
    lifecycle,
    network,
    speech,
    audio,
    cloudSpeech,
    files,
    remote,
    articleExtractor,
    externalNavigation,
    backNavigation,
    articleEvents,
    readingAttemptEvents,
    shareInbox,
    legacyImportedContent,
    preferences,
    secrets,
  }
}

export class FakeLifecycleAdapter implements AppLifecycleAdapter {
  private state: AppLifecycleState = 'active'
  private readonly listeners = new Set<(event: AppLifecycleEvent) => void>()

  currentState(): AppLifecycleState {
    return this.state
  }

  subscribe(listener: (event: AppLifecycleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(
    state: AppLifecycleState,
    reason: AppLifecycleEvent['reason'] = 'test',
  ): void {
    this.state = state
    const event: AppLifecycleEvent = { state, reason }
    this.listeners.forEach(listener => listener(event))
  }
}

export class FakeNetworkAdapter implements NetworkStatusAdapter {
  private readonly listeners = new Set<(online: boolean) => void>()

  constructor(private online: boolean) {}

  isOnline(): boolean {
    return this.online
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setOnline(online: boolean): void {
    this.online = online
    this.listeners.forEach(listener => listener(online))
  }
}

export class FakeSpeechAdapter implements SpeechAdapter {
  readonly spoken: SpeechRequest[] = []
  cancelCount = 0
  stopCount = 0

  private activePlayback: {
    request: SpeechRequest
    cancelled: boolean
    removeAbortListener: () => void
  } | null = null

  constructor(
    private available: boolean,
    private voices: SpeechVoice[],
  ) {}

  isAvailable(): boolean {
    return this.available
  }

  async listVoices(): Promise<SpeechVoice[]> {
    return this.voices.map(voice => ({ ...voice }))
  }

  async speak(request: SpeechRequest): Promise<SpeechPlaybackHandle> {
    if (!this.available) {
      throw new PlatformCapabilityError('localSpeech')
    }
    if (request.signal?.aborted) {
      throw new Error('Fake speech playback was cancelled before it started.')
    }
    const recordedRequest = { ...request }
    const playback = {
      request: recordedRequest,
      cancelled: false,
      removeAbortListener: () => {},
    }
    this.spoken.push(recordedRequest)
    this.activePlayback = playback
    const abortPlayback = (): void => {
      if (!playback.cancelled) {
        playback.cancelled = true
        this.cancelCount += 1
      }
      if (this.activePlayback === playback) {
        this.activePlayback = null
      }
    }
    playback.removeAbortListener = () => {
      request.signal?.removeEventListener('abort', abortPlayback)
    }
    request.signal?.addEventListener('abort', abortPlayback, { once: true })
    recordedRequest.onStart?.()
    return {
      pause: () => {},
      resume: () => {},
      cancel: () => {
        playback.removeAbortListener()
        abortPlayback()
      },
    }
  }

  stop(): void {
    this.stopCount += 1
    if (this.activePlayback) {
      this.activePlayback.removeAbortListener()
      this.activePlayback.cancelled = true
      this.activePlayback = null
    }
  }

  finishActive(): void {
    const playback = this.activePlayback
    if (!playback || playback.cancelled) {
      return
    }
    playback.removeAbortListener()
    this.activePlayback = null
    playback.request.onEnd?.()
  }

  failActive(error = new Error('Fake speech playback failed.')): void {
    const playback = this.activePlayback
    if (!playback || playback.cancelled) {
      return
    }
    playback.removeAbortListener()
    this.activePlayback = null
    playback.request.onError?.(error)
  }

  setAvailable(available: boolean): void {
    this.available = available
  }

  setVoices(voices: SpeechVoice[]): void {
    this.voices = voices
  }
}

export class FakeAudioPlaybackAdapter implements AudioPlaybackAdapter {
  readonly played: AudioPlaybackRequest[] = []
  cancelCount = 0
  stopCount = 0

  private activePlayback: {
    request: AudioPlaybackRequest
    cancelled: boolean
    removeAbortListener: () => void
  } | null = null

  constructor(private available = true) {}

  isAvailable(): boolean {
    return this.available
  }

  async play(request: AudioPlaybackRequest): Promise<AudioPlaybackHandle> {
    if (!this.available) {
      throw new PlatformCapabilityError('localSpeech')
    }
    if (request.signal?.aborted) {
      throw request.signal.reason instanceof Error
        ? request.signal.reason
        : new Error('Fake audio playback was cancelled before it started.')
    }
    const recordedRequest = { ...request }
    const playback = {
      request: recordedRequest,
      cancelled: false,
      removeAbortListener: () => {},
    }
    this.played.push(recordedRequest)
    this.activePlayback = playback
    const abortPlayback = (): void => {
      if (!playback.cancelled) {
        playback.cancelled = true
        this.cancelCount += 1
      }
      if (this.activePlayback === playback) {
        this.activePlayback = null
      }
    }
    playback.removeAbortListener = () => {
      request.signal?.removeEventListener('abort', abortPlayback)
    }
    request.signal?.addEventListener('abort', abortPlayback, { once: true })
    recordedRequest.onStart?.()

    return {
      pause: () => {},
      resume: () => {},
      cancel: () => {
        playback.removeAbortListener()
        abortPlayback()
      },
    }
  }

  stop(): void {
    this.stopCount += 1
    if (this.activePlayback) {
      this.activePlayback.removeAbortListener()
      this.activePlayback.cancelled = true
      this.activePlayback = null
    }
  }

  finishActive(): void {
    const playback = this.activePlayback
    if (!playback || playback.cancelled) {
      return
    }
    playback.removeAbortListener()
    this.activePlayback = null
    playback.request.onEnd?.()
  }

  failActive(error = new Error('Fake audio playback failed.')): void {
    const playback = this.activePlayback
    if (!playback || playback.cancelled) {
      return
    }
    playback.removeAbortListener()
    this.activePlayback = null
    playback.request.onError?.(error)
  }
}

interface FakeCloudSpeechResponse {
  audioBase64: string
  mimeType: string
  durationMs?: number
}

export class FakeCloudSpeechAdapter implements CloudSpeechAdapter {
  constructor(
    private readonly remote: RemoteServicesAdapter,
    private available = true,
  ) {}

  isAvailable(): boolean {
    return this.available
  }

  createSession(
    options: Parameters<CloudSpeechAdapter['createSession']>[0],
  ): CloudSpeechSessionAdapter {
    if (!this.available) {
      throw new Error('Fake cloud speech is unavailable.')
    }
    return new FakeCloudSpeechSessionAdapter(this.remote, options)
  }

  setAvailable(available: boolean): void {
    this.available = available
  }
}

class FakeCloudSpeechSessionAdapter implements CloudSpeechSessionAdapter {
  private readonly cache = new Map<string, CloudSpeechSynthesisResult>()
  private readonly pending = new Map<string, {
    controller: AbortController
    generation: number
    promise: Promise<CloudSpeechSynthesisResult>
  }>()

  private generation = 0

  constructor(
    private readonly remote: RemoteServicesAdapter,
    private readonly options: {
      provider: 'mimo'
      getCredentials: () => CloudSpeechCredentials
      maxCachedSentences: number
    },
  ) {}

  synthesizeSentence(
    request: CloudSpeechSynthesisRequest,
  ): Promise<CloudSpeechSynthesisResult> {
    const generation = this.generation
    const key = this.createCacheKey(request)
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve({ ...cached })
    }
    const existing = this.pending.get(key)
    if (existing?.generation === generation) {
      return existing.promise
    }

    const controller = new AbortController()
    const credentials = this.options.getCredentials()
    let pending!: {
      controller: AbortController
      generation: number
      promise: Promise<CloudSpeechSynthesisResult>
    }
    const promise = this.remote.request<FakeCloudSpeechResponse>({
      operation: 'mimo-tts',
      body: {
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
        sentenceId: request.sentenceId,
        text: request.text,
        textHash: request.textHash,
        language: request.language,
        model: request.model,
        voice: request.voice,
        style: request.style,
        format: request.format,
      },
      signal: controller.signal,
    }).then((response) => {
      this.assertCurrent(generation, controller.signal)
      const result: CloudSpeechSynthesisResult = {
        audioUrl: `data:${response.mimeType};base64,${response.audioBase64}`,
        durationMs: response.durationMs ?? 0,
      }
      this.cache.set(key, result)
      while (this.cache.size > this.options.maxCachedSentences) {
        const oldest = this.cache.keys().next().value
        if (typeof oldest !== 'string') {
          break
        }
        this.cache.delete(oldest)
      }
      return { ...result }
    }).finally(() => {
      if (this.pending.get(key) === pending) {
        this.pending.delete(key)
      }
    })
    pending = { controller, generation, promise }
    this.pending.set(key, pending)
    return promise
  }

  cancelPending(): void {
    this.generation += 1
    const reason = createFakeCloudSpeechAbortError()
    const requests = [...this.pending.values()]
    this.pending.clear()
    requests.forEach(request => request.controller.abort(reason))
  }

  async invalidateSentence(request: CloudSpeechSynthesisRequest): Promise<void> {
    this.cache.delete(this.createCacheKey(request))
  }

  async clearCache(): Promise<void> {
    this.cancelPending()
    this.cache.clear()
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (generation !== this.generation || signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : createFakeCloudSpeechAbortError()
    }
  }

  private createCacheKey(request: CloudSpeechSynthesisRequest): string {
    return JSON.stringify([
      request.provider,
      request.model,
      request.voice,
      request.style ?? '',
      request.format,
      request.sentenceId,
      request.textHash,
      request.language,
    ])
  }
}

function createFakeCloudSpeechAbortError(): Error {
  const error = new Error('Fake cloud speech was cancelled.')
  error.name = 'AbortError'
  return error
}

export class FakeFileImportAdapter implements FileImportAdapter {
  constructor(
    private available: boolean,
    private files: ImportedTextFile[],
  ) {}

  isAvailable(): boolean {
    return this.available
  }

  supportsDrop(): boolean {
    return this.available
  }

  async pickTextFiles(options: FileImportOptions = {}): Promise<ImportedTextFile[]> {
    if (!this.available) {
      throw new PlatformCapabilityError('fileImport')
    }
    const values = options.multiple ? this.files : this.files.slice(0, 1)
    return values.map(cloneImportedTextFile)
  }

  getDroppedTextFiles(_payload: unknown): ImportedTextFile[] {
    if (!this.available) {
      throw new PlatformCapabilityError('fileImport')
    }
    return this.files.map(cloneImportedTextFile)
  }

  setFiles(files: ImportedTextFile[]): void {
    this.files = files
  }
}

function cloneImportedTextFile(file: ImportedTextFile): ImportedTextFile {
  return {
    name: file.name,
    size: file.size,
    mediaType: file.mediaType,
    text: () => file.text(),
  }
}

export class FakeRemoteServicesAdapter implements RemoteServicesAdapter {
  readonly requests: RemoteServiceRequest[] = []

  constructor(
    private readonly handler: <TResponse>(request: RemoteServiceRequest) => Promise<TResponse> = async () => {
      throw new Error('No fake remote handler was configured.')
    },
  ) {}

  async request<TResponse>(request: RemoteServiceRequest): Promise<TResponse> {
    this.requests.push({ ...request, body: { ...request.body } })
    return this.handler<TResponse>(request)
  }
}

export class FakeArticleContentExtractor implements ArticleContentExtractor {
  readonly inputs: RemoteArticleContent[] = []

  constructor(
    private available: boolean,
    private readonly handler: (input: RemoteArticleContent) => ExtractedArticleContent | null = (input) => {
      if (/text\/(?:plain|markdown)/.test(input.contentType.toLowerCase())) {
        return { title: '', text: input.content }
      }
      return null
    },
  ) {}

  isAvailable(): boolean {
    return this.available
  }

  async extract(input: RemoteArticleContent): Promise<ExtractedArticleContent | null> {
    if (!this.available) {
      throw new PlatformCapabilityError('urlImport')
    }
    this.inputs.push({ ...input })
    return this.handler(input)
  }

  setAvailable(available: boolean): void {
    this.available = available
  }
}

export class FakeExternalNavigationAdapter implements ExternalNavigationAdapter {
  readonly openedUrls: string[] = []

  async open(url: string): Promise<void> {
    this.openedUrls.push(url)
  }
}

export class FakeBackNavigationAdapter implements BackNavigationAdapter {
  private readonly listeners = new Set<(event: BackNavigationEvent) => void>()

  subscribe(listener: (event: BackNavigationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(source: BackNavigationEvent['source'] = 'test'): void {
    this.listeners.forEach(listener => listener({ source }))
  }
}

export class FakeArticleEventsAdapter implements ArticleEventsAdapter {
  private readonly deletedListeners = new Set<(
    event: ArticleDeletedEvent,
  ) => void>()

  publishDeleted(event: ArticleDeletedEvent): void {
    this.deletedListeners.forEach((listener) => {
      try {
        listener({ ...event })
      }
      catch {}
    })
  }

  subscribeDeleted(
    listener: (event: ArticleDeletedEvent) => void,
  ): () => void {
    this.deletedListeners.add(listener)
    return () => this.deletedListeners.delete(listener)
  }
}

export class FakeReadingAttemptEventsAdapter implements ReadingAttemptEventsAdapter {
  private readonly listeners = new Set<(
    event: ReadingAttemptCompletedEvent,
  ) => void>()

  publishCompleted(event: ReadingAttemptCompletedEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener({ attempt: { ...event.attempt } })
      }
      catch {}
    })
  }

  subscribeCompleted(
    listener: (event: ReadingAttemptCompletedEvent) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export class FakeShareImportAdapter implements ShareImportAdapter {
  private pending: SharedImportPayload | null = null
  private readonly listeners = new Set<(payload: SharedImportPayload) => void>()

  async takePending(): Promise<SharedImportPayload | null> {
    const payload = this.pending
    this.pending = null
    return payload ? { ...payload } : null
  }

  subscribe(listener: (payload: SharedImportPayload) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(payload: SharedImportPayload): void {
    this.pending = { ...payload }
    this.listeners.forEach(listener => listener({ ...payload }))
  }
}

export class FakeLegacyImportedContentAdapter implements LegacyImportedContentAdapter {
  readonly deletedArticleIds: string[] = []

  async deleteArticle(articleId: string): Promise<void> {
    this.deletedArticleIds.push(articleId)
  }
}
