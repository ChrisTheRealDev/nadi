import { loadMiraServerConfig, type MiraServerConfig } from './config'
// Creation activation never inherits presumed pricing for a model alias.
export function loadCreationMiraConfig(env: Readonly<Record<string, string | undefined>>): MiraServerConfig {
  const config = loadMiraServerConfig({ ...env, MIRA_ALLOWED_ORIGIN: env.MIRA_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5176' })
  const input = Number(env.MIRA_VERIFIED_INPUT_MICROUSD_PER_TOKEN), output = Number(env.MIRA_VERIFIED_OUTPUT_MICROUSD_PER_TOKEN)
  config.modelCostBoundVerified = env.MIRA_MODEL_COST_BOUND_VERIFIED === 'true' && Number.isSafeInteger(input) && input > 0 && input <= 10000 && Number.isSafeInteger(output) && output > 0 && output <= 10000
  config.inputCostMicrousdPerToken = config.modelCostBoundVerified ? input : 0
  config.outputCostMicrousdPerToken = config.modelCostBoundVerified ? output : 0
  config.minimumRequestCostMicrousd = 16000 * config.inputCostMicrousdPerToken + config.maxOutputTokens * config.outputCostMicrousdPerToken
  return config
}
