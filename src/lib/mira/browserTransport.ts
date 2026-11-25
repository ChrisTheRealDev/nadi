import { authoredMiraResponse, createAuthoredMiraAdapter, type MiraAdapter } from './authoredAdapter'
import { MIRA_REQUEST_MAX_BYTES, parseMiraResponse, type MiraResponseDto } from './contracts'

export type MiraLearnerRoute = 'child-or-unknown-local' | 'supervised-teen-pilot'

export interface MiraBrowserTransportOptions {
  route: MiraLearnerRoute
  fetch?: typeof fetch
  endpoint?: '/api/mira'
  requestId?: () => string
  timeoutMs?: number
}

export function createMiraBrowserAdapter(options: MiraBrowserTransportOptions): MiraAdapter {
  if (options.route === 'child-or-unknown-local') return createAuthoredMiraAdapter({ requestId: options.requestId })
  const fetchImpl = options.fetch ?? fetch
  const endpoint = options.endpoint ?? '/api/mira'
  const fallbackId = options.requestId ?? (() => `fallback-${Date.now().toString(36)}`)
  const timeoutMs = Math.min(15_000, Math.max(250, options.timeoutMs ?? 8_000))
  return {
    ask: async (request) => {
      const body = JSON.stringify(request)
      if (new TextEncoder().encode(body).byteLength > MIRA_REQUEST_MAX_BYTES) {
        return authoredMiraResponse(request, fallbackId(), 'invalid-request')
      }
      const controller = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const task = (async () => {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body,
            signal: controller.signal,
          })
          if (!response.ok) throw new Error('Mira endpoint did not return success')
          const responseText = await readBoundedResponse(response, 16_384, controller)
          const parsed = parseMiraResponse(JSON.parse(responseText) as unknown)
          if (!parsed.ok || !parsed.value) throw new Error('Mira endpoint returned an invalid response')
          return parsed.value
        })()
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Mira request timed out'))
          }, timeoutMs)
        })
        return await Promise.race([task, deadline])
      } catch {
        return authoredMiraResponse(request, fallbackId(), 'provider-error', 'unknown')
      } finally {
        if (timeout) clearTimeout(timeout)
        controller.abort()
      }
    },
  }
}

export function isLiveMiraResponse(response: MiraResponseDto): boolean {
  return response.source === 'live' && response.liveStatus === 'completed'
}

async function readBoundedResponse(response: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Mira response is too large')
  if (!response.body) throw new Error('Mira response body is unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    received += chunk.value.byteLength
    if (received > maxBytes) {
      controller.abort()
      await reader.cancel()
      throw new Error('Mira response is too large')
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}
