// Server-only. All normal data requests use the caller's JWT, never a service-role key.
import { handleShared } from './shared.mjs'
import { handleConnection } from './connection.mjs'
const MAX_BODY = 32 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const exact = (v, required, optional = []) => object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k))
const text = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
const id = v => typeof v === 'string' && UUID.test(v)
// Accept calendar dates and UTC ISO timestamps only; Date.parse alone normalizes
// invalid dates such as February 30 and accepts ambiguous implementation formats.
export function isTrackingDate(v, timestamp = false) {
  if (typeof v !== 'string') return false
  if (!timestamp) return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v
  const match = v.match(/^((?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/)
  return !!match && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`
}

export function trackingConfig(env = {}) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '')
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  let valid = false
  try { const parsed = new URL(url); valid = parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash } catch { /* Missing configuration stays visibly unavailable. */ }
  // Reject modern and legacy privileged keys even if entered in the wrong setting.
  let privileged = key?.startsWith('sb_secret_') ?? false
  if (key?.split('.').length === 3) { try { privileged ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role' } catch { privileged = true } }
  return { configured: !!(valid && key && !privileged), url, key }
}

// Never turn an upstream outage into an instruction to replace a password.
function authFailure(reply, mode = 'login') {
  const code = reply.data?.error_code || reply.data?.code
  if (reply.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(code)) return json({ error: 'Wait before retrying authentication.', code: 'auth-rate-limited' }, 429)
  if (reply.status >= 500) return json({ error: 'Authentication service temporarily unavailable.', code: 'auth-unavailable' }, 503)
  if (mode === 'login') {
    if (code === 'invalid_credentials') return json({ error: 'The sign-in service did not accept this sign-in. Recover the existing account if it previously worked.', code: 'auth-rejected' }, 401)
    if (['email_not_confirmed', 'phone_not_confirmed', 'user_banned'].includes(code)) return json({ error: 'This account needs attention before sign-in. Contact the account administrator.', code: 'auth-account-attention' }, 403)
    if (code === 'email_provider_disabled' || code === 'signup_disabled') return json({ error: 'Password sign-in is unavailable. Contact the administrator.', code: 'auth-unavailable' }, 503)
  } else if (reply.status === 401 || reply.status === 403 || ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'bad_jwt', 'user_not_found', 'user_banned'].includes(code)) {
    return json({ error: 'This session is no longer valid. Sign in again.', code: 'auth-session-expired' }, 401)
  }
  // Unknown provider errors may be configuration or transport failures, not bad credentials.
  return json({ error: 'Authentication could not be completed. Retry or contact the administrator.', code: 'auth-unavailable' }, 503)
}

export async function validateTrackingCommand(kind, p, validateCheckpoint) {
  if (kind === 'disclosure') return exact(p, ['version']) && p.version === 1
  if (!id(p?.submissionId)) return false
  switch (kind) {
    case 'goal-create': return exact(p, ['submissionId', 'learnerId', 'title', 'description'], ['dueDate']) && id(p.learnerId) && text(p.title, 160) && text(p.description, 2000, true) && (p.dueDate == null || isTrackingDate(p.dueDate))
    case 'goal-status': return exact(p, ['submissionId', 'goalId', 'expectedVersion', 'status']) && id(p.goalId) && Number.isInteger(p.expectedVersion) && p.expectedVersion >= 0 && p.expectedVersion <= 2147483647 && ['not-started', 'in-progress', 'student-complete'].includes(p.status)
    case 'work-session': return exact(p, ['submissionId', 'sessionId', 'goalId', 'kind', 'occurredAt']) && id(p.sessionId) && id(p.goalId) && ['started', 'saved'].includes(p.kind) && isTrackingDate(p.occurredAt, true)
    case 'checkpoint': {
      if (!exact(p, ['submissionId', 'goalId', 'reflection', 'checkpoint'], ['replyToFeedbackId']) || !id(p.goalId) || !text(p.reflection, 2000, true) || p.replyToFeedbackId != null && !id(p.replyToFeedbackId)) return false
      return (await validateCheckpoint(p.checkpoint)).length === 0
    }
    case 'feedback': return exact(p, ['submissionId', 'checkpointId', 'message']) && id(p.checkpointId) && text(p.message, 4000)
    case 'help-create': return exact(p, ['submissionId', 'goalId', 'message']) && id(p.goalId) && text(p.message, 2000)
    case 'help-resolve': return exact(p, ['submissionId', 'requestId']) && id(p.requestId)
    default: return false
  }
}

/** Web-standard handler, injectable for offline contract/security tests. */
export function createTrackingRequestHandler({ env = {}, fetchImpl = fetch, validateCheckpoint = async value => (await import('../../src/tracking/checkpoint.ts')).validateCheckpoint(value) } = {}) {
  const config = trackingConfig(env)
  const allowedOrigin = env.NADI_ORIGIN || 'http://127.0.0.1:5176'
  async function upstream(path, token, body, method = body ? 'POST' : 'GET') {
    const response = await fetchImpl(`${config.url}${path}`, { method, headers: { apikey: config.key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) })
    let data; try { data = await response.json() } catch { throw new Error('upstream') }
    return { ok: response.ok, status: response.status, data }
  }
  return async request => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/v1/')) return null
    const origin = request.headers.get('origin')
    if (url.origin !== allowedOrigin || origin && origin !== allowedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Same-origin request required' }, 403)
    if (request.method === 'GET' && url.pathname === '/api/v1/status') return json({ configured: config.configured, storage: 'supabase', ready: false, reason: config.configured ? 'Sign in to verify access' : 'Supabase owner setup required' })
    if (!config.configured) return json({ error: 'Supabase owner setup required. Private creation remains available.', code: 'setup-required' }, 503)
    if (!['GET', 'POST', 'PATCH'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    try {
      let body
      if (request.method !== 'GET') {
        if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'JSON required' }, 415)
        const raw = await request.text()
        if (Buffer.byteLength(raw) > (['/api/v1/shared', '/api/v1/captures'].includes(url.pathname) ? MAX_BODY : 4 * 1024 * 1024 + 8192)) return json({ error: 'Submission too large' }, 413)
        try { body = JSON.parse(raw) } catch { return json({ error: 'Invalid JSON' }, 400) }
      }
      if (url.pathname === '/api/v1/auth/recover' && request.method === 'POST') {
        if (!exact(body, ['email']) || !text(body.email, 254)) return json({ error: 'Email required' }, 400)
        // No caller-controlled redirect: the owner-configured Supabase Site URL is used.
        const reply = await upstream('/auth/v1/recover', null, { email: body.email.trim() })
        const recoveryCode = reply.data?.error_code || reply.data?.code
        if (!reply.ok && ['email_address_not_authorized', 'email_provider_disabled'].includes(recoveryCode)) return json({ error: 'Recovery email is unavailable. Contact the account administrator.', code: 'auth-unavailable' }, 503)
        if (!reply.ok && (reply.status >= 500 || reply.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(recoveryCode))) return authFailure(reply)
        return json({ accepted: true }) // Never reveal whether an address exists.
      }
      if (url.pathname === '/api/v1/auth/password' && request.method === 'POST') {
        const recoveryToken = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
        if (!recoveryToken || recoveryToken.length > 8192) return json({ error: 'Open a fresh recovery link.', code: 'auth-session-expired' }, 401)
        if (!exact(body, ['password']) || !text(body.password, 1024) || body.password.length < 6) return json({ error: 'Use a password of at least 6 characters.', code: 'auth-password-policy' }, 400)
        const reply = await upstream('/auth/v1/user', recoveryToken, { password: body.password }, 'PUT')
        if (!reply.ok) {
          const code = reply.data?.error_code || reply.data?.code
          if (['weak_password', 'same_password'].includes(code)) return json({ error: 'Choose a different password that meets the account password requirements.', code: 'auth-password-policy' }, 400)
          return authFailure(reply, 'identity')
        }
        return json({ updated: true })
      }
      if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
        if (!exact(body, ['email', 'password']) || !text(body.email, 254) || !text(body.password, 1024)) return json({ error: 'Email and password required' }, 400)
        const reply = await upstream('/auth/v1/token?grant_type=password', null, body)
        if (!reply.ok) return authFailure(reply)
        return json({ accessToken: reply.data.access_token, refreshToken: reply.data.refresh_token, expiresIn: reply.data.expires_in })
      }
      if (url.pathname === '/api/v1/auth/refresh' && request.method === 'POST') {
        if (!exact(body, ['refreshToken']) || !text(body.refreshToken, 4096)) return json({ error: 'Refresh token required' }, 400)
        const reply = await upstream('/auth/v1/token?grant_type=refresh_token', null, { refresh_token: body.refreshToken })
        return reply.ok ? json({ accessToken: reply.data.access_token, refreshToken: reply.data.refresh_token, expiresIn: reply.data.expires_in }) : authFailure(reply, 'refresh')
      }
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
      if (!token || token.length > 8192) return json({ error: 'Sign in required' }, 401)
      const identity = await upstream('/auth/v1/user', token)
      if (!identity.ok) return authFailure(identity, 'identity')
      if (!id(identity.data.id)) return json({ error: 'Identity response unavailable. Retry without replacing your password.', code: 'auth-unavailable' }, 503)
      const connectionResponse = await handleConnection({ request, url, body, token, upstream })
      if (connectionResponse) return connectionResponse
      const sharedResponse = await handleShared({ request, url, body, actor: identity.data.id, token, upstream, config, fetchImpl })
      if (sharedResponse) return sharedResponse
      if (request.method === 'GET') {
        if (['/api/v1/me', '/api/v1/workspace'].includes(url.pathname)) {
          const result = await upstream('/rest/v1/rpc/nadi_workspace', token, {})
          return result.ok ? json(result.data) : json({ error: 'Shared workspace unavailable; verify your assigned account and database setup.' }, 503)
        }
        const progress = url.pathname.match(/^\/api\/v1\/learners\/([0-9a-f-]+)\/progress$/i)
        if (progress && id(progress[1])) {
          const result = await upstream('/rest/v1/rpc/nadi_learner_progress', token, { p_learner_id: progress[1] })
          return result.ok ? json(result.data) : json({ error: 'Learner unavailable or access denied' }, 403)
        }
        const submission = url.pathname.match(/^\/api\/v1\/submissions\/([0-9a-f-]+)$/i)
        if (submission && id(submission[1])) {
          const result = await upstream(`/rest/v1/nadi_submissions?submission_id=eq.${submission[1]}&select=result`, token)
          return result.ok ? json({ found: result.data.length > 0, result: result.data[0]?.result ?? null }) : json({ error: 'Unable to confirm submission' }, 503)
        }
        return json({ error: 'Not found' }, 404)
      }
      let kind = ({ '/api/v1/disclosure': 'disclosure', '/api/v1/goals': 'goal-create', '/api/v1/work-sessions': 'work-session', '/api/v1/checkpoints': 'checkpoint', '/api/v1/help-requests': 'help-create' })[url.pathname]
      const status = url.pathname.match(/^\/api\/v1\/goals\/([0-9a-f-]+)$/i)
      const feedback = url.pathname.match(/^\/api\/v1\/checkpoints\/([0-9a-f-]+)\/feedback$/i)
      const resolve = url.pathname.match(/^\/api\/v1\/help-requests\/([0-9a-f-]+)\/resolve$/i)
      if (status && request.method === 'PATCH') { if (!object(body) || Object.hasOwn(body, 'goalId') && body.goalId !== status[1]) return json({ error: 'Goal does not match request' }, 400); kind = 'goal-status'; body = { ...body, goalId: status[1] } }
      if (feedback && request.method === 'POST') { if (!object(body) || Object.hasOwn(body, 'checkpointId') && body.checkpointId !== feedback[1]) return json({ error: 'Checkpoint does not match request' }, 400); kind = 'feedback'; body = { ...body, checkpointId: feedback[1] } }
      if (resolve && request.method === 'POST') { if (!object(body) || Object.hasOwn(body, 'requestId') && body.requestId !== resolve[1]) return json({ error: 'Help request does not match request' }, 400); kind = 'help-resolve'; body = { ...body, requestId: resolve[1] } }
      if (!kind || (request.method !== 'POST' && kind !== 'goal-status')) return json({ error: 'Not found' }, 404)
      if (!await validateTrackingCommand(kind, body, validateCheckpoint)) return json({ error: 'Invalid submission. Nothing was shared.', code: 'invalid-submission' }, 400)
      const result = await upstream('/rest/v1/rpc/nadi_command', token, { p_kind: kind, p_payload: body })
      if (!result.ok) {
        const code = result.data?.code
        if (code === '40001' || code === '23505') return json({ error: 'Submission conflict. Refresh and review your pending work.', code: 'conflict' }, 409)
        if (code === '42501') return json({ error: 'This account is not allowed to perform that action.', code: 'forbidden' }, 403)
        if (['22023', '22P02', '23514', '23503'].includes(code)) return json({ error: 'Invalid submission. Nothing was shared.', code: 'invalid-submission' }, 400)
        return json({ error: 'Sharing failed. Keep your pending submission and retry.', code: 'unavailable' }, 503)
      }
      return json(result.data)
    } catch { return json({ error: 'Connection unavailable. Keep your local work and retry.', code: 'unavailable' }, 503) }
  }
}

export function createTrackingHandler(options = {}) {
  const handle = createTrackingRequestHandler(options)
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/v1/')) return next()
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { res.statusCode = 413; res.end(); return } chunks.push(chunk) }
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
      const host = headers.get('host') || ''
      const response = await handle(new Request(`http://${host}${req.url}`, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }))
      if (!response) return next()
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(await response.text())
    } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid request' })) }
  }
}

export function trackingPlugin(env) {
  return {
    name: 'nadi-tracking',
    configureServer(server) {
      // Each preserved preview has its own port. Trust the configured listener,
      // never the incoming Host/Origin headers or another release's env value.
      const { host, port, https } = server.config.server
      const hostname = typeof host === 'string' && host !== '0.0.0.0' && host !== '::' ? host : 'localhost'
      const origin = `${https ? 'https' : 'http'}://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
      server.middlewares.use(createTrackingHandler({ env: { ...env, NADI_ORIGIN: origin } }))
    },
  }
}
