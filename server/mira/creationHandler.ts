import { parseCreationRequest, type CreationMiraRequest, type CreationMiraSelection } from '../../src/creation/mira/contracts'
import { authoredResponse, classifyQuestion, validateSelection } from '../../src/creation/mira/registry'
import type { DurableMiraBudget } from './budget'
import { readMiraCapabilityCookie, type MiraCapabilityClaims } from './capability'
import { miraServerReadiness, type MiraServerConfig } from './config'
import { MiraTrafficGate, screenMiraInput } from './policy'
import { parseStudioMiraRequest } from '../../src/creation/v4/miraContract'
import { createStudioMiraHandler, type StudioProvider } from './studioHandler'
export interface CreationProviderResult { selection: CreationMiraSelection | null; usage?: { inputTokens: number; outputTokens: number } }
export interface CreationProvider { createResponse: (request: CreationMiraRequest, signal: AbortSignal) => Promise<CreationProviderResult> }
export interface CreationHandlerDependencies {
  config: MiraServerConfig; budget: DurableMiraBudget; provider: CreationProvider | null
  verifyCapability: (token: string | undefined) => Promise<MiraCapabilityClaims | null>
  requestId?: () => string; now?: () => number
  studioProvider?: StudioProvider | null
}
export function creationInputSafe(dto: CreationMiraRequest): boolean {
  // Reuse the established local pre-transmission safety screen, not lesson contracts on the wire.
  return screenMiraInput({ version: 1, question: dto.question, intention: '', lessonId: 'creation', objectiveId: 'creation', facts: [], attempt: { summary: '', support: 'cue' }, project: { id: dto.workspace.projectId, revision: dto.workspace.revision, contentFingerprint: 'fnv1a32-00000000', selectedArtifactIds: [] } }).safe
}
export function creationJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
export async function readCreationBody(request: Request | Response, limit = 4096): Promise<string> {
  if (!request.body || Number(request.headers.get('content-length')) > limit) throw new Error('Invalid body')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0
  while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('Body too large') } chunks.push(chunk.value) }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export function createCreationMiraHandler(d: CreationHandlerDependencies) {
  const now = d.now ?? Date.now, gate = new MiraTrafficGate(d.config.requestsPerMinute, d.config.maxConcurrent, now)
  const studioHandler = createStudioMiraHandler(d, gate)
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return creationJson({ error: 'POST required' }, 405)
    if (request.headers.get('origin') !== d.config.allowedOrigin) return creationJson({ error: 'Forbidden origin' }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return creationJson({ error: 'JSON required' }, 415)
    let dto: CreationMiraRequest | null
    try {
      const body: unknown = JSON.parse(await readCreationBody(request, 16384))
      if (body && typeof body === 'object' && 'version' in body && (body.version === 2 || body.version === 3 || body.version === 4 || body.version === 5 || body.version === 6)) {
        const studio = parseStudioMiraRequest(body)
        return studio ? studioHandler(request, studio) : creationJson({ error: 'Invalid multitrack help request' }, 400)
      }
      dto = parseCreationRequest(body)
    } catch { dto = null }
    if (!dto) return creationJson({ error: 'Invalid creation request' }, 400)
    const fallback = (reason: string, sent = false) => creationJson(authoredResponse(dto!, reason, sent ? 'sent' : 'not-sent'))
    if (!creationInputSafe(dto)) return creationJson({ ...authoredResponse(dto, 'local-safety'), selection: { topic: null, stepIds: [] } })
    // Authored classification is an immediate fallback, not a restriction on live semantic interpretation.
    if (!miraServerReadiness(d.config).ready || !d.provider) return fallback(classifyQuestion(dto.question) ? 'live-disabled' : 'unsupported-local')
    let claims: MiraCapabilityClaims | null = null
    try { claims = await d.verifyCapability(readMiraCapabilityCookie(request.headers.get('cookie'))) } catch { /* Fail closed. */ }
    if (!claims || claims.audience !== 'teen' || !d.config.approvedTeenCohortIds.includes(claims.cohortId)) return fallback('authorization-required')
    const admission = gate.enter(claims.sessionId)
    if (!admission.ok) return fallback('rate-limited')
    try {
      const id = d.requestId?.() ?? crypto.randomUUID()
      try { if (!(await d.budget.reserve(id, d.config.maxRequestCostMicrousd, new Date(now()).toISOString())).ok) return fallback('budget-unavailable') } catch { return fallback('budget-unavailable') }
      const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined
      let result: CreationProviderResult = { selection: null }
      try {
        result = await Promise.race([d.provider.createResponse(dto, controller.signal), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Timeout')) }, d.config.providerTimeoutMs) })])
      } catch { /* Reservation retained for uncertain outbound cost. */ }
      finally { clearTimeout(timeout); controller.abort() }
      const cost = result.usage ? result.usage.inputTokens * d.config.inputCostMicrousdPerToken + result.usage.outputTokens * d.config.outputCostMicrousdPerToken : undefined
      try { await d.budget.settle(id, Number.isSafeInteger(cost) ? cost : undefined) } catch { return fallback('budget-unavailable', true) }
      if (!validateSelection(result.selection, dto.workspace)) return fallback('invalid-ai-response', true)
      return creationJson({ ...authoredResponse(dto), source: 'live', reason: 'validated-selection', transmission: 'sent', selection: result.selection })
    } finally { admission.leave() }
  }
}
