import { authoredMiraResponse, authoredSafeRedirect, reportControl } from '../../src/lib/mira/authoredAdapter'
import { MIRA_REQUEST_MAX_BYTES, parseMiraRequest, type MiraRequestDto, type MiraResponseDto } from '../../src/lib/mira/contracts'
import type { DurableMiraBudget, MiraBudgetReservation } from './budget'
import {
  issueTeenCapability,
  readMiraCapabilityCookie,
  serializeMiraCapabilityCookie,
  type CapabilityOptions,
  type MiraCapabilityClaims,
} from './capability'
import { miraServerReadiness, type MiraServerConfig } from './config'
import { MiraTrafficGate, screenMiraInput, screenMiraOutput } from './policy'
import type { MiraProvider, MiraProviderResult } from './provider'

export interface MiraHandlerDependencies {
  config: MiraServerConfig
  budget: DurableMiraBudget
  provider: MiraProvider | null
  verifyCapability: (token: string | undefined) => Promise<MiraCapabilityClaims | null>
  now?: () => number
  requestId?: () => string
  trafficGate?: MiraTrafficGate
}

export function createMiraHandler(dependencies: MiraHandlerDependencies): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? Date.now
  const requestId = dependencies.requestId ?? (() => crypto.randomUUID())
  const gate = dependencies.trafficGate ?? new MiraTrafficGate(
    dependencies.config.requestsPerMinute,
    dependencies.config.maxConcurrent,
    now,
  )
  return async (request) => {
    const id = requestId()
    if (request.method !== 'POST') return jsonResponse({ status: 'method-not-allowed', requestId: id }, 405, { allow: 'POST' })
    if (request.headers.get('origin') !== dependencies.config.allowedOrigin) return jsonResponse({ status: 'forbidden-origin', requestId: id }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return jsonResponse({ status: 'invalid-content-type', requestId: id }, 415)
    let dto: MiraRequestDto
    try {
      const rawBody = await readBoundedRequest(request, MIRA_REQUEST_MAX_BYTES)
      const parsed = parseMiraRequest(JSON.parse(rawBody) as unknown)
      if (!parsed.ok || !parsed.value) return invalidRequestFallback(id)
      dto = parsed.value
    } catch {
      return invalidRequestFallback(id)
    }
    const inputPolicy = screenMiraInput(dto)
    if (!inputPolicy.safe) return responseDto(authoredSafeRedirect(id))
    const readiness = miraServerReadiness(dependencies.config)
    if (!readiness.ready || !dependencies.provider) return responseDto(authoredMiraResponse(dto, id, 'live-disabled'))
    let capability: MiraCapabilityClaims | null
    try {
      capability = await dependencies.verifyCapability(readMiraCapabilityCookie(request.headers.get('cookie')))
    } catch {
      capability = null
    }
    if (!capability) return responseDto(authoredMiraResponse(dto, id, 'authorization-required'))
    const admission = gate.enter(capability.sessionId)
    if (!admission.ok) {
      const category = admission.reason === 'rate' ? 'rate-limited' : 'rate-limited'
      return responseDto(authoredMiraResponse(dto, id, category), 429)
    }
    try {
      let reserved: MiraBudgetReservation | { ok: false }
      try {
        reserved = await dependencies.budget.reserve(id, dependencies.config.maxRequestCostMicrousd, new Date(now()).toISOString())
        if (!reserved.ok) return responseDto(authoredMiraResponse(dto, id, 'budget-unavailable'))
      } catch {
        return responseDto(authoredMiraResponse(dto, id, 'budget-unavailable'))
      }
      const reservation = reserved
      const controller = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      let providerResult: MiraProviderResult
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Mira provider timed out'))
          }, dependencies.config.providerTimeoutMs)
        })
        providerResult = await Promise.race([dependencies.provider.createResponse(dto, controller.signal), deadline])
      } catch {
        providerResult = { status: 'error' }
      } finally {
        if (timeout) clearTimeout(timeout)
        controller.abort()
      }
      const actualCost = providerResult.status === 'completed' && providerResult.usage
        ? providerResult.usage.inputTokens * dependencies.config.inputCostMicrousdPerToken +
          providerResult.usage.outputTokens * dependencies.config.outputCostMicrousdPerToken
        : undefined
      try {
        await dependencies.budget.settle(id, Number.isSafeInteger(actualCost) ? actualCost : undefined)
      } catch {
        // The durable reservation was already committed before outbound. If
        // settlement storage fails, retain it and return a content-free fallback.
        return responseDto(providerFallback(dto, id, 'provider-error', 'failed', reservation))
      }
      if (providerResult.status !== 'completed') {
        const category = providerResult.status === 'refusal' ? 'refusal'
          : providerResult.status === 'incomplete' ? 'incomplete' : 'provider-error'
        const liveStatus = providerResult.status === 'refusal' ? 'refused'
          : providerResult.status === 'incomplete' ? 'incomplete' : 'failed'
        return responseDto(providerFallback(dto, id, category, liveStatus, reservation))
      }
      if (!screenMiraOutput(providerResult.payload).safe) {
        return responseDto(providerFallback(dto, id, 'filtered', 'failed', reservation, true))
      }
      if (providerResult.payload.proposal &&
          providerResult.payload.proposal.targetIds.some((targetId) => !dto.project.selectedArtifactIds.includes(targetId))) {
        return responseDto(providerFallback(dto, id, 'filtered', 'failed', reservation))
      }
      return responseDto({
        version: 1,
        source: 'live',
        category: 'answer',
        requestId: id,
        liveStatus: 'completed',
        content: providerResult.payload,
        report: reportControl(),
        privacy: {
          transmission: 'sent',
          notice: 'The bounded request reached the online AI path. Standard provider abuse-monitoring retention may apply; store:false is not Zero Data Retention.',
        },
        budget: budgetMetadata(reservation),
      })
    } finally {
      admission.leave()
    }
  }
}

export interface MiraCapabilityIssueDependencies {
  config: MiraServerConfig
  authorizeSupervisor: (request: Request) => boolean | Promise<boolean>
  capability: CapabilityOptions
  now?: () => number
  nonce?: () => string
}

export function createMiraCapabilityIssueHandler(dependencies: MiraCapabilityIssueDependencies): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? Date.now
  const nonce = dependencies.nonce ?? (() => crypto.randomUUID())
  return async (request) => {
    if (request.method !== 'POST' || request.headers.get('origin') !== dependencies.config.allowedOrigin) return jsonResponse({ status: 'forbidden' }, 403)
    if (!await dependencies.authorizeSupervisor(request)) return jsonResponse({ status: 'supervisor-required' }, 403)
    try {
      const value = JSON.parse(await readBoundedRequest(request, 1_024)) as unknown
      if (!isCapabilityIssueBody(value) || !dependencies.config.approvedTeenCohortIds.includes(value.cohortId)) {
        return jsonResponse({ status: 'invalid-request' }, 400)
      }
      const durationSeconds = Math.min(14_400, value.durationMinutes * 60)
      const issued = await issueTeenCapability({
        cohortId: value.cohortId,
        sessionId: value.sessionId,
        nonce: nonce(),
        ttlSeconds: durationSeconds,
      }, { ...dependencies.capability, now })
      return jsonResponse(
        { status: 'issued', expiresAt: issued.expiresAt },
        200,
        { 'set-cookie': serializeMiraCapabilityCookie(issued.token, durationSeconds, dependencies.config.allowedOrigin.startsWith('https://')) },
      )
    } catch {
      return jsonResponse({ status: 'invalid-request' }, 400)
    }
  }
}

function providerFallback(
  dto: MiraRequestDto,
  requestId: string,
  category: MiraResponseDto['category'],
  liveStatus: MiraResponseDto['liveStatus'],
  reservation: MiraBudgetReservation,
  safetyRedirect = false,
): MiraResponseDto {
  const base = safetyRedirect ? authoredSafeRedirect(requestId) : authoredMiraResponse(dto, requestId, category, 'sent')
  return {
    ...base,
    category,
    liveStatus,
    content: { ...base.content, proposal: null },
    privacy: {
      transmission: 'sent',
      notice: 'The bounded request reached the online AI path. Standard provider abuse-monitoring retention may apply; store:false is not Zero Data Retention.',
    },
    budget: budgetMetadata(reservation),
  }
}

function budgetMetadata(reservation: MiraBudgetReservation): NonNullable<MiraResponseDto['budget']> {
  return { reservedMicrousd: reservation.reservedMicrousd, remainingMicrousd: reservation.remainingMicrousd }
}

function invalidRequestFallback(requestId: string): Response {
  return jsonResponse({
    version: 1,
    source: 'authored',
    category: 'invalid-request',
    requestId,
    liveStatus: 'not-attempted',
    content: {
      observation: 'Mira could not use that request.',
      intentionConnection: 'The studio kept the online path closed.',
      nextStep: 'Return to the lesson and try the local help button again.',
      question: null,
      proposal: null,
    },
    report: reportControl(),
    privacy: { transmission: 'not-sent', notice: 'The request was rejected locally and was not sent to an online AI provider.' },
    budget: null,
  } satisfies MiraResponseDto, 400)
}

function responseDto(body: MiraResponseDto, status = 200): Response {
  return jsonResponse(body, status)
}

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  })
}

async function readBoundedRequest(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Request too large')
  if (!request.body) throw new Error('Request body missing')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Request too large')
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isCapabilityIssueBody(value: unknown): value is { cohortId: string; sessionId: string; durationMinutes: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 3 && ['cohortId', 'sessionId', 'durationMinutes'].every((key) => Object.hasOwn(record, key)) &&
    typeof record.cohortId === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(record.cohortId) &&
    typeof record.sessionId === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(record.sessionId) &&
    typeof record.durationMinutes === 'number' && Number.isInteger(record.durationMinutes) && record.durationMinutes >= 1 && record.durationMinutes <= 240
}
