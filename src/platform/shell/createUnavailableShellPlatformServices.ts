import { createMemoryLocalRepositories } from '@/data/memoryLocalRepositories'

import {
  createCapabilitySnapshot,
  unavailableCapability,
} from '../capabilities'
import {
  PlatformCapabilityError,
  type AudioPlaybackAdapter,
  type CloudSpeechAdapter,
  type FileImportAdapter,
  type PlatformKind,
  type PlatformServices,
  type RemoteServicesAdapter,
  type SpeechAdapter,
} from '../contracts'
import { MemoryPreferencesStore, MemorySecretStore } from '../memoryStores'

type ShellPlatformKind = Extract<PlatformKind, 'desktop' | 'mobile'>

const unavailableSpeech: SpeechAdapter = {
  isAvailable: () => false,
  listVoices: async () => [],
  speak: async () => {
    throw new PlatformCapabilityError('localSpeech')
  },
  stop: () => {},
}

const unavailableAudio: AudioPlaybackAdapter = {
  isAvailable: () => false,
  play: async () => {
    throw new PlatformCapabilityError(
      'localSpeech',
      'The shell audio adapter has not been injected.',
    )
  },
  stop: () => {},
}

const unavailableCloudSpeech: CloudSpeechAdapter = {
  isAvailable: () => false,
  createSession: () => {
    throw new Error('The shell cloud speech adapter has not been injected.')
  },
}

const unavailableFiles: FileImportAdapter = {
  isAvailable: () => false,
  supportsDrop: () => false,
  pickTextFiles: async () => {
    throw new PlatformCapabilityError('fileImport')
  },
  getDroppedTextFiles: () => {
    throw new PlatformCapabilityError('fileImport')
  },
}

const unavailableRemote: RemoteServicesAdapter = {
  request: async () => {
    throw new Error('The shell remote services adapter has not been injected.')
  },
}

export function createUnavailableShellPlatformServices(
  kind: ShellPlatformKind,
): PlatformServices {
  return {
    kind,
    capabilities: createCapabilitySnapshot({
      localPersistence: unavailableCapability('The shell persistence adapter has not been injected.'),
      persistentSecrets: unavailableCapability('The shell SecretStore has not been injected.'),
      localSpeech: unavailableCapability('The shell speech adapter has not been injected.'),
      fileImport: unavailableCapability('The shell file adapter has not been injected.'),
      urlImport: unavailableCapability('The shell URL extraction adapter has not been injected.'),
      shareImport: unavailableCapability('The shell share adapter has not been injected.'),
      systemBack: unavailableCapability('The shell back adapter has not been injected.'),
      serviceWorker: unavailableCapability('Service Worker is intentionally disabled for shell targets.'),
    }),
    repositories: createMemoryLocalRepositories(),
    preferences: new MemoryPreferencesStore(),
    secrets: new MemorySecretStore(),
    speech: unavailableSpeech,
    audio: unavailableAudio,
    cloudSpeech: unavailableCloudSpeech,
    files: unavailableFiles,
    lifecycle: {
      currentState: () => 'active',
      subscribe: () => () => {},
    },
    network: {
      isOnline: () => true,
      subscribe: () => () => {},
    },
    remote: unavailableRemote,
    articleExtractor: {
      isAvailable: () => false,
      extract: async () => {
        throw new PlatformCapabilityError('urlImport')
      },
    },
    externalNavigation: {
      open: async () => {
        throw new Error('The shell external navigation adapter has not been injected.')
      },
    },
    backNavigation: {
      subscribe: () => () => {},
    },
    shareInbox: {
      takePending: async () => null,
      subscribe: () => () => {},
    },
    legacyImportedContent: {
      deleteArticle: async () => {},
    },
  }
}
