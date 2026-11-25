import { STUDIO_SELECTION_SCHEMA, STUDIO_SELECTION_V5_SCHEMA, STUDIO_SELECTION_V6_SCHEMA, normalizeStudioProviderSelection, studioV6RejectionReason, type StudioMiraRequest } from '../../src/creation/v4/miraContract'
import { readCreationBody } from './creationHandler'
import { boundedStudioProviderBody, studioProviderInstructions } from './studioProvider'
import type { StudioProvider, StudioProviderFailure, StudioProviderResult } from './studioHandler'

export const GROQ_STUDIO_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'] as const
export const GROQ_STUDIO_DEFAULT_MODEL = GROQ_STUDIO_MODELS[0]
export const GROQ_STUDIO_MAX_OUTPUT_TOKENS = 2048
export interface GroqStudioConfig { apiKey: string; model?: string; maxOutputTokens?: number }
const endpoint = 'https://api.groq.com/openai/v1/chat/completions'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const failed = (failureReason: StudioProviderFailure, usage?: StudioProviderResult['usage']): StudioProviderResult => ({ selection: null, failureReason, ...(usage ? { usage } : {}) })
const notSent = (failureReason: StudioProviderFailure): StudioProviderResult => ({ ...failed(failureReason), transmission: 'not-sent', usage: { inputTokens: 0, outputTokens: 0 } })

async function httpFailure(response: Response): Promise<StudioProviderFailure> {
  console.warn('[Mira Groq diagnostic] HTTP status', response.status)
  if (response.status === 401 || response.status === 403) return 'provider-auth'
  if (response.status === 429) return 'provider-rate-limited'
  if (response.status === 404) return 'provider-model-unavailable'
  // Inspect only known error codes. Messages and raw bodies must never cross the adapter.
  if (response.status === 400 && response.headers.get('content-type')?.includes('application/json')) {
    try {
      const raw: unknown = JSON.parse(await readCreationBody(response, 64000))
      const code = record(raw) && record(raw.error) ? raw.error.code : undefined
      console.warn('[Mira Groq diagnostic] HTTP code', ['model_not_found', 'model_decommissioned', 'model_not_supported', 'json_validate_failed', 'generation_failed'].includes(String(code)) ? String(code) : 'other')
      if (code === 'model_not_found' || code === 'model_decommissioned' || code === 'model_not_supported') return 'provider-model-unavailable'
      if (code === 'json_validate_failed' || code === 'generation_failed') return 'invalid-ai-response'
    } catch { /* An unreadable provider error remains a generic provider failure. */ }
  }
  return 'provider-unavailable'
}

/** Dedicated Groq adapter: no retries, cross-provider fallback, tools or configurable host. */
export function createGroqStudioProvider(config: GroqStudioConfig, fetchImpl: typeof fetch = fetch): StudioProvider {
  return { createResponse: async (dto: StudioMiraRequest, signal: AbortSignal): Promise<StudioProviderResult> => {
    const model = config.model ?? GROQ_STUDIO_DEFAULT_MODEL, maxTokens = config.maxOutputTokens ?? GROQ_STUDIO_MAX_OUTPUT_TOKENS
    if (signal.aborted) return notSent('provider-timeout')
    if (!config.apiKey.trim() || !GROQ_STUDIO_MODELS.some(value => value === model)
      || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > GROQ_STUDIO_MAX_OUTPUT_TOKENS) return notSent('provider-config-invalid')
    // Groq's strict Structured Outputs supports these two models; reasoning tokens
    // share the completion cap. See https://console.groq.com/docs/structured-outputs
    const body = boundedStudioProviderBody(dto, data => JSON.stringify({ model, max_completion_tokens: maxTokens, reasoning_effort: 'low', include_reasoning: false, stream: false,
      messages: [
        { role: 'system', content: studioProviderInstructions(dto) },
        { role: 'user', content: JSON.stringify(data) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'nadi_multitrack_help', strict: true, schema: dto.version === 6 ? STUDIO_SELECTION_V6_SCHEMA : dto.version === 5 ? STUDIO_SELECTION_V5_SCHEMA : STUDIO_SELECTION_SCHEMA } },
    }))
    if (body === null) return notSent('request-too-large')
    let receivedResponse = false
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', signal, redirect: 'error', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }, body })
      receivedResponse = true
      if (signal.aborted) return failed('provider-timeout')
      if (!response.ok) return failed(await httpFailure(response))
      if (!response.headers.get('content-type')?.includes('application/json')) return failed('invalid-ai-response')
      const raw: unknown = JSON.parse(await readCreationBody(response, 64000))
      if (!record(raw)) return failed('invalid-ai-response')
      const u = raw.usage
      const usage = record(u) && Number.isSafeInteger(u.prompt_tokens) && Number(u.prompt_tokens) >= 0 && Number.isSafeInteger(u.completion_tokens) && Number(u.completion_tokens) >= 0
        ? { inputTokens: Number(u.prompt_tokens), outputTokens: Number(u.completion_tokens) } : undefined
      if (signal.aborted) return failed('provider-timeout', usage)
      if (raw.error || !Array.isArray(raw.choices) || raw.choices.length !== 1) return failed('invalid-ai-response', usage)
      const choice: unknown = raw.choices[0]
      if (!record(choice) || choice.finish_reason !== 'stop' || !record(choice.message)) {
        console.warn('[Mira Groq diagnostic] finish', record(choice) && ['length', 'tool_calls', 'content_filter', 'stop'].includes(String(choice.finish_reason)) ? String(choice.finish_reason) : 'other')
        return failed('invalid-ai-response', usage)
      }
      const message = choice.message
      if (message.role !== 'assistant' || message.refusal || message.function_call
        || (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0))
        || (message.executed_tools != null && (!Array.isArray(message.executed_tools) || message.executed_tools.length > 0))
        || typeof message.content !== 'string') { console.warn('[Mira Groq diagnostic] invalid message or refusal'); return failed('invalid-ai-response', usage) }
      try {
        const parsed: unknown = JSON.parse(message.content)
        const selection = normalizeStudioProviderSelection(parsed, dto)
        if (!selection) {
          const structuredText = record(parsed) && ['observation', 'rationale', 'action'].every(key => typeof parsed[key] === 'string' && String(parsed[key]).trim())
          const textLength = structuredText && record(parsed) ? [parsed.observation, parsed.rationale, parsed.action].join('\n\n').length : 0
          console.warn('[Mira Groq diagnostic] selection normalization rejected', dto.version === 6 ? studioV6RejectionReason(parsed, dto) : structuredText ? textLength > 1200 ? 'text-over-limit' : 'shape-or-guidance' : 'missing-text')
        }
        return selection ? { selection: dto.version === 5 ? { ...selection, example: null, exampleError: null } : selection, usage } : failed('invalid-ai-response', usage)
      } catch { console.warn('[Mira Groq diagnostic] selection JSON invalid'); return failed('invalid-ai-response', usage) }
    } catch {
      // Transport/body failures have uncertain usage; the handler retains its
      // reservation. Never echo provider bodies or retry using another service.
      return failed(signal.aborted ? 'provider-timeout' : receivedResponse ? 'invalid-ai-response' : 'provider-unavailable')
    }
  } }
}
