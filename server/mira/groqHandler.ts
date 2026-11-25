import { authoredStudioResponse, parseStudioMiraRequest, validateStudioSelection, type StudioMiraRequest } from '../../src/creation/v4/miraContract'
import { unsupportedStudioQuestion } from '../../src/creation/v4/studioHelp'
import { creationJson, readCreationBody } from './creationHandler'
import type { DurableMiraBudget } from './budget'
import { groqReadiness, type GroqMiraConfig } from './groqConfig'
import { MiraTrafficGate, screenMiraOutput } from './policy'
import { STUDIO_PROVIDER_FAILURES, studioTextSafe, type StudioProvider, type StudioProviderResult } from './studioHandler'

export interface GroqRequestQuota {
  reserve(requestId: string, reservedAt: string): Promise<{ ok: boolean }>
  settle(requestId: string): Promise<void>
}

/** Reuse the transactional persistence engine in a SEPARATE request-count ledger.
 * Its legacy field names are implementation details: every reservation is exactly
 * one request, and failed/aborted attempts also permanently consume that request.
 * Never share this ledger with paid Mira or display its units as money.
 */
export function durableGroqRequestQuota(counter: DurableMiraBudget): GroqRequestQuota {
  return { reserve: (id, at) => counter.reserve(id, 1, at), settle: id => counter.settle(id, 1) }
}

export interface GroqMiraHandlerDependencies {
  config: GroqMiraConfig
  quota: GroqRequestQuota
  provider: StudioProvider | null
  now?: () => number
  requestId?: () => string
  gate?: MiraTrafficGate
}

/** Local owner-supervised demo, not public authentication. Never use forwarded IP/Host headers.
 * The expected origin comes from config (each preserved version copy runs on its own port),
 * never a hardcoded literal — a hardcoded port here would silently 403 every copy that
 * isn't running on that exact port. */
export function isLocalGroqRequest(request: Request, remoteAddress: string | undefined, allowedOrigin: string, allowMissingOrigin = false): boolean {
  const localSocket = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  const suppliedOrigin = request.headers.get('origin')
  let expectedHost: string
  try { expectedHost = new URL(allowedOrigin).host } catch { return false }
  return localSocket && new URL(request.url).origin === allowedOrigin && request.headers.get('host') === expectedHost
    && (suppliedOrigin === allowedOrigin || (allowMissingOrigin && suppliedOrigin === null))
}

/** Validates trusted transport and DTO even if called through an already-validated router. */
export function createGroqMiraHandler(d: GroqMiraHandlerDependencies) {
  const now = d.now ?? Date.now, gate = d.gate ?? new MiraTrafficGate(d.config.requestsPerMinute, d.config.maxConcurrent, now)
  return async (request: Request, suppliedDto?: StudioMiraRequest, remoteAddress?: string): Promise<Response> => {
    if (request.method !== 'POST') return creationJson({ error: 'POST required' }, 405)
    if (!isLocalGroqRequest(request, remoteAddress, d.config.allowedOrigin) || request.headers.get('origin') !== d.config.allowedOrigin) return creationJson({ error: 'Local NADI origin required' }, 403)
    if (request.headers.get('content-type')?.toLowerCase().split(';')[0].trim() !== 'application/json') return creationJson({ error: 'JSON required' }, 415)
    let dto: StudioMiraRequest | null
    try { dto = parseStudioMiraRequest(suppliedDto ?? JSON.parse(await readCreationBody(request, 16384))) } catch { dto = null }
    if (!dto) return creationJson({ error: 'Invalid multitrack help request' }, 400)
    const fallback = (reason: string, sent = false) => creationJson(authoredStudioResponse(dto, reason, sent ? 'sent' : 'not-sent'))
    if (![dto.question, ...dto.history.map(item => item.text), ...((dto.version === 4 || dto.version === 5 || dto.version === 6) && dto.session ? [dto.session.goal] : [])].every(studioTextSafe)) return creationJson({ ...authoredStudioResponse(dto, 'local-safety'), selection: { ...authoredStudioResponse(dto).selection, topic: null, stepIds: [] } })
    if ((dto.version !== 4 && dto.version !== 5 && dto.version !== 6) && unsupportedStudioQuestion(dto.question)) return fallback('unsupported-local')
    if (!groqReadiness(d.config).ready || !d.provider) return fallback('live-disabled')
    // All physically supervised local browsers share one gate; changing cookies cannot reset it.
    const admission = gate.enter('local-owner-demo')
    if (!admission.ok) return fallback('rate-limited')
    try {
      const id = d.requestId?.() ?? crypto.randomUUID()
      try { if (!(await d.quota.reserve(id, new Date(now()).toISOString())).ok) return fallback('quota-unavailable') } catch { return fallback('quota-unavailable') }
      const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined
      let result: StudioProviderResult | null = null, timedOut = false
      try {
        // One provider attempt, no retry or fallback provider. Failures consume a request too.
        result = await Promise.race([d.provider.createResponse(dto, controller.signal), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Timeout')) }, d.config.providerTimeoutMs) })])
      } catch { result = { selection: null, failureReason: timedOut ? 'provider-timeout' : 'provider-unavailable' } }
      finally { clearTimeout(timeout); controller.abort() }
      try { await d.quota.settle(id) } catch { return fallback('quota-unavailable', true) }
      if (result?.failureReason && STUDIO_PROVIDER_FAILURES.includes(result.failureReason)) return fallback(result.failureReason, result.transmission !== 'not-sent')
      if (!result || !validateStudioSelection(result.selection, dto)) { console.warn('[Mira Groq diagnostic] handler selection rejected'); return fallback('invalid-ai-response', true) }
      if (!studioTextSafe(result.selection.explanation)
        || !screenMiraOutput({ observation: result.selection.explanation, intentionConnection: '', nextStep: '', question: null, proposal: null }).safe) { console.warn('[Mira Groq diagnostic] handler policy rejected'); return fallback('invalid-ai-response', true) }
      return creationJson({ ...authoredStudioResponse(dto), source: 'live', reason: 'validated-groq-selection', transmission: 'sent', selection: result.selection })
    } finally { admission.leave() }
  }
}
