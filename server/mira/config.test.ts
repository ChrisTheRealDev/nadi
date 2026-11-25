import { describe, expect, it } from 'vitest'
import { loadMiraServerConfig, miraServerReadiness, publicMiraServerStatus } from './config'

const readyEnv = () => ({
  MIRA_LIVE_ENABLED: 'true',
  OPENAI_API_KEY: 'sk-test-not-a-real-key-1234567890',
  MIRA_SPEND_CAP_MICROUSD: '1000000',
  MIRA_MAX_REQUEST_COST_MICROUSD: '200000',
  MIRA_CAPABILITY_SECRET: 'test-capability-secret-at-least-32-characters',
  MIRA_APPROVED_TEEN_COHORTS: 'pilot-a',
})

describe('Mira server configuration', () => {
  it('fails closed for each missing live prerequisite', () => {
    const cases = ['MIRA_LIVE_ENABLED', 'OPENAI_API_KEY', 'MIRA_SPEND_CAP_MICROUSD', 'MIRA_MAX_REQUEST_COST_MICROUSD', 'MIRA_CAPABILITY_SECRET', 'MIRA_APPROVED_TEEN_COHORTS'] as const
    for (const missing of cases) {
      const env: Record<string, string | undefined> = readyEnv()
      delete env[missing]
      expect(miraServerReadiness(loadMiraServerConfig(env)).ready, missing).toBe(false)
    }
  })

  it('rejects a token-cost bound that is positive but lower than the demonstrable worst case', () => {
    const config = loadMiraServerConfig({ ...readyEnv(), MIRA_MAX_REQUEST_COST_MICROUSD: '1' })
    expect(config.minimumRequestCostMicrousd).toBe(176_000)
    expect(miraServerReadiness(config).hasRequestCostBound).toBe(false)
  })

  it('requires verified per-token costs when the owner changes the model', () => {
    expect(miraServerReadiness(loadMiraServerConfig({ ...readyEnv(), MIRA_MODEL: 'custom-model' })).ready).toBe(false)
    const verified = loadMiraServerConfig({
      ...readyEnv(),
      MIRA_MODEL: 'custom-model',
      MIRA_MODEL_COST_BOUND_VERIFIED: 'true',
      MIRA_VERIFIED_INPUT_MICROUSD_PER_TOKEN: '12',
      MIRA_VERIFIED_OUTPUT_MICROUSD_PER_TOKEN: '55',
      MIRA_MAX_REQUEST_COST_MICROUSD: '220000',
    })
    expect(miraServerReadiness(verified).ready).toBe(true)
  })

  it('exposes readiness booleans without exposing secrets', () => {
    const config = loadMiraServerConfig(readyEnv())
    const status = publicMiraServerStatus(config)
    expect(status.ready).toBe(true)
    expect(JSON.stringify(status)).not.toContain(config.apiKey)
    expect(JSON.stringify(status)).not.toContain(config.capabilitySecret)
  })
})
