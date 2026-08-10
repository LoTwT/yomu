import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'

import { availableCapability, createCapabilitySnapshot, unavailableCapability } from '../capabilities'
import {
  PlatformCapabilityError,
  type AppLifecycleAdapter,
  type AppLifecycleEvent,
  type AppLifecycleState,
  type ArticleContentExtractor,
  type BackNavigationAdapter,
  type BackNavigationEvent,
  type CapabilitySnapshot,
  type ExternalNavigationAdapter,
  type FileImportAdapter,
  type FileImportOptions,
  type ImportedTextFile,
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
  files: FakeFileImportAdapter
  remote: FakeRemoteServicesAdapter
  articleExtractor: FakeArticleContentExtractor
  externalNavigation: FakeExternalNavigationAdapter
  backNavigation: FakeBackNavigationAdapter
  readingAttemptEvents: FakeReadingAttemptEventsAdapter
  shareInbox: FakeShareImportAdapter
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
  const files = new FakeFileImportAdapter(options.fileImportAvailable ?? true, options.files ?? [])
  const remote = new FakeRemoteServicesAdapter(options.remoteHandler)
  const urlImportAvailable = options.urlImportAvailable ?? options.remoteHandler !== undefined
  const articleExtractor = new FakeArticleContentExtractor(
    urlImportAvailable,
    options.articleExtractionHandler,
  )
  const externalNavigation = new FakeExternalNavigationAdapter()
  const backNavigation = new FakeBackNavigationAdapter()
  const readingAttemptEvents = new FakeReadingAttemptEventsAdapter()
  const shareInbox = new FakeShareImportAdapter()
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
      files,
      lifecycle,
      network,
      remote,
      articleExtractor,
      externalNavigation,
      backNavigation,
      readingAttemptEvents,
      shareInbox,
    },
    lifecycle,
    network,
    speech,
    files,
    remote,
    articleExtractor,
    externalNavigation,
    backNavigation,
    readingAttemptEvents,
    shareInbox,
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
