import { describe, expect, it } from 'vitest'
import { issueAdultCapability, issueTeenCapability, readAdultMiraCapabilityCookie, readMiraCapabilityCookie, serializeAdultMiraCapabilityCookie, serializeMiraCapabilityCookie, verifyAdultCapability, verifyTeenCapability } from './capability'

const options = {
  secret: 'test-capability-secret-at-least-32-characters',
  approvedCohortIds: ['pilot-a'],
  now: () => 1_000_000,
}

describe('Mira teen pilot capability', () => {
  it('issues and verifies only approved, expiring teen session claims', async () => {
    const issued = await issueTeenCapability({ cohortId: 'pilot-a', sessionId: 'session-abc', nonce: 'nonce-abc', ttlSeconds: 600 }, options)
    await expect(verifyTeenCapability(issued.token, options)).resolves.toMatchObject({ audience: 'teen', cohortId: 'pilot-a', sessionId: 'session-abc' })
    await expect(verifyTeenCapability(`${issued.token}x`, options)).resolves.toBeNull()
    await expect(verifyTeenCapability(issued.token, { ...options, now: () => 1_601_000 })).resolves.toBeNull()
  })

  it('keeps the signed capability in a narrowly scoped HttpOnly SameSite cookie', async () => {
    const issued = await issueTeenCapability({ cohortId: 'pilot-a', sessionId: 'session-abc', nonce: 'nonce-abc', ttlSeconds: 600 }, options)
    const cookie = serializeMiraCapabilityCookie(issued.token, 600, false)
    expect(cookie).toContain('Path=/api/mira')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
    expect(readMiraCapabilityCookie(cookie)).toBe(issued.token)
  })
})

describe('separate adult Groq capability', () => {
  const claims = { cohortId: 'pilot-a', sessionId: 'adult-session', nonce: 'adult-nonce', ttlSeconds: 600 }
  it('strictly separates signed adult/teen audience and provider scope', async () => {
    const adult = await issueAdultCapability(claims, options), teen = await issueTeenCapability(claims, options)
    await expect(verifyAdultCapability(adult.token, options)).resolves.toMatchObject({ audience: 'adult', scope: 'mira:groq-adult' })
    await expect(verifyTeenCapability(adult.token, options)).resolves.toBeNull()
    await expect(verifyAdultCapability(teen.token, options)).resolves.toBeNull()
    await expect(verifyAdultCapability(`${adult.token}x`, options)).resolves.toBeNull()
    await expect(verifyAdultCapability(adult.token, { ...options, secret: `${options.secret}different` })).resolves.toBeNull()
    await expect(verifyAdultCapability(adult.token, { ...options, approvedCohortIds: ['other'] })).resolves.toBeNull()
  })
  it('bounds adult lifetime and checks expiry/future issuance without widening teen behavior', async () => {
    for (const ttlSeconds of [0, 59, 7201, 14400, 1.5]) await expect(issueAdultCapability({ ...claims, ttlSeconds }, options)).rejects.toThrow()
    await expect(issueAdultCapability(claims, { ...options, secret: 'short' })).rejects.toThrow()
    const issued = await issueAdultCapability(claims, options)
    await expect(verifyAdultCapability(issued.token, { ...options, now: () => 1600000 })).resolves.toBeNull()
    await expect(verifyAdultCapability(issued.token, { ...options, now: () => 900000 })).resolves.toBeNull()
  })
  it('issues a distinct narrowly scoped HttpOnly adult cookie', async () => {
    const issued = await issueAdultCapability(claims, options), cookie = serializeAdultMiraCapabilityCookie(issued.token, 600, false)
    expect(cookie).toMatch(/^nadi_mira_adult=/); expect(cookie).toContain('Path=/api/mira; Max-Age=600; HttpOnly; SameSite=Strict')
    expect(readAdultMiraCapabilityCookie(cookie)).toBe(issued.token)
    expect(readMiraCapabilityCookie(cookie)).toBeUndefined()
    expect(readAdultMiraCapabilityCookie('nadi_mira_pilot=not-adult')).toBeUndefined()
    expect(() => serializeAdultMiraCapabilityCookie(issued.token, 7201, false)).toThrow()
  })
})
