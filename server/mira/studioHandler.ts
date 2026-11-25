import { authoredStudioResponse, validateStudioSelection, type StudioMiraRequest, type StudioMiraSelection } from '../../src/creation/v4/miraContract'
import { creationInputSafe, creationJson, type CreationHandlerDependencies } from './creationHandler'
import { readMiraCapabilityCookie } from './capability'
import { miraServerReadiness } from './config'
import { MiraTrafficGate, screenMiraOutput } from './policy'
import { unsupportedStudioQuestion } from '../../src/creation/v4/studioHelp'

export const STUDIO_PROVIDER_FAILURES = ['provider-auth', 'provider-rate-limited', 'provider-model-unavailable', 'provider-unavailable', 'invalid-ai-response', 'provider-timeout', 'provider-config-invalid', 'request-too-large'] as const
export type StudioProviderFailure = typeof STUDIO_PROVIDER_FAILURES[number]
export interface StudioProviderResult { selection: StudioMiraSelection | null; usage?: { inputTokens: number; outputTokens: number }; failureReason?: StudioProviderFailure; transmission?: 'sent' | 'not-sent' }
export interface StudioProvider { createResponse(request: StudioMiraRequest, signal: AbortSignal): Promise<StudioProviderResult> }
export function studioTextSafe(text: string) {
  return creationInputSafe({ version: 1, question: text, workspace: { projectId: 'local', revision: 0, editor: 'piano', selectedBar: 0, hasPianoNotes: false, hasDrumHits: false, selectedNote: false, visibleDrumRows: [], mutedInstruments: [], saved: false } })
}
export function createStudioMiraHandler(d: CreationHandlerDependencies, gate: MiraTrafficGate) {
  const now = d.now ?? Date.now
  return async (request: Request, dto: StudioMiraRequest): Promise<Response> => {
    const fallback = (reason: string, sent = false) => creationJson(authoredStudioResponse(dto, reason, sent ? 'sent' : 'not-sent'))
    if (![dto.question, ...dto.history.map(item => item.text), ...((dto.version === 4 || dto.version === 5 || dto.version === 6) && dto.session ? [dto.session.goal] : [])].every(studioTextSafe)) return creationJson({ ...authoredStudioResponse(dto, 'local-safety'), selection: { ...authoredStudioResponse(dto).selection, topic: null, stepIds: [] } })
    if ((dto.version !== 4 && dto.version !== 5 && dto.version !== 6) && unsupportedStudioQuestion(dto.question)) return fallback('unsupported-local')
    if (!miraServerReadiness(d.config).ready || !d.studioProvider) return fallback('live-disabled')
    let claims
    try { claims = await d.verifyCapability(readMiraCapabilityCookie(request.headers.get('cookie'))) } catch { return fallback('authorization-required') }
    if (!claims || claims.audience !== 'teen' || !d.config.approvedTeenCohortIds.includes(claims.cohortId)) return fallback('authorization-required')
    const admission = gate.enter(claims.sessionId)
    if (!admission.ok) return fallback('rate-limited')
    try {
      const id = d.requestId?.() ?? crypto.randomUUID()
      try { if (!(await d.budget.reserve(id, d.config.maxRequestCostMicrousd, new Date(now()).toISOString())).ok) return fallback('budget-unavailable') } catch { return fallback('budget-unavailable') }
      const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined
      let result: StudioProviderResult = { selection: null }
      try { result = await Promise.race([d.studioProvider.createResponse(dto, controller.signal), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Timeout')) }, d.config.providerTimeoutMs) })]) } catch { /* Uncertain outbound spend retains its reservation. */ }
      finally { clearTimeout(timeout); controller.abort() }
      const usage = result.usage
      const cost = usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 ? usage.inputTokens * d.config.inputCostMicrousdPerToken + usage.outputTokens * d.config.outputCostMicrousdPerToken : undefined
      try { await d.budget.settle(id, Number.isSafeInteger(cost) ? cost : undefined) } catch { return fallback('budget-unavailable', true) }
      if (result.failureReason && STUDIO_PROVIDER_FAILURES.includes(result.failureReason)) return fallback(result.failureReason, result.transmission !== 'not-sent')
      if (!validateStudioSelection(result.selection, dto) || !studioTextSafe(result.selection.explanation) || !screenMiraOutput({ observation: result.selection.explanation, intentionConnection: '', nextStep: '', question: null, proposal: null }).safe) return fallback('invalid-ai-response', true)
      return creationJson({ ...authoredStudioResponse(dto), source: 'live', reason: 'validated-selection', transmission: 'sent', selection: result.selection })
    } finally { admission.leave() }
  }
}
