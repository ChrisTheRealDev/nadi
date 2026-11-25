/** Presentation-facing tracking adapter. Never reads local musical projects. */
import { commandRoute, parseCommandResult, validTrackingCommand, validateCommandResult, type TrackingCommand, type TrackingCommandResult } from './commands'
import type { ConnectionMutationResult, PlannerData, PlannerGoal, PlannerKind, PlannerReview } from './connectionTypes'
export interface TrackingProfile { id: string; display_name: string; role: 'student' | 'mentor' }
export interface TrackingGoal { id: string; title: string; description: string; status: string; version: number; due_date: string | null; created_at: string }
export interface TrackingProgress {
  learnerId: string
  goals: TrackingGoal[]
  workSessions: { id: string; goal_id: string; started_at: string; last_saved_at: string | null; received_at: string; evidence: string }[]
  events: { id: string; goal_id: string; kind: string; occurred_at: string; received_at: string; evidence: string }[]
  checkpoints: { id: string; goal_id: string; reflection: string; created_at: string }[]
  feedback: { id: string; checkpoint_id: string; message: string; created_at: string }[]
  helpRequests: { id: string; goal_id: string; message: string; created_at: string; resolved_at: string | null }[]
}
export interface TrackingWorkspace {
  profile: TrackingProfile
  disclosureAccepted: boolean
  musicSharingAccepted?: boolean
  learners: { profile: TrackingProfile; progress: TrackingProgress }[]
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const malformed = () => new Error('The progress response could not be read. Refresh or check the server setup.')
export class TrackingRequestError extends Error { constructor(message: string, public status?: number, public code?: string, public sessionRevision?: number) { super(message) } }
function string(v: unknown): string { if (typeof v !== 'string') throw malformed(); return v }
function nullable(v: unknown): string | null { return v === null ? null : string(v) }
function version(v: unknown): number { if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 2147483647) throw malformed(); return Number(v) }
function profile(v: unknown): TrackingProfile {
  if (!record(v) || !['student', 'mentor'].includes(String(v.role))) throw malformed()
  return { id: string(v.id), display_name: string(v.display_name), role: v.role as TrackingProfile['role'] }
}
function rows<T>(v: unknown, parse: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(v) || v.length > 10000) throw malformed()
  return v.map(row => { if (!record(row)) throw malformed(); return parse(row) })
}
function plannerReview(value: unknown): PlannerReview {
  if (!record(value) || !['awaiting-review', 'changes-requested', 'reviewed'].includes(String(value.status))) throw malformed()
  return { id: string(value.id), status: value.status as PlannerReview['status'], snapshot_id: string(value.snapshot_id), revision: version(value.revision), reflection: string(value.reflection), version: version(value.version), created_at: string(value.created_at), updated_at: string(value.updated_at) }
}
export function parsePlannerData(value: unknown): PlannerData {
  if (!record(value)) throw malformed()
  return {
    goals: rows(value.goals, row => ({
      id: string(row.id), learner_id: string(row.learner_id), mentor_id: string(row.mentor_id), title: string(row.title), description: string(row.description), status: string(row.status), version: version(row.version), due_date: nullable(row.due_date), created_at: string(row.created_at), project_id: nullable(row.project_id),
      steps: rows(row.steps, step => { if (typeof step.done !== 'boolean') throw malformed(); return { id: string(step.id), label: string(step.label), done: step.done, position: version(step.position), version: version(step.version) } }),
      review: row.review === null ? null : plannerReview(row.review), reviews: rows(row.reviews, plannerReview),
    } satisfies PlannerGoal)),
    projects: rows(value.projects, row => ({ projectId: string(row.projectId), name: string(row.name), revision: version(row.revision), updatedAt: string(row.updatedAt), snapshotId: nullable(row.snapshotId) })),
  }
}
function connectionResult(value: unknown): ConnectionMutationResult {
  if (!record(value)) throw malformed()
  const result: ConnectionMutationResult = {}
  if (value.id !== undefined) result.id = string(value.id)
  if (value.version !== undefined) result.version = version(value.version)
  if (value.read !== undefined) result.read = version(value.read)
  if (value.saved !== undefined) { if (value.saved !== true) throw malformed(); result.saved = true }
  if (value.snapshotId !== undefined) result.snapshotId = string(value.snapshotId)
  if (value.revision !== undefined) result.revision = version(value.revision)
  if (!Object.keys(result).length) throw malformed()
  return result
}
/** Allowlist display facts; shared snapshots and unexpected payload fields stay out of UI state. */
export function parseTrackingWorkspace(v: unknown): TrackingWorkspace {
  if (!record(v) || typeof v.disclosureAccepted !== 'boolean') throw malformed()
  return {
    profile: profile(v.profile), disclosureAccepted: v.disclosureAccepted, ...(v.musicSharingAccepted === undefined ? {} : { musicSharingAccepted: v.musicSharingAccepted === true }),
    learners: rows(v.learners, learner => {
      const p = learner.progress
      if (!record(p)) throw malformed()
      return { profile: profile(learner.profile), progress: {
        learnerId: string(p.learnerId),
        goals: rows(p.goals, r => ({ id: string(r.id), title: string(r.title), description: string(r.description), status: string(r.status), version: version(r.version), due_date: nullable(r.due_date), created_at: string(r.created_at) })),
        workSessions: rows(p.workSessions, r => ({ id: string(r.id), goal_id: string(r.goal_id), started_at: string(r.started_at), last_saved_at: nullable(r.last_saved_at), received_at: string(r.received_at), evidence: string(r.evidence) })),
        events: rows(p.events, r => ({ id: string(r.id), goal_id: string(r.goal_id), kind: string(r.kind), occurred_at: string(r.occurred_at), received_at: string(r.received_at), evidence: string(r.evidence) })),
        checkpoints: rows(p.checkpoints, r => ({ id: string(r.id), goal_id: string(r.goal_id), reflection: string(r.reflection), created_at: string(r.created_at) })),
        feedback: rows(p.feedback, r => ({ id: string(r.id), checkpoint_id: string(r.checkpoint_id), message: string(r.message), created_at: string(r.created_at) })),
        helpRequests: rows(p.helpRequests, r => ({ id: string(r.id), goal_id: string(r.goal_id), message: string(r.message), created_at: string(r.created_at), resolved_at: nullable(r.resolved_at) })),
      } }
    }),
  }
}

export type TrackingSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const TRACKING_SESSION_KEY = 'nadi.tracking.tab-session.v1'

export class TrackingClient {
  private accessToken = ''
  private refreshToken = ''
  private expiresAt = 0
  private generation = 0
  private actorId = ''
  private tokenRevision = 0
  private pending = new Set<AbortController>()
  private refreshing: Promise<void> | null = null
  constructor(private fetchImpl: typeof fetch = fetch, private now = Date.now, private sessionStorage?: TrackingSessionStorage) {
    try {
      const saved = this.sessionStorage?.getItem(TRACKING_SESSION_KEY)
      if (!saved) return
      const value: unknown = JSON.parse(saved)
      if (!record(value) || value.version !== 1 || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.refreshToken !== 'string' || !value.refreshToken || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= 0) throw malformed()
      this.accessToken = value.accessToken; this.refreshToken = value.refreshToken; this.expiresAt = value.expiresAt
      // Actor identity is never restored from disk. workspace() must verify it first.
    } catch { this.clearSavedSession() }
  }
  hasSession(): boolean { return !!this.accessToken }
  private clearSavedSession() { try { this.sessionStorage?.removeItem(TRACKING_SESSION_KEY) } catch { /* Storage restrictions must not break in-memory sign-out. */ } }
  private saveSession() {
    try { this.sessionStorage?.setItem(TRACKING_SESSION_KEY, JSON.stringify({ version: 1, accessToken: this.accessToken, refreshToken: this.refreshToken, expiresAt: this.expiresAt })) }
    catch { this.clearSavedSession() /* Continue with the current in-memory session if storage is unavailable. */ }
  }
  async sharedRead(actorId: string, learnerId: string, projectId?: string): Promise<unknown> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request(`shared?learnerId=${encodeURIComponent(learnerId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`, undefined, true)
    guard(); return value
  }
  async feedbackRead(actorId: string, learnerId?: string): Promise<unknown> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request(`feedback${learnerId ? `?learnerId=${encodeURIComponent(learnerId)}` : ''}`, undefined, true)
    guard(); return value
  }
  async feedbackCommand(actorId: string, kind: string, payload: unknown): Promise<ConnectionMutationResult> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request('feedback', { kind, payload }, true)
    guard(); return connectionResult(value)
  }
  async plannerRead(actorId: string, learnerId: string): Promise<PlannerData> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request(`planner?learnerId=${encodeURIComponent(learnerId)}`, undefined, true)
    guard(); return parsePlannerData(value)
  }
  async plannerCommand(actorId: string, kind: PlannerKind, payload: unknown): Promise<ConnectionMutationResult> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request('planner', { kind, payload }, true)
    guard(); return connectionResult(value)
  }
  async sharedCommand(actorId: string, kind: string, payload: unknown): Promise<unknown> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request('shared', { kind, payload }, true); guard(); return value
  }
  async uploadCapture(actorId: string, payload: { hash: string; base64: string; mimeType: string }): Promise<void> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    await this.request('captures', payload, true); guard()
  }
  async capture(actorId: string, learnerId: string, hash: string): Promise<{ base64: string; mimeType: string }> {
    const guard = this.sessionGuard(actorId); await this.ensureSession(); guard()
    const value = await this.request(`captures?learnerId=${encodeURIComponent(learnerId)}&hash=${encodeURIComponent(hash)}`, undefined, true); guard()
    if (!record(value) || typeof value.base64 !== 'string' || typeof value.mimeType !== 'string') throw malformed()
    return { base64: value.base64, mimeType: value.mimeType }
  }

  signOut() {
    this.generation++
    this.accessToken = ''; this.refreshToken = ''; this.expiresAt = 0; this.actorId = ''
    this.refreshing = null
    for (const request of this.pending) request.abort()
    this.pending.clear()
    this.clearSavedSession()
  }

  private async request(path: string, body?: unknown, authenticated = false, method?: string, retryAuthentication = true, deadlineAt = Date.now() + 15000): Promise<unknown> {
    const generation = this.generation
    const tokenRevision = this.tokenRevision
    const controller = new AbortController()
    this.pending.add(controller)
    // AbortSignal alone cannot bound an injected transport or a stalled body parser.
    // One shared rejection deadline covers both phases and settles sign-out promptly.
    let interrupted!: () => void
    const interruption = new Promise<never>((_, reject) => {
      interrupted = () => reject(new TrackingRequestError(generation !== this.generation
        ? 'Session changed. Sign in again.'
        : 'Progress connection timed out. Retry when connected. Local music is retained.'))
      controller.signal.addEventListener('abort', interrupted, { once: true })
    })
    const bounded = <T,>(operation: Promise<T>): Promise<T> => Promise.race([operation, interruption])
    const timeout = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()))
    try {
      // Browser fetch is a host function: do not bind its receiver to this class.
      const fetchImpl = this.fetchImpl
      const response = await bounded(fetchImpl(`/api/v1/${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'), cache: 'no-store', credentials: 'omit',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authenticated ? { Authorization: `Bearer ${this.accessToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      }))
      if (generation !== this.generation) throw new TrackingRequestError('Session changed. Sign in again.')
      // Fixed errors only: never reflect provider text, HTML or credentials.
      if (!response.ok) {
        let code: string | undefined
        if (path.startsWith('auth/') || authenticated) {
          try { const failure: unknown = await bounded(response.json()); if (record(failure) && typeof failure.code === 'string' && ['auth-rejected', 'auth-account-attention', 'auth-rate-limited', 'auth-unavailable', 'auth-session-expired'].includes(failure.code)) code = failure.code } catch (error) { if (error instanceof TrackingRequestError) throw error /* Ignore provider text and malformed responses. */ }
        }
        if (generation !== this.generation) throw new TrackingRequestError('Session changed. Sign in again.')
        // A read may reach the server just after token expiry or return after another
        // read refreshed it. Retry reads once; never replay a mutation automatically.
        if (authenticated && body === undefined && (!method || method === 'GET') && response.status === 401 && retryAuthentication && (tokenRevision !== this.tokenRevision || code === 'auth-session-expired')) {
          if (tokenRevision === this.tokenRevision) await bounded(this.ensureSession(true))
          if (generation !== this.generation) throw new TrackingRequestError('Session changed. Sign in again.')
          return await bounded(this.request(path, body, authenticated, method, false, deadlineAt))
        }
        throw new TrackingRequestError(response.status === 401 ? 'Sign-in expired or details incorrect. Please sign in again.' : response.status === 409 ? 'Update conflict. Refresh and review the saved pending update; its original version is unchanged.' : response.status === 403 ? 'This account cannot send that update. This attempt was rejected.' : response.status === 400 ? 'Update rejected. Check the details.' : response.status === 429 ? 'Too many requests. Wait before trying again.' : 'Outcome unconfirmed. Progress service unavailable; keep the pending update and check status before retrying.', response.status, code, tokenRevision)
      }
      const value: unknown = await bounded(response.json())
      if (generation !== this.generation) throw new TrackingRequestError('Session changed. Sign in again.')
      return value
    } catch (error) {
      if (error instanceof TrackingRequestError) throw error
      throw new TrackingRequestError('Progress connection unavailable or response unreadable. Retry when connected. Local music is retained.')
    } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', interrupted); this.pending.delete(controller) }
  }

  async status(): Promise<{ configured: boolean; reason: string }> {
    const v = await this.request('status')
    if (!record(v) || typeof v.configured !== 'boolean' || typeof v.reason !== 'string') throw malformed()
    return { configured: v.configured, reason: v.reason }
  }
  private tokens(v: unknown) {
    if (!record(v) || typeof v.accessToken !== 'string' || !v.accessToken || typeof v.refreshToken !== 'string' || !v.refreshToken || typeof v.expiresIn !== 'number' || !Number.isFinite(v.expiresIn) || v.expiresIn <= 0) throw malformed()
    this.tokenRevision++
    this.accessToken = v.accessToken; this.refreshToken = v.refreshToken
    this.expiresAt = this.now() + v.expiresIn * 1000
    this.saveSession()
  }
  async login(email: string, password: string): Promise<void> {
    this.signOut()
    const generation = this.generation
    const value = await this.request('auth/login', { email: email.trim(), password })
    if (generation !== this.generation) throw new Error('Session changed. Sign in again.')
    this.tokens(value)
  }
  private async ensureSession(forceRefresh = false): Promise<number> {
    const generation = this.generation
    if (!this.accessToken) throw new Error('Sign in to view assigned progress.')
    if (forceRefresh || this.now() >= this.expiresAt - 30000) {
      if (!this.refreshing) {
        const refresh = this.request('auth/refresh', { refreshToken: this.refreshToken }).then(v => {
          if (generation !== this.generation) throw new Error('Session changed. Sign in again.')
          this.tokens(v)
        }).catch(error => {
          if (generation === this.generation && error instanceof TrackingRequestError && error.status === 401) this.signOut()
          throw error
        })
        this.refreshing = refresh
        void refresh.finally(() => { if (this.refreshing === refresh) this.refreshing = null }).catch(() => {})
      }
      await this.refreshing
    }
    if (generation !== this.generation) throw new Error('Session changed. Sign in again.')
    return generation
  }
  async workspace(): Promise<TrackingWorkspace> {
    const generation = await this.ensureSession()
    if (generation !== this.generation) throw new Error('Session changed. Sign in again.')
    let value: unknown
    try { value = await this.request('workspace', undefined, true) }
    catch (error) {
      if (generation === this.generation && error instanceof TrackingRequestError && error.status === 401 && error.sessionRevision === this.tokenRevision) this.signOut()
      throw error
    }
    if (generation !== this.generation) throw new Error('Session changed. Sign in again.')
    const workspace = parseTrackingWorkspace(value)
    if (this.actorId && workspace.profile.id !== this.actorId) { this.signOut(); throw new Error('Account changed unexpectedly. Sign in again.') }
    this.actorId = workspace.profile.id
    return workspace
  }
  /** Captured by the outbox before disk I/O; any account change invalidates it. */
  sessionGuard(actorId: string): () => void {
    const generation = this.generation
    const guard = () => { if (generation !== this.generation || !this.accessToken || this.actorId !== actorId) throw new Error('Account changed. Sign in to the original account to send its pending updates.') }
    guard(); return guard
  }
  async command(actorId: string, command: TrackingCommand): Promise<TrackingCommandResult> {
    const guard = this.sessionGuard(actorId)
    if (!validTrackingCommand(command)) throw new Error('Invalid update. Nothing was sent.')
    const frozen = structuredClone(command)
    await this.ensureSession(); guard()
    const route = commandRoute(frozen)
    const value = await this.request(route.path, frozen.payload, true, route.method)
    guard()
    return validateCommandResult(frozen, parseCommandResult(value))
  }
  async submission(actorId: string, id: string): Promise<{ found: boolean; result: TrackingCommandResult | null }> {
    const guard = this.sessionGuard(actorId)
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid update identity.')
    await this.ensureSession(); guard()
    const value = await this.request(`submissions/${id}`, undefined, true)
    guard()
    if (!record(value) || typeof value.found !== 'boolean' || (!value.found && value.result !== null)) throw malformed()
    return { found: value.found, result: value.found ? parseCommandResult(value.result) : null }
  }
}
