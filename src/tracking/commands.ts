/** Shared browser command types; the server independently validates every action. */
export type TrackingCommand =
  | { kind: 'goal-create'; payload: { submissionId: string; learnerId: string; title: string; description: string; dueDate?: string } }
  | { kind: 'goal-status'; payload: { submissionId: string; goalId: string; expectedVersion: number; status: 'not-started' | 'in-progress' | 'student-complete' } }
  | { kind: 'help-create'; payload: { submissionId: string; goalId: string; message: string } }
  | { kind: 'help-resolve'; payload: { submissionId: string; requestId: string } }
  | { kind: 'disclosure'; payload: { version: 1 } }
export interface TrackingCommandResult { id?: string; version?: number; status?: string; resolved?: boolean; accepted?: boolean; localCleanupPending?: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
// Reject non-text control bytes, matching the server's input boundary.
// eslint-disable-next-line no-control-regex
const text = (v: unknown, max: number, empty = false) => typeof v === 'string' && v.length <= max && (empty || !!v.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
function exact(v: Record<string, unknown>, required: string[], optional: string[] = []) { return required.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => [...required, ...optional].includes(key)) }
export function validTrackingCommand(value: unknown): value is TrackingCommand {
  if (!object(value) || !exact(value, ['kind', 'payload']) || !object(value.payload)) return false
  const p = value.payload
  if (value.kind === 'disclosure') return exact(p, ['version']) && p.version === 1
  if (!id(p.submissionId)) return false
  switch (value.kind) {
    case 'goal-create': return exact(p, ['submissionId','learnerId','title','description'], ['dueDate']) && id(p.learnerId) && text(p.title,160) && text(p.description,2000,true) && (p.dueDate === undefined || typeof p.dueDate === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(p.dueDate) && Number.isFinite(Date.parse(p.dueDate)) && new Date(p.dueDate).toISOString().slice(0,10) === p.dueDate)
    case 'goal-status': return exact(p,['submissionId','goalId','expectedVersion','status']) && id(p.goalId) && Number.isInteger(p.expectedVersion) && Number(p.expectedVersion) >= 0 && Number(p.expectedVersion) <= 2147483647 && typeof p.status === 'string' && ['not-started','in-progress','student-complete'].includes(p.status)
    case 'help-create': return exact(p,['submissionId','goalId','message']) && id(p.goalId) && text(p.message,2000)
    case 'help-resolve': return exact(p,['submissionId','requestId']) && id(p.requestId)
    default: return false
  }
}
export function parseCommandResult(value: unknown): TrackingCommandResult {
  if (!object(value)) throw new Error('Server confirmation could not be read. Keep the pending update and check its status.')
  if (value.accepted === true && value.version === 1 && !value.id) return { accepted:true,version:1 }
  if (!id(value.id)) throw new Error('Server confirmation could not be read. Keep the pending update and check its status.')
  const result: TrackingCommandResult = { id:value.id }
  if (value.version !== undefined) { if (!Number.isInteger(value.version) || Number(value.version) < 0) throw new Error('Invalid version confirmation. Check update status.'); result.version = Number(value.version) }
  if (value.status !== undefined) { if (typeof value.status !== 'string' || !['not-started','in-progress','student-complete'].includes(value.status)) throw new Error('Invalid status confirmation. Check update status.'); result.status = value.status }
  if (value.resolved !== undefined) { if (value.resolved !== true) throw new Error('Invalid resolution confirmation.'); result.resolved = true }
  return result
}
export function validateCommandResult(command: TrackingCommand, result: TrackingCommandResult) {
  const valid = command.kind === 'disclosure' ? result.accepted === true && result.version === 1
    : command.kind === 'goal-create' ? !!result.id && result.version === 0
    : command.kind === 'goal-status' ? result.id === command.payload.goalId && result.status === command.payload.status && (result.version === command.payload.expectedVersion || result.version === command.payload.expectedVersion + 1)
    : command.kind === 'help-resolve' ? result.id === command.payload.requestId && result.resolved === true
    : !!result.id
  if (!valid) throw new Error('The confirmation did not match your update. Keep it pending and check status.')
  return result
}
export function commandRoute(command: TrackingCommand) {
  switch (command.kind) {
    case 'goal-create': return { path:'goals', method:'POST' }
    case 'goal-status': return { path:`goals/${command.payload.goalId}`, method:'PATCH' }
    case 'help-create': return { path:'help-requests', method:'POST' }
    case 'help-resolve': return { path:`help-requests/${command.payload.requestId}/resolve`, method:'POST' }
    case 'disclosure': return { path:'disclosure', method:'POST' }
  }
}
