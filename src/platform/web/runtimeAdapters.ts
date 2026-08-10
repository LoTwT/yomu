import { isReadingAttempt } from '@/data/entities'

import {
  PlatformCapabilityError,
  RemoteServiceError,
  type AppLifecycleAdapter,
  type AppLifecycleEvent,
  type AppLifecycleState,
  type ArticleContentExtractor,
  type BackNavigationAdapter,
  type ExternalNavigationAdapter,
  type FileImportAdapter,
  type FileImportOptions,
  type ImportedTextFile,
  type NetworkStatusAdapter,
  type RemoteServiceOperation,
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
import { WebArticleContentExtractor } from './articleContentExtractor'

const remotePaths: Record<RemoteServiceOperation, string> = {
  'url-import': '/api/import/url',
  'mimo-tts': '/api/tts/mimo',
  'ai-word-expansion': '/api/extensions/ai',
}

const unsupportedTextControlCharacterPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

interface WebSpeechRuntime {
  speechSynthesis?: SpeechSynthesis
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

export class WebSpeechAdapter implements SpeechAdapter {
  constructor(private readonly runtime: WebSpeechRuntime) {}

  isAvailable(): boolean {
    return Boolean(this.runtime.speechSynthesis && this.runtime.SpeechSynthesisUtterance)
  }

  async listVoices(): Promise<SpeechVoice[]> {
    return this.runtime.speechSynthesis?.getVoices().map(voice => ({
      id: voice.voiceURI,
      name: voice.name,
      language: voice.lang,
      local: voice.localService,
      default: voice.default,
    })) ?? []
  }

  async speak(request: SpeechRequest): Promise<SpeechPlaybackHandle> {
    const synthesis = this.runtime.speechSynthesis
    const Utterance = this.runtime.SpeechSynthesisUtterance
    if (!synthesis || !Utterance) {
      throw new PlatformCapabilityError('localSpeech')
    }
    if (request.signal?.aborted) {
      throw new Error('Local speech playback was cancelled before it started.')
    }

    const utterance = new Utterance(request.text)
    utterance.lang = request.language
    utterance.rate = request.rate
    if (request.voiceId) {
      utterance.voice = synthesis.getVoices().find(voice => voice.voiceURI === request.voiceId) ?? null
    }
    const abortPlayback = (): void => synthesis.cancel()
    const removeAbortListener = (): void => {
      request.signal?.removeEventListener('abort', abortPlayback)
    }
    request.signal?.addEventListener('abort', abortPlayback, { once: true })
    utterance.onstart = () => request.onStart?.()
    utterance.onend = () => {
      removeAbortListener()
      request.onEnd?.()
    }
    utterance.onerror = (event) => {
      removeAbortListener()
      request.onError?.(new Error(event.error || 'Local speech failed.'))
    }
    synthesis.speak(utterance)

    return {
      pause: () => synthesis.pause(),
      resume: () => synthesis.resume(),
      cancel: () => {
        removeAbortListener()
        synthesis.cancel()
      },
    }
  }

  stop(): void {
    this.runtime.speechSynthesis?.cancel()
  }
}

export class WebFileImportAdapter implements FileImportAdapter {
  constructor(private readonly documentRef: Document | null) {}

  isAvailable(): boolean {
    return Boolean(this.documentRef)
  }

  supportsDrop(): boolean {
    return Boolean(this.documentRef)
  }

  async pickTextFiles(options: FileImportOptions = {}): Promise<ImportedTextFile[]> {
    if (!this.documentRef) {
      throw new PlatformCapabilityError('fileImport')
    }

    const extensions = options.acceptedExtensions ?? ['.txt', '.md']
    const input = this.documentRef.createElement('input')
    input.type = 'file'
    input.accept = extensions.join(',')
    input.multiple = options.multiple === true
    input.hidden = true
    input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true')
    this.documentRef.body?.append(input)

    return new Promise((resolve) => {
      const finish = (files: File[]): void => {
        input.remove()
        resolve(files.map(toImportedTextFile))
      }
      input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
      input.addEventListener('cancel', () => finish([]), { once: true })
      input.click()
    })
  }

  getDroppedTextFiles(payload: unknown): ImportedTextFile[] {
    if (!this.documentRef) {
      throw new PlatformCapabilityError('fileImport')
    }
    return readDroppedFiles(payload).map(toImportedTextFile)
  }
}

export class WebLifecycleAdapter implements AppLifecycleAdapter {
  constructor(
    private readonly documentRef: Document,
    private readonly windowRef: Window,
  ) {}

  currentState(): AppLifecycleState {
    return this.documentRef.visibilityState === 'visible' ? 'active' : 'background'
  }

  subscribe(listener: (event: AppLifecycleEvent) => void): () => void {
    const onVisibility = (): void => listener({
      state: this.currentState(),
      reason: 'visibility',
    })
    const onPageHide = (): void => listener({
      state: 'suspended',
      reason: 'pagehide',
    })
    const onPageShow = (): void => listener({
      state: this.currentState(),
      reason: 'pageshow',
    })
    this.documentRef.addEventListener('visibilitychange', onVisibility)
    this.windowRef.addEventListener('pagehide', onPageHide)
    this.windowRef.addEventListener('pageshow', onPageShow)
    return () => {
      this.documentRef.removeEventListener('visibilitychange', onVisibility)
      this.windowRef.removeEventListener('pagehide', onPageHide)
      this.windowRef.removeEventListener('pageshow', onPageShow)
    }
  }
}

export class WebNetworkStatusAdapter implements NetworkStatusAdapter {
  constructor(
    private readonly navigatorRef: Navigator,
    private readonly windowRef: Window,
  ) {}

  isOnline(): boolean {
    return this.navigatorRef.onLine
  }

  subscribe(listener: (online: boolean) => void): () => void {
    const online = (): void => listener(true)
    const offline = (): void => listener(false)
    this.windowRef.addEventListener('online', online)
    this.windowRef.addEventListener('offline', offline)
    return () => {
      this.windowRef.removeEventListener('online', online)
      this.windowRef.removeEventListener('offline', offline)
    }
  }
}

export class WebRemoteServicesAdapter implements RemoteServicesAdapter {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  async request<TResponse>(request: RemoteServiceRequest): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${remotePaths[request.operation]}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
      cache: 'no-store',
      signal: request.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new RemoteServiceError(
        request.operation,
        response.status,
        readErrorMessage(payload) ?? `Remote service returned HTTP ${response.status}.`,
        readStringField(payload, 'code') ?? undefined,
        readStringField(payload, 'variant') ?? undefined,
      )
    }
    return payload as TResponse
  }
}

export class WebExternalNavigationAdapter implements ExternalNavigationAdapter {
  constructor(private readonly windowRef: Window) {}

  async open(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only HTTP and HTTPS links can be opened externally.')
    }
    const opened = this.windowRef.open(parsed.toString(), '_blank', 'noopener,noreferrer')
    if (opened) {
      opened.opener = null
    }
  }
}

export class WebBackNavigationAdapter implements BackNavigationAdapter {
  constructor(private readonly windowRef: Window) {}

  subscribe(listener: (event: { source: 'browser' }) => void): () => void {
    const onPopState = (): void => listener({ source: 'browser' })
    this.windowRef.addEventListener('popstate', onPopState)
    return () => this.windowRef.removeEventListener('popstate', onPopState)
  }
}

export class WebReadingAttemptEventsAdapter implements ReadingAttemptEventsAdapter {
  private readonly listeners = new Set<(
    event: ReadingAttemptCompletedEvent,
  ) => void>()
  private readonly channel: BroadcastChannel | null

  constructor(runtime: Window) {
    try {
      const BroadcastChannelConstructor = (runtime as Window & {
        BroadcastChannel?: typeof BroadcastChannel
      }).BroadcastChannel
      this.channel = typeof BroadcastChannelConstructor === 'function'
        ? new BroadcastChannelConstructor('yomu-reading-attempts-v1')
        : null
      this.channel?.addEventListener('message', (event) => {
        if (isReadingAttemptCompletedEvent(event.data)) {
          this.deliver(event.data)
        }
      })
    }
    catch {
      this.channel = null
    }
  }

  publishCompleted(event: ReadingAttemptCompletedEvent): void {
    this.deliver(event)
    try {
      this.channel?.postMessage(event)
    }
    catch {}
  }

  subscribeCompleted(
    listener: (event: ReadingAttemptCompletedEvent) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private deliver(event: ReadingAttemptCompletedEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener({ attempt: { ...event.attempt } })
      }
      catch {}
    })
  }
}

export class EmptyShareImportAdapter implements ShareImportAdapter {
  async takePending(): Promise<SharedImportPayload | null> {
    return null
  }

  subscribe(_listener: (payload: SharedImportPayload) => void): () => void {
    return () => {}
  }
}

function toImportedTextFile(file: File): ImportedTextFile {
  return {
    name: file.name,
    size: file.size,
    mediaType: file.type,
    text: () => readUtf8TextFile(file),
  }
}

async function readUtf8TextFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (unsupportedTextControlCharacterPattern.test(text)) {
    throw new TypeError('The file contains unsupported control characters.')
  }
  return text
}

function readDroppedFiles(payload: unknown): File[] {
  if (typeof payload !== 'object' || payload === null || !('dataTransfer' in payload)) {
    return []
  }
  const dataTransfer = payload.dataTransfer
  if (typeof dataTransfer !== 'object' || dataTransfer === null || !('files' in dataTransfer)) {
    return []
  }
  const files = dataTransfer.files
  if (!files || typeof files !== 'object' || !('length' in files)) {
    return []
  }
  return Array.from(files as ArrayLike<File>)
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Remote service base URL must use HTTP or HTTPS.')
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Remote service base URL must not include query parameters or fragments.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function readErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  if ('message' in value && typeof value.message === 'string') {
    return value.message
  }
  if ('error' in value && typeof value.error === 'string') {
    return value.error
  }
  return null
}

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    return null
  }
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

export function createDefaultWebRuntimeAdapters(options: {
  apiBaseUrl?: string
  documentRef?: Document
  windowRef?: Window
  navigatorRef?: Navigator
  fetchImpl?: typeof fetch
} = {}): {
  speech: WebSpeechAdapter
  files: WebFileImportAdapter
  lifecycle: WebLifecycleAdapter
  network: WebNetworkStatusAdapter
  remote: WebRemoteServicesAdapter
  articleExtractor: ArticleContentExtractor
  externalNavigation: WebExternalNavigationAdapter
  backNavigation: WebBackNavigationAdapter
  readingAttemptEvents: WebReadingAttemptEventsAdapter
  shareInbox: EmptyShareImportAdapter
} {
  const windowRef = options.windowRef ?? window
  const documentRef = options.documentRef ?? document
  const navigatorRef = options.navigatorRef ?? navigator
  const fetchImpl = options.fetchImpl ?? windowRef.fetch.bind(windowRef)
  return {
    speech: new WebSpeechAdapter(windowRef),
    files: new WebFileImportAdapter(documentRef),
    lifecycle: new WebLifecycleAdapter(documentRef, windowRef),
    network: new WebNetworkStatusAdapter(navigatorRef, windowRef),
    remote: new WebRemoteServicesAdapter(options.apiBaseUrl ?? '', fetchImpl),
    articleExtractor: new WebArticleContentExtractor(documentRef.defaultView?.DOMParser ?? null),
    externalNavigation: new WebExternalNavigationAdapter(windowRef),
    backNavigation: new WebBackNavigationAdapter(windowRef),
    readingAttemptEvents: new WebReadingAttemptEventsAdapter(windowRef),
    shareInbox: new EmptyShareImportAdapter(),
  }
}

function isReadingAttemptCompletedEvent(
  value: unknown,
): value is ReadingAttemptCompletedEvent {
  if (typeof value !== 'object' || value === null || !('attempt' in value)) {
    return false
  }
  const attempt = value.attempt
  return isReadingAttempt(attempt)
    && attempt.status === 'completed'
    && typeof attempt.completedAt === 'string'
}
