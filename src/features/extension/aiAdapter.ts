import type { AiWordExpansion, AiWordExpansionRequest } from './types'

export async function requestAiWordExpansion(
  request: AiWordExpansionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<AiWordExpansion> {
  const response = await fetchImpl('/api/extensions/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: request.provider,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      model: request.model,
      term: request.term.term,
      localGloss: request.term.localGloss,
      context: request.term.context,
    }),
  })

  if (!response.ok) {
    const payload = await readJson(response)
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'AI 释义暂时取不到。')
  }

  return normalizeAiWordExpansion(await readJson(response))
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json()
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  }
  catch {
    return null
  }
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
