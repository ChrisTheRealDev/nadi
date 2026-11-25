import { describe, expect, it } from 'vitest'
import { miraFailureMessage } from './miraFailure'

describe('Mira safe failure messages', () => {
  it.each([
    ['provider-auth', 'rejected access'], ['provider-rate-limited', 'rate-limited'],
    ['provider-timeout', 'did not finish'], ['quota-unavailable', 'allowance'],
    ['provider-model-unavailable', 'model is unavailable'], ['local-safety', 'private details'],
  ])('explains %s in plain language', (reason, text) => expect(miraFailureMessage(reason)).toContain(text))
  it('never copies unknown provider text into the explanation', () => {
    expect(miraFailureMessage('secret-private-key')).not.toContain('secret-private-key')
  })
})
