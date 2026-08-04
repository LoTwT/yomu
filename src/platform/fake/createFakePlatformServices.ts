import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'
import type { LocalRepositories } from '@/data/repositories'

import { availableCapability, createCapabilitySnapshot, unavailableCapability } from '../capabilities'
import {
  PlatformCapabilityError,
  type AppLifecycleAdapter,
  type AppLifecycleEvent,
  type AppLifecycleState,
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
  type RemoteServiceRequest,
  type RemoteServicesAdapter,
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
  serviceWorkerAvailable?: boolean
  voices?: SpeechVoice[]
  files?: ImportedTextFile[]
  remoteHandler?: <TResponse>(request: RemoteServiceRequest) => Promise<TResponse>
}

export interface FakePlatformHarness {
  services: PlatformServices
  lifecycle: FakeLifecycleAdapter
  network: FakeNetworkAdapter
  speech: FakeSpeechAdapter
  files: FakeFileImportAdapter
  remote: FakeRemoteServicesAdapter
  externalNavigation: FakeExternalNavigationAdapter
  backNavigation: FakeBackNavigationAdapter
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
  const externalNavigation = new FakeExternalNavigationAdapter()
  const backNavigation = new FakeBackNavigationAdapter()
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
      externalNavigation,
      backNavigation,
      shareInbox,
    },
    lifecycle,
    network,
    speech,
    files,
    remote,
    externalNavigation,
    backNavigation,
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

  emit(state: AppLifecycleState): void {
    this.state = state
    const event: AppLifecycleEvent = { state, reason: 'test' }
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
  stopCount = 0

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
    this.spoken.push({ ...request })
    request.onStart?.()
    return {
      pause: () => {},
      resume: () => {},
      cancel: () => {},
    }
  }

  stop(): void {
    this.stopCount += 1
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
