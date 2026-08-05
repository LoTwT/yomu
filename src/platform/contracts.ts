import type { LocalRepositories } from '@/data/repositories'

export type PlatformKind = 'web' | 'desktop' | 'mobile'

export type CapabilityAvailability = 'available' | 'unavailable' | 'permission-required'

export interface CapabilityState {
  availability: CapabilityAvailability
  reason?: string
}

export interface CapabilitySnapshot {
  localPersistence: CapabilityState
  persistentSecrets: CapabilityState
  localSpeech: CapabilityState
  fileImport: CapabilityState
  urlImport: CapabilityState
  shareImport: CapabilityState
  systemBack: CapabilityState
  serviceWorker: CapabilityState
}

export interface PreferencesStore {
  get: <T>(key: string) => Promise<T | null>
  set: <T>(key: string, value: T) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
}

export type SecretPersistence = 'session' | 'device'

export interface SecretStore {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, persistence?: SecretPersistence) => Promise<void>
  remove: (key: string) => Promise<void>
  clearSession: () => Promise<void>
  clear: () => Promise<void>
}

export interface SpeechVoice {
  id: string
  name: string
  language: string
  local: boolean
  default: boolean
}

export interface SpeechRequest {
  text: string
  language: string
  rate: number
  voiceId?: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

export interface SpeechPlaybackHandle {
  pause: () => void
  resume: () => void
  cancel: () => void
}

export interface SpeechAdapter {
  isAvailable: () => boolean
  listVoices: () => Promise<SpeechVoice[]>
  speak: (request: SpeechRequest) => Promise<SpeechPlaybackHandle>
  stop: () => void
}

export interface ImportedTextFile {
  name: string
  size: number
  mediaType: string
  text: () => Promise<string>
}

export interface FileImportOptions {
  multiple?: boolean
  acceptedExtensions?: readonly ('.txt' | '.md')[]
}

export interface FileImportAdapter {
  isAvailable: () => boolean
  supportsDrop: () => boolean
  pickTextFiles: (options?: FileImportOptions) => Promise<ImportedTextFile[]>
  getDroppedTextFiles: (payload: unknown) => ImportedTextFile[]
}

export type AppLifecycleState = 'active' | 'background' | 'suspended'

export interface AppLifecycleEvent {
  state: AppLifecycleState
  reason: 'visibility' | 'pagehide' | 'system' | 'window-close' | 'test'
}

export interface AppLifecycleAdapter {
  currentState: () => AppLifecycleState
  subscribe: (listener: (event: AppLifecycleEvent) => void) => () => void
}

export interface NetworkStatusAdapter {
  isOnline: () => boolean
  subscribe: (listener: (online: boolean) => void) => () => void
}

export type RemoteServiceOperation = 'url-import' | 'mimo-tts' | 'ai-word-expansion'

export interface RemoteServiceRequest {
  operation: RemoteServiceOperation
  body: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

export interface RemoteServicesAdapter {
  request: <TResponse>(request: RemoteServiceRequest) => Promise<TResponse>
}

export interface RemoteArticleContent {
  sourceUrl: string
  contentType: string
  content: string
}

export interface ExtractedArticleContent {
  title: string
  text: string
}

export interface ArticleContentExtractor {
  isAvailable: () => boolean
  extract: (input: RemoteArticleContent) => Promise<ExtractedArticleContent | null>
}

export interface ExternalNavigationAdapter {
  open: (url: string) => Promise<void>
}

export interface BackNavigationEvent {
  source: 'browser' | 'desktop' | 'android' | 'ios' | 'test'
}

export interface BackNavigationAdapter {
  subscribe: (listener: (event: BackNavigationEvent) => void) => () => void
}

export interface SharedImportPayload {
  text?: string
  url?: string
  title?: string
}

export interface ShareImportAdapter {
  takePending: () => Promise<SharedImportPayload | null>
  subscribe: (listener: (payload: SharedImportPayload) => void) => () => void
}

export interface PlatformServices {
  kind: PlatformKind
  capabilities: Readonly<CapabilitySnapshot>
  repositories: LocalRepositories
  preferences: PreferencesStore
  secrets: SecretStore
  speech: SpeechAdapter
  files: FileImportAdapter
  lifecycle: AppLifecycleAdapter
  network: NetworkStatusAdapter
  remote: RemoteServicesAdapter
  articleExtractor: ArticleContentExtractor
  externalNavigation: ExternalNavigationAdapter
  backNavigation: BackNavigationAdapter
  shareInbox: ShareImportAdapter
}

export class PlatformCapabilityError extends Error {
  constructor(
    readonly capability: keyof CapabilitySnapshot,
    message = `Platform capability ${capability} is unavailable.`,
  ) {
    super(message)
    this.name = 'PlatformCapabilityError'
  }
}

export class RemoteServiceError extends Error {
  constructor(
    readonly operation: RemoteServiceOperation,
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly variant?: string,
  ) {
    super(message)
    this.name = 'RemoteServiceError'
  }
}
