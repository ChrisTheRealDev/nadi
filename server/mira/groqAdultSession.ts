import { issueAdultCapability, serializeAdultMiraCapabilityCookie } from './capability'

export interface GroqPairingRecord { version: 1; codeHash: string; expiresAt: number; cohortId: 'adult-demo'; sessionId: string }
export interface GroqPairingRepository {
  read(): Promise<unknown | null>
  /** Atomically compare the complete record and consume it; false means another request won. */
  consume(expected: GroqPairingRecord): Promise<boolean>
}
export interface GroqAdultSessionOptions {
  ready: boolean
  adultConfirmed: boolean
  freeTierConfirmed: boolean
  allowedOrigin: string
  capabilitySecret: string
  repository: GroqPairingRepository
  now?: () => number
  crypto?: Crypto
  ttlSeconds?: number
}

const LOCAL_ORIGIN = 'http://127.0.0.1:5176'
const keys = ['version', 'codeHash', 'expiresAt', 'cohortId', 'sessionId']
// Global across handler instances in this server process. Restart/re-pair is owner-operated.
let pairingAttempts = 0
export function isGroqPairingRecord(value: unknown): value is GroqPairingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return Object.keys(r).length === keys.length && Object.keys(r).every(key => keys.includes(key)) && r.version === 1 && typeof r.codeHash === 'string' && /^[a-f0-9]{64}$/.test(r.codeHash) && Number.isSafeInteger(r.expiresAt) && Number(r.expiresAt) > 0 && r.cohortId === 'adult-demo' && typeof r.sessionId === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(r.sessionId)
}
const reply = (status: number, error: string, cookie?: string) => new Response(JSON.stringify(cookie ? { authorized: true } : { error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(cookie ? { 'set-cookie': cookie } : {}) } })
const loopback = (address?: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'

/** remoteAddress MUST come from the server socket, never a forwarded/client header. */
export function createGroqAdultSessionHandler(options: GroqAdultSessionOptions) {
  return async (request: Request, remoteAddress?: string): Promise<Response> => {
    if (request.method !== 'POST') return reply(405, 'POST required')
    if (options.allowedOrigin !== LOCAL_ORIGIN || request.headers.get('origin') !== LOCAL_ORIGIN || new URL(request.url).origin !== LOCAL_ORIGIN || !loopback(remoteAddress)) return reply(403, 'Local origin required')
    if (!options.ready || !options.adultConfirmed || !options.freeTierConfirmed || options.capabilitySecret.length < 32) return reply(503, 'Adult demo is not ready')
    const type = request.headers.get('content-type')?.toLowerCase().split(';')[0].trim()
    if (type !== 'application/json') return reply(415, 'JSON required')
    if (pairingAttempts >= 5) return reply(429, 'Pairing attempt limit reached; ask the local owner')
    pairingAttempts++
    try {
      if (!request.body || Number(request.headers.get('content-length')) > 1024) return reply(400, 'Invalid pairing request')
      const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024) { await reader.cancel(); return reply(400, 'Invalid pairing request') } chunks.push(part.value) }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size); let offset = 0
      for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
      let input: unknown
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return reply(400, 'Invalid pairing request') }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('code' in input) || typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(input.code)) return reply(400, 'Invalid pairing request')
      const record = await options.repository.read(), now = (options.now ?? Date.now)(), ttl = options.ttlSeconds ?? 3600
      if (!Number.isSafeInteger(now) || !Number.isInteger(ttl) || ttl < 60 || ttl > 7200 || !isGroqPairingRecord(record) || record.expiresAt <= now || record.expiresAt > now + 7200000) return reply(403, 'Pairing code is unavailable or expired')
      const candidate = new Uint8Array(await (options.crypto ?? crypto).subtle.digest('SHA-256', new TextEncoder().encode(input.code)))
      const expected = Uint8Array.from(record.codeHash.match(/../g)!, byte => Number.parseInt(byte, 16))
      let difference = 0
      for (let index = 0; index < expected.length; index++) difference |= candidate[index] ^ expected[index]
      if (difference !== 0) return reply(403, 'Pairing code is unavailable or expired')
      // Consume before signing or returning authority, even if signing subsequently fails.
      if (!await options.repository.consume(record)) return reply(403, 'Pairing code is unavailable or expired')
      const issued = await issueAdultCapability({ cohortId: record.cohortId, sessionId: record.sessionId, nonce: (options.crypto ?? crypto).randomUUID(), ttlSeconds: ttl }, { secret: options.capabilitySecret, approvedCohortIds: ['adult-demo'], now: () => now, crypto: options.crypto })
      return reply(200, '', serializeAdultMiraCapabilityCookie(issued.token, ttl, false))
    } catch { return reply(503, 'Pairing could not finish; ask the local owner') }
  }
}
