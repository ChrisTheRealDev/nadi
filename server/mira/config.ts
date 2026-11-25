export interface MiraServerConfig {
  enabled: boolean
  apiKey: string | null
  spendCapMicrousd: number
  maxRequestCostMicrousd: number
  model: string
  modelCostBoundVerified: boolean
  inputCostMicrousdPerToken: number
  outputCostMicrousdPerToken: number
  minimumRequestCostMicrousd: number
  allowedOrigin: string
  approvedTeenCohortIds: readonly string[]
  capabilitySecret: string | null
  maxOutputTokens: number
  providerTimeoutMs: number
  requestsPerMinute: number
  maxConcurrent: number
}

export interface MiraServerReadiness {
  ready: boolean
  enabled: boolean
  hasApiKey: boolean
  hasPositiveSpendCap: boolean
  hasRequestCostBound: boolean
  modelCostBoundVerified: boolean
  hasCapabilitySecret: boolean
  hasApprovedTeenCohort: boolean
}

export function loadMiraServerConfig(env: Readonly<Record<string, string | undefined>>): MiraServerConfig {
  const model = boundedString(env.MIRA_MODEL, 1, 100) ?? 'gpt-6-astra'
  const maxOutputTokens = positiveInteger(env.MIRA_MAX_OUTPUT_TOKENS, 320, 800)
  const knownAstra = model === 'gpt-6-astra'
  const inputCostMicrousdPerToken = knownAstra ? 10 : positiveInteger(env.MIRA_VERIFIED_INPUT_MICROUSD_PER_TOKEN, 0, 10_000)
  const outputCostMicrousdPerToken = knownAstra ? 50 : positiveInteger(env.MIRA_VERIFIED_OUTPUT_MICROUSD_PER_TOKEN, 0, 10_000)
  const modelCostBoundVerified = knownAstra || (env.MIRA_MODEL_COST_BOUND_VERIFIED === 'true' && inputCostMicrousdPerToken > 0 && outputCostMicrousdPerToken > 0)
  // 16k is conservative for the bounded 8 KiB DTO plus fixed instructions and JSON framing.
  const minimumRequestCostMicrousd = 16_000 * inputCostMicrousdPerToken + maxOutputTokens * outputCostMicrousdPerToken
  return {
    enabled: env.MIRA_LIVE_ENABLED === 'true',
    apiKey: secret(env.OPENAI_API_KEY),
    spendCapMicrousd: positiveInteger(env.MIRA_SPEND_CAP_MICROUSD, 0, Number.MAX_SAFE_INTEGER),
    maxRequestCostMicrousd: positiveInteger(env.MIRA_MAX_REQUEST_COST_MICROUSD, 0, 10_000_000),
    model,
    modelCostBoundVerified,
    inputCostMicrousdPerToken,
    outputCostMicrousdPerToken,
    minimumRequestCostMicrousd,
    allowedOrigin: validOrigin(env.MIRA_ALLOWED_ORIGIN) ?? 'http://127.0.0.1:4174',
    approvedTeenCohortIds: cohortIds(env.MIRA_APPROVED_TEEN_COHORTS),
    capabilitySecret: capabilitySecret(env.MIRA_CAPABILITY_SECRET),
    maxOutputTokens,
    providerTimeoutMs: positiveInteger(env.MIRA_PROVIDER_TIMEOUT_MS, 8_000, 20_000),
    requestsPerMinute: positiveInteger(env.MIRA_REQUESTS_PER_MINUTE, 6, 30),
    maxConcurrent: positiveInteger(env.MIRA_MAX_CONCURRENT, 2, 4),
  }
}

export function miraServerReadiness(config: MiraServerConfig): MiraServerReadiness {
  const result = {
    enabled: config.enabled,
    hasApiKey: Boolean(config.apiKey),
    hasPositiveSpendCap: config.spendCapMicrousd > 0,
    hasRequestCostBound: config.minimumRequestCostMicrousd > 0 &&
      config.maxRequestCostMicrousd >= config.minimumRequestCostMicrousd &&
      config.maxRequestCostMicrousd <= config.spendCapMicrousd,
    modelCostBoundVerified: config.modelCostBoundVerified,
    hasCapabilitySecret: Boolean(config.capabilitySecret),
    hasApprovedTeenCohort: config.approvedTeenCohortIds.length > 0,
  }
  return { ...result, ready: Object.values(result).every(Boolean) }
}

export function publicMiraServerStatus(config: MiraServerConfig): MiraServerReadiness {
  return miraServerReadiness(config)
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback
}

function boundedString(value: string | undefined, min: number, max: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length >= min && trimmed.length <= max ? trimmed : undefined
}

function secret(value: string | undefined): string | null {
  const trimmed = boundedString(value, 20, 300)
  return trimmed ?? null
}

function capabilitySecret(value: string | undefined): string | null {
  const trimmed = boundedString(value, 32, 300)
  return trimmed ?? null
}

function validOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.origin === value && ['http:', 'https:'].includes(parsed.protocol) ? value : undefined
  } catch {
    return undefined
  }
}

function cohortIds(value: string | undefined): string[] {
  if (!value) return []
  const ids = value.split(',').map((item) => item.trim()).filter((item) => /^[A-Za-z0-9_-]{3,64}$/.test(item))
  return [...new Set(ids)].slice(0, 20)
}
