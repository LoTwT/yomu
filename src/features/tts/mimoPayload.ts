import type { TtsAudioFormat } from './types'

export const defaultMimoTtsModel = 'mimo-v2.5-tts'
export const defaultMimoTtsVoice = 'Mia'
export const defaultMimoTtsFormat: TtsAudioFormat = 'mp3'

export interface MimoChatCompletionPayload {
  model: string
  modalities: ['audio']
  audio: {
    voice: string
    format: TtsAudioFormat
  }
  messages: Array<{
    role: 'assistant' | 'user'
    content: string
  }>
}

export function buildMimoTtsPayload(options: {
  text: string
  model?: string
  voice?: string
  format?: TtsAudioFormat
  style?: string
}): MimoChatCompletionPayload {
  const messages: MimoChatCompletionPayload['messages'] = [
    {
      role: 'assistant',
      content: options.text,
    },
  ]

  if (options.style?.trim()) {
    messages.push({
      role: 'user',
      content: options.style.trim(),
    })
  }

  return {
    model: options.model ?? defaultMimoTtsModel,
    modalities: ['audio'],
    audio: {
      voice: options.voice ?? defaultMimoTtsVoice,
      format: options.format ?? defaultMimoTtsFormat,
    },
    messages,
  }
}
