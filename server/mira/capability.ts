export const MIRA_CAPABILITY_COOKIE = 'nadi_mira_pilot'
export const ADULT_MIRA_CAPABILITY_COOKIE = 'nadi_mira_adult'

/** Separate provider-bound authority: a teen token can never authorize this route. */
export interface AdultMiraCapabilityClaims {
  version: 1
  scope: 'mira:groq-adult'
  audience: 'adult'
  cohortId: string
  sessionId: string
  issuedAt: number
  expiresAt: number
  nonce: string
}

export interface MiraCapabilityClaims {
  version: 1
  scope: 'mira:live'
  audience: 'teen'
  cohortId: string
  sessionId: string
  issuedAt: number
  expiresAt: number
  nonce: string
}

export interface CapabilityOptions {
  secret: string
  approvedCohortIds: readonly string[]
  now: () => number
  crypto?: Crypto
}

const claimKeys = ['version', 'scope', 'audience', 'cohortId', 'sessionId', 'issuedAt', 'expiresAt', 'nonce'] as const

export async function issueTeenCapability(
  claims: Omit<MiraCapabilityClaims, 'version' | 'scope' | 'audience' | 'issuedAt' | 'expiresAt'> & { ttlSeconds: number },
  options: CapabilityOptions,
): Promise<{ token: string; expiresAt: number }> {
  if (!options.approvedCohortIds.includes(claims.cohortId)) throw new Error('Cohort is not approved for the teen pilot')
  if (!identifier(claims.sessionId) || !identifier(claims.nonce) || !Number.isInteger(claims.ttlSeconds) || claims.ttlSeconds < 60 || claims.ttlSeconds > 14_400) {
    throw new Error('Capability parameters are invalid')
  }
  const issuedAt = Math.floor(options.now() / 1_000)
  const payload: MiraCapabilityClaims = {
    version: 1,
    scope: 'mira:live',
    audience: 'teen',
    cohortId: claims.cohortId,
    sessionId: claims.sessionId,
    issuedAt,
    expiresAt: issuedAt + claims.ttlSeconds,
    nonce: claims.nonce,
  }
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await sign(encoded, options.secret, options.crypto ?? crypto)
  return { token: `${encoded}.${encodeBase64Url(signature)}`, expiresAt: payload.expiresAt }
}

export async function verifyTeenCapability(token: string | undefined, options: CapabilityOptions): Promise<MiraCapabilityClaims | null> {
  if (!token || token.length > 1_500) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  try {
    const expected = await sign(parts[0], options.secret, options.crypto ?? crypto)
    const actual = decodeBase64Url(parts[1])
    if (!constantTimeEqual(expected, actual)) return null
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(parts[0]))) as unknown
    if (!isExactClaims(value)) return null
    const now = Math.floor(options.now() / 1_000)
    if (value.issuedAt > now + 30 || value.expiresAt <= now || value.expiresAt - value.issuedAt > 14_400) return null
    if (!options.approvedCohortIds.includes(value.cohortId)) return null
    return value
  } catch {
    return null
  }
}

export function readMiraCapabilityCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    if (part.slice(0, separator).trim() === MIRA_CAPABILITY_COOKIE) return part.slice(separator + 1).trim()
  }
  return undefined
}

export function serializeMiraCapabilityCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  if (!/^[A-Za-z0-9_.-]{20,1500}$/.test(token) || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 14_400) {
    throw new Error('Capability cookie is invalid')
  }
  return `${MIRA_CAPABILITY_COOKIE}=${token}; Path=/api/mira; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export async function issueAdultCapability(
  claims: Omit<AdultMiraCapabilityClaims, 'version' | 'scope' | 'audience' | 'issuedAt' | 'expiresAt'> & { ttlSeconds: number },
  options: CapabilityOptions,
): Promise<{ token: string; expiresAt: number }> {
  if (options.secret.length < 32 || !options.approvedCohortIds.includes(claims.cohortId) || !identifier(claims.cohortId) || !identifier(claims.sessionId) || !identifier(claims.nonce) || !Number.isInteger(claims.ttlSeconds) || claims.ttlSeconds < 60 || claims.ttlSeconds > 7200) throw new Error('Adult capability parameters are invalid')
  const issuedAt = Math.floor(options.now() / 1000)
  if (!integer(issuedAt)) throw new Error('Adult capability clock is invalid')
  const payload: AdultMiraCapabilityClaims = { version: 1, scope: 'mira:groq-adult', audience: 'adult', cohortId: claims.cohortId, sessionId: claims.sessionId, nonce: claims.nonce, issuedAt, expiresAt: issuedAt + claims.ttlSeconds }
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  return { token: `${encoded}.${encodeBase64Url(await sign(encoded, options.secret, options.crypto ?? crypto))}`, expiresAt: payload.expiresAt }
}

export async function verifyAdultCapability(token: string | undefined, options: CapabilityOptions): Promise<AdultMiraCapabilityClaims | null> {
  if (!token || token.length > 1500 || options.secret.length < 32) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  try {
    if (!constantTimeEqual(await sign(parts[0], options.secret, options.crypto ?? crypto), decodeBase64Url(parts[1]))) return null
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(parts[0])))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>, keys = Object.keys(item)
    if (keys.length !== claimKeys.length || !keys.every(key => (claimKeys as readonly string[]).includes(key)) || item.version !== 1 || item.scope !== 'mira:groq-adult' || item.audience !== 'adult' || !identifier(item.cohortId) || !identifier(item.sessionId) || !identifier(item.nonce) || !integer(item.issuedAt) || !integer(item.expiresAt)) return null
    const now = Math.floor(options.now() / 1000), lifetime = item.expiresAt - item.issuedAt
    if (!integer(now) || item.issuedAt > now + 30 || item.expiresAt <= now || lifetime < 60 || lifetime > 7200 || !options.approvedCohortIds.includes(item.cohortId)) return null
    return item as unknown as AdultMiraCapabilityClaims
  } catch { return null }
}

export function readAdultMiraCapabilityCookie(cookieHeader: string | null): string | undefined {
  return cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${ADULT_MIRA_CAPABILITY_COOKIE}=`))?.slice(ADULT_MIRA_CAPABILITY_COOKIE.length + 1)
}

export function serializeAdultMiraCapabilityCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  if (!/^[A-Za-z0-9_.-]{20,1500}$/.test(token) || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 7200) throw new Error('Adult capability cookie is invalid')
  return `${ADULT_MIRA_CAPABILITY_COOKIE}=${token}; Path=/api/mira; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

async function sign(payload: string, secret: string, cryptoImpl: Crypto): Promise<Uint8Array> {
  const key = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await cryptoImpl.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
}

function isExactClaims(value: unknown): value is MiraCapabilityClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length === claimKeys.length && keys.every((key) => (claimKeys as readonly string[]).includes(key)) &&
    record.version === 1 && record.scope === 'mira:live' && record.audience === 'teen' &&
    identifier(record.cohortId) && identifier(record.sessionId) && identifier(record.nonce) &&
    integer(record.issuedAt) && integer(record.expiresAt)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(value)
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function encodeBase64Url(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    output += base64Alphabet[(combined >>> 18) & 63]
    output += base64Alphabet[(combined >>> 12) & 63]
    if (second !== undefined) output += base64Alphabet[(combined >>> 6) & 63]
    if (third !== undefined) output += base64Alphabet[combined & 63]
  }
  return output
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url')
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 4) {
    const a = base64Alphabet.indexOf(value[index])
    const b = base64Alphabet.indexOf(value[index + 1])
    const c = value[index + 2] === undefined ? 0 : base64Alphabet.indexOf(value[index + 2])
    const d = value[index + 3] === undefined ? 0 : base64Alphabet.indexOf(value[index + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64url')
    const combined = (a << 18) | (b << 12) | (c << 6) | d
    bytes.push((combined >>> 16) & 255)
    if (value[index + 2] !== undefined) bytes.push((combined >>> 8) & 255)
    if (value[index + 3] !== undefined) bytes.push(combined & 255)
  }
  return new Uint8Array(bytes)
}
