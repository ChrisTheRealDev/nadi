import { allowedTeachingActions, parseTutorInterpretation, parseTutorSummaryRequest, type TutorInterpretation, type TutorSummaryRequest } from '../../src/tracking/tutorSummaryData'
import { creationJson, readCreationBody } from './creationHandler'
import { groqReadiness, type GroqMiraConfig } from './groqConfig'
import { isLocalGroqRequest, type GroqRequestQuota } from './groqHandler'
import { MiraTrafficGate } from './policy'

export interface TutorSummaryDependencies {
  config: GroqMiraConfig
  quota: GroqRequestQuota
  fetchImpl?: typeof fetch
  now?: () => number
  requestId?: () => string
  gate?: MiraTrafficGate
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const INSTRUCTIONS = 'You select up to four useful review priorities for a music tutor from numeric evidence. Input contains only measured counts and revision comparisons. Return JSON claims with evidenceId and action. Use only supplied IDs and their allowed actions. Never infer practice time, ability, motivation, understanding, misconduct or musical quality. The user interface supplies the factual descriptions; do not write prose or invent facts. Counts of added/removed identities can include reorganizing or copying music, not just new composing. Zero activity does not show absence of practice. Prioritize observed changes and nonzero playability findings when present.'

async function generate(request: TutorSummaryRequest, d: TutorSummaryDependencies, signal: AbortSignal): Promise<TutorInterpretation | null> {
  if (signal.aborted) return null
  const response = await (d.fetchImpl ?? fetch)('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', signal, redirect: 'error', headers: { authorization: `Bearer ${d.config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: d.config.model, max_completion_tokens: Math.min(d.config.maxOutputTokens, 1024), reasoning_effort: 'low', include_reasoning: false, stream: false,
      messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: JSON.stringify({ evidence: request.evidence, allowedActions: Object.fromEntries(request.evidence.facts.map(f => [f.id, allowedTeachingActions(f.id)])) }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'nadi_tutor_review_priorities', strict: true, schema: { type: 'object', additionalProperties: false, required: ['claims'], properties: {
        claims: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['evidenceId', 'action'], properties: {
          evidenceId: { type: 'string', enum: request.evidence.facts.map(f => f.id) }, action: { type: 'string', enum: ['listen-and-compare', 'ask-about-choice', 'review-with-performer', 'ask-what-help-is-needed'] },
        } } },
      } } } },
    }),
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null
  const raw: unknown = JSON.parse(await readCreationBody(response, 32000))
  if (!record(raw) || !Array.isArray(raw.choices) || raw.choices.length !== 1 || raw.error) return null
  const choice = raw.choices[0]
  if (!record(choice) || choice.finish_reason !== 'stop' || !record(choice.message)) return null
  const message = choice.message
  if (message.role !== 'assistant' || message.refusal || message.function_call || (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length)) || (message.executed_tools != null && (!Array.isArray(message.executed_tools) || message.executed_tools.length)) || typeof message.content !== 'string') return null
  return parseTutorInterpretation(JSON.parse(message.content), request.evidence)
}

/** Explicit local adult-demo request only. Shares the durable Groq quota; no paid fallback, retry or auto-call. */
export function createTutorSummaryHandler(d: TutorSummaryDependencies) {
  const now = d.now ?? Date.now, gate = d.gate ?? new MiraTrafficGate(d.config.requestsPerMinute, d.config.maxConcurrent, now)
  return async (request: Request, remoteAddress?: string): Promise<Response> => {
    if (request.method !== 'POST') return creationJson({ error: 'POST required' }, 405)
    if (!isLocalGroqRequest(request, remoteAddress, d.config.allowedOrigin) || request.headers.get('origin') !== d.config.allowedOrigin) return creationJson({ error: 'Local NADI origin required' }, 403)
    if (request.headers.get('content-type')?.toLowerCase().split(';')[0].trim() !== 'application/json') return creationJson({ error: 'JSON required' }, 415)
    let dto: TutorSummaryRequest | null
    try { dto = parseTutorSummaryRequest(JSON.parse(await readCreationBody(request, 8192))) } catch { dto = null }
    if (!dto) return creationJson({ error: 'Invalid numeric tutor evidence' }, 400)
    const fallback = (reason: string, sent = false) => creationJson({ requestId: dto.requestId, revision: dto.evidence.revision, source: 'deterministic', reason, sent, interpretation: null })
    if (request.signal.aborted) return fallback('cancelled')
    if (!groqReadiness(d.config).ready) return fallback('configured-groq-unavailable')
    const admission = gate.enter('local-owner-demo')
    if (!admission.ok) return fallback('rate-limited')
    try {
      const id = d.requestId?.() ?? crypto.randomUUID()
      try { if (!(await d.quota.reserve(id, new Date(now()).toISOString())).ok) return fallback('quota-unavailable') } catch { return fallback('quota-unavailable') }
      if (request.signal.aborted) { try { await d.quota.settle(id) } catch { return fallback('quota-unavailable') } return fallback('cancelled') }
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
      const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true })
      let interpretation: TutorInterpretation | null = null
      try {
        interpretation = await Promise.race([generate(dto, d, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout')) }, d.config.providerTimeoutMs) })])
      } catch { /* Never echo provider content or retry another provider. */ }
      finally { clearTimeout(timer); controller.abort(); request.signal.removeEventListener('abort', abort) }
      try { await d.quota.settle(id) } catch { return fallback('quota-unavailable', true) }
      if (!interpretation) return fallback('provider-unavailable-or-invalid', true)
      return creationJson({ requestId: dto.requestId, revision: dto.evidence.revision, source: 'ai-selection', reason: 'validated-evidence-selection', sent: true, interpretation })
    } finally { admission.leave() }
  }
}
