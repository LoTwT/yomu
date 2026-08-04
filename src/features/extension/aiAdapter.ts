import type { RemoteServicesAdapter } from '@/platform/contracts'

import type { AiWordExpansion, AiWordExpansionRequest } from './types'

export async function requestAiWordExpansion(
  request: AiWordExpansionRequest,
  remote: RemoteServicesAdapter,
): Promise<AiWordExpansion> {
  const payload = await remote.request<Record<string, unknown>>({
    operation: 'ai-word-expansion',
    body: {
      provider: request.provider,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      model: request.model,
      term: request.term.term,
      localGloss: request.term.localGloss,
      context: request.term.context,
    },
  })

  return normalizeAiWordExpansion(payload)
}

function normalizeAiWordExpansion(payload: Record<string, unknown> | null): AiWordExpansion {
  const examples = Array.isArray(payload?.examples)
    ? payload.examples.filter((example): example is string => typeof example === 'string').slice(0, 2)
    : []

  return {
    meaning: typeof payload?.meaning === 'string' ? payload.meaning : '',
    examples,
    background: typeof payload?.background === 'string' ? payload.background : '',
    provider: typeof payload?.provider === 'string' ? payload.provider : 'OpenAI',
    model: typeof payload?.model === 'string' ? payload.model : '',
  }
}
