import { describe, expect, it } from 'vitest'
import { groqReadiness, loadGroqConfig } from './groqConfig'

const env = { MIRA_PROVIDER: 'groq', MIRA_LIVE_ENABLED: 'true', GROQ_API_KEY: 'gsk_only-a-fixture-not-a-real-secret', MIRA_GROQ_FREE_TIER_CONFIRMED: 'true', MIRA_ADULT_DEMO_CONFIRMED: 'true' }
describe('Groq adult free-tier configuration', () => {
  it('defaults disabled and requires owner confirmations and server key, but no cohort or browser-session secret', () => {
    expect(groqReadiness(loadGroqConfig({})).ready).toBe(false)
    expect(groqReadiness(loadGroqConfig(env)).ready).toBe(true)
    for (const key of Object.keys(env)) expect(groqReadiness(loadGroqConfig({ ...env, [key]: undefined })).ready, key).toBe(false)
    expect(groqReadiness(loadGroqConfig({ ...env, MIRA_PROVIDER: 'openai' })).ready).toBe(false)
    expect(groqReadiness(loadGroqConfig({ ...env, MIRA_GROQ_CAPABILITY_SECRET: undefined, MIRA_APPROVED_ADULT_COHORTS: undefined })).ready).toBe(true)
  })
  it('uses explicit model allowlist, request units and bounded defaults without paid cost settings', () => {
    const config = loadGroqConfig({ ...env, MIRA_MODEL: 'gpt-6-astra', MIRA_SPEND_CAP_MICROUSD: '1' })
    expect(config).toMatchObject({ model: 'openai/gpt-oss-20b', totalRequestLimit: 100, requestsPerMinute: 6, maxConcurrent: 2, maxOutputTokens: 2048, providerTimeoutMs: 8000, allowedOrigin: 'http://127.0.0.1:5176' })
    expect(config).not.toHaveProperty('spendCapMicrousd')
    expect(groqReadiness(loadGroqConfig({ ...env, MIRA_GROQ_MODEL: 'openai/gpt-oss-120b' })).ready).toBe(true)
    expect(groqReadiness(loadGroqConfig({ ...env, MIRA_GROQ_MODEL: 'unapproved/model' })).ready).toBe(false)
    expect(JSON.stringify(groqReadiness(config))).not.toContain(env.GROQ_API_KEY)
  })
  it('enforces hard quota, timeout and token limits even for manually constructed config', () => {
    const config = loadGroqConfig({ ...env, MIRA_GROQ_TOTAL_REQUEST_LIMIT: '1001', MIRA_GROQ_MAX_OUTPUT_TOKENS: '4097', MIRA_PROVIDER_TIMEOUT_MS: '20001' })
    expect(config.totalRequestLimit).toBe(0); expect(config.maxOutputTokens).toBe(0); expect(config.providerTimeoutMs).toBe(0)
    expect(groqReadiness(config).ready).toBe(false)
    expect(groqReadiness({ ...config, totalRequestLimit: 1001 }).ready).toBe(false)
    expect(groqReadiness({ ...config, maxOutputTokens: 4097 }).ready).toBe(false)
    expect(groqReadiness({ ...config, providerTimeoutMs: 20001 }).ready).toBe(false)
    expect(groqReadiness({ ...config, maxOutputTokens: 2049 }).ready).toBe(false)
    expect(groqReadiness(loadGroqConfig({ ...env, MIRA_GROQ_TOTAL_REQUEST_LIMIT: '1000', MIRA_GROQ_MAX_OUTPUT_TOKENS: '2048', MIRA_PROVIDER_TIMEOUT_MS: '20000' })).ready).toBe(true)
  })
  it('fails closed on every malformed explicit bound and nonlocal origin rather than silently enabling defaults', () => {
    for (const key of ['MIRA_GROQ_TOTAL_REQUEST_LIMIT', 'MIRA_GROQ_MAX_OUTPUT_TOKENS', 'MIRA_PROVIDER_TIMEOUT_MS', 'MIRA_REQUESTS_PER_MINUTE', 'MIRA_MAX_CONCURRENT']) {
      for (const value of ['0', '-1', 'NaN', '999999999', '', '0.5']) expect(groqReadiness(loadGroqConfig({ ...env, [key]: value })).ready, `${key}=${value}`).toBe(false)
    }
    for (const origin of ['', 'not-an-origin', 'http://127.0.0.1:5176/path', 'https://example.com', 'http://localhost:5176']) expect(groqReadiness(loadGroqConfig({ ...env, MIRA_ALLOWED_ORIGIN: origin })).ready, origin).toBe(false)
  })
})
