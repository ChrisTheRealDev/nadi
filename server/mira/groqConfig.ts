export const GROQ_MIRA_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'] as const

/** Free-tier demo policy. Request quota units are calls, never a currency estimate. */
export interface GroqMiraConfig {
  enabled: boolean
  apiKey: string | null
  freeTierConfirmed: boolean
  adultDemoConfirmed: boolean
  allowedOrigin: string
  model: string
  maxOutputTokens: number
  providerTimeoutMs: number
  requestsPerMinute: number
  maxConcurrent: number
  totalRequestLimit: number
}

export function loadGroqConfig(env: Readonly<Record<string, string | undefined>>): GroqMiraConfig {
  return {
    enabled: env.MIRA_PROVIDER === 'groq' && env.MIRA_LIVE_ENABLED === 'true',
    apiKey: boundedSecret(env.GROQ_API_KEY, 20),
    freeTierConfirmed: env.MIRA_GROQ_FREE_TIER_CONFIRMED === 'true',
    adultDemoConfirmed: env.MIRA_ADULT_DEMO_CONFIRMED === 'true',
    allowedOrigin: env.MIRA_ALLOWED_ORIGIN === undefined ? 'http://127.0.0.1:5176' : validOrigin(env.MIRA_ALLOWED_ORIGIN) ?? '',
    // An explicitly unsupported model remains unsupported; never silently switch providers/models.
    model: (env.MIRA_GROQ_MODEL ?? 'openai/gpt-oss-20b').trim(),
    maxOutputTokens: integer(env.MIRA_GROQ_MAX_OUTPUT_TOKENS, 2048, 2048),
    providerTimeoutMs: integer(env.MIRA_PROVIDER_TIMEOUT_MS, 8000, 20000),
    requestsPerMinute: integer(env.MIRA_REQUESTS_PER_MINUTE, 6, 30),
    maxConcurrent: integer(env.MIRA_MAX_CONCURRENT, 2, 4),
    totalRequestLimit: integer(env.MIRA_GROQ_TOTAL_REQUEST_LIMIT, 100, 1000),
  }
}

export function groqReadiness(config: GroqMiraConfig) {
  const checks = {
    enabled: config.enabled,
    hasApiKey: Boolean(config.apiKey),
    freeTierConfirmed: config.freeTierConfirmed,
    adultDemoConfirmed: config.adultDemoConfirmed,
    // Any 127.0.0.1 loopback origin is a valid local-demo port, not just the original project's 5176:
    // each preserved version copy runs its own dev server on its own port.
    hasLocalDemoOrigin: /^http:\/\/127\.0\.0\.1:\d+$/.test(config.allowedOrigin),
    modelAllowed: GROQ_MIRA_MODELS.some(model => model === config.model),
    hasBoundedRequestQuota: validInteger(config.totalRequestLimit, 1000),
    hasBoundedOutput: validInteger(config.maxOutputTokens, 2048),
    hasBoundedTimeout: validInteger(config.providerTimeoutMs, 20000),
    hasBoundedTraffic: validInteger(config.requestsPerMinute, 30) && validInteger(config.maxConcurrent, 4),
  }
  return { ...checks, ready: Object.values(checks).every(Boolean) }
}

function validInteger(value: number, max: number) { return Number.isSafeInteger(value) && value > 0 && value <= max }
function integer(raw: string | undefined, fallback: number, max: number) { if (raw === undefined) return fallback; const value = Number(raw); return validInteger(value, max) ? value : 0 }
function boundedSecret(raw: string | undefined, min: number) { const value = raw?.trim(); return value && value.length >= min && value.length <= 300 ? value : null }
function validOrigin(raw: string | undefined) { if (!raw) return null; try { const parsed = new URL(raw); return parsed.origin === raw && ['http:', 'https:'].includes(parsed.protocol) ? raw : null } catch { return null } }
