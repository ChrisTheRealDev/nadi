import { authoredStudioResponse, parseStudioMiraRequest, parseStudioMiraResponse, type StudioMiraRequest } from './miraContract'

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Oversized help response.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('Oversized help response.') } chunks.push(result.value) }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
}

export type StudioMiraAvailability = 'ready' | 'disabled' | 'unauthorized' | 'unavailable'
export interface StudioMiraConnection { availability: StudioMiraAvailability; provider: 'groq' | 'openai' | null; remainingRequests?: number; blocker?: 'quota-exhausted' | 'quota-unavailable' }
/** Read-only readiness check: never includes a question or starts a provider request. */
export async function studioMiraConnection(signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StudioMiraConnection> {
  try {
    const response = await fetchImpl('/api/mira/creation/status', { signal, credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return { availability: 'unavailable', provider: null }
    const value = await boundedJson(response, 1024)
    if (!value || typeof value !== 'object' || !('ready' in value) || !('authorized' in value) || typeof value.ready !== 'boolean' || typeof value.authorized !== 'boolean') return { availability: 'unavailable', provider: null }
    return { availability: !value.ready ? 'disabled' : !value.authorized ? 'unauthorized' : 'ready', provider: 'provider' in value && (value.provider === 'groq' || value.provider === 'openai') ? value.provider : null,
      ...('remainingRequests' in value && Number.isSafeInteger(value.remainingRequests) && Number(value.remainingRequests) >= 0 && Number(value.remainingRequests) <= 1000 ? { remainingRequests: Number(value.remainingRequests) } : {}),
      ...('blocker' in value && (value.blocker === 'quota-exhausted' || value.blocker === 'quota-unavailable') ? { blocker: value.blocker } : {}) }
  } catch { return { availability: 'unavailable', provider: null } }
}
export async function studioMiraAvailability(signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<StudioMiraAvailability> {
  return (await studioMiraConnection(signal, fetchImpl)).availability
}

/** Explicit help; only a reviewed v4 passage includes music. Never grants editing capability. */
export async function requestStudioMira(request: StudioMiraRequest, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  if (!parseStudioMiraRequest(request)) throw new TypeError('Invalid minimal help request.')
  let dispatched = false
  // A failed request may already have reached the provider. Do not claim not-sent.
  const fallback = (reason: string) => authoredStudioResponse(request, reason, dispatched ? 'sent' : 'not-sent')
  let body = JSON.stringify(request)
  if (request.version === 4 || request.version === 5 || request.version === 6) {
    const history = [...request.history]
    while (new TextEncoder().encode(body).length > 16384) {
      if (!history.length) return fallback('request-too-large')
      history.shift()
      body = JSON.stringify({ ...request, history })
    }
  }
  try {
    const status = await fetchImpl('/api/mira/creation/status', { signal, credentials: 'same-origin', cache: 'no-store' })
    if (!status.ok) return fallback('live-unavailable')
    const access = await boundedJson(status, 1024)
    if (!access || typeof access !== 'object' || !('ready' in access) || !('authorized' in access) || access.ready !== true || access.authorized !== true) return fallback('authorization-required')
    dispatched = true
    const response = await fetchImpl('/api/mira/creation', { method: 'POST', signal, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body })
    if (!response.ok) return fallback('live-unavailable')
    let value: unknown
    try { value = await boundedJson(response, request.version >= 5 ? 16384 : 8192) } catch { return fallback('invalid-response') }
    return parseStudioMiraResponse(value, request) ?? fallback('invalid-response')
  } catch { return fallback(signal.aborted ? 'cancelled' : 'live-unavailable') }
}
