const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const exact = (p, keys, optional = []) => p && typeof p === 'object' && !Array.isArray(p) && keys.every(k => Object.hasOwn(p, k)) && Object.keys(p).every(k => [...keys, ...optional].includes(k))
const version = value => Number.isInteger(value) && value >= 0 && value <= 2147483646
const nullableId = value => value == null || uuid(value)
const date = value => value === null || typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}})
export function validConnectionCommand(channel, kind, p) {
  if (!p || !text(p.mutationId, 160)) return false
  if (channel === 'feedback') {
    if (kind === 'read') return exact(p, ['mutationId','itemIds']) && Array.isArray(p.itemIds) && p.itemIds.length > 0 && p.itemIds.length <= 200 && new Set(p.itemIds).size === p.itemIds.length && p.itemIds.every(v => text(v, 100))
    if (kind === 'question') return exact(p, ['mutationId','message'], ['goalId','projectId']) && text(p.message, 4000) && nullableId(p.goalId) && (p.projectId == null || text(p.projectId, 120))
    if (kind === 'checkpoint-reply') return exact(p, ['mutationId','checkpointId','message']) && uuid(p.checkpointId) && text(p.message, 4000)
    if (kind === 'question-reply') return exact(p, ['mutationId','questionId','message']) && uuid(p.questionId) && text(p.message, 4000)
    return false
  }
  if (channel !== 'planner') return false
  switch (kind) {
    case 'goal-edit': return exact(p,['mutationId','goalId','expectedVersion','title','description','dueDate']) && uuid(p.goalId) && version(p.expectedVersion) && text(p.title,160) && text(p.description,2000,true) && date(p.dueDate)
    case 'step-add': return exact(p,['mutationId','goalId','expectedVersion','label']) && uuid(p.goalId) && version(p.expectedVersion) && text(p.label,300)
    case 'step-edit': return exact(p,['mutationId','stepId','expectedVersion','label']) && uuid(p.stepId) && version(p.expectedVersion) && text(p.label,300)
    case 'step-toggle': return exact(p,['mutationId','stepId','expectedVersion','done']) && uuid(p.stepId) && version(p.expectedVersion) && typeof p.done === 'boolean'
    case 'step-reorder': return exact(p,['mutationId','goalId','expectedVersion','stepIds']) && uuid(p.goalId) && version(p.expectedVersion) && Array.isArray(p.stepIds) && p.stepIds.length <= 100 && p.stepIds.every(uuid) && new Set(p.stepIds).size === p.stepIds.length
    case 'project-link': return exact(p,['mutationId','goalId','expectedVersion','projectId']) && uuid(p.goalId) && version(p.expectedVersion) && (p.projectId === null || text(p.projectId,120))
    case 'review-submit': return exact(p,['mutationId','goalId','expectedVersion','snapshotId','reflection']) && uuid(p.goalId) && version(p.expectedVersion) && uuid(p.snapshotId) && text(p.reflection,2000,true)
    case 'review-status': return exact(p,['mutationId','reviewId','expectedVersion','status']) && uuid(p.reviewId) && version(p.expectedVersion) && ['changes-requested','reviewed'].includes(p.status)
    default: return false
  }
}
export async function handleConnection({request,url,body,token,upstream}) {
  const channel = url.pathname === '/api/v1/feedback' ? 'feedback' : url.pathname === '/api/v1/planner' ? 'planner' : null
  if (!channel) return null
  let result
  if (request.method === 'GET') {
    const learnerId = url.searchParams.get('learnerId')
    if (learnerId && !uuid(learnerId) || channel === 'planner' && !learnerId) return json({error:'Select a valid learner.'},400)
    result = await upstream(`/rest/v1/rpc/nadi_${channel}_read`,token,{p_learner_id:learnerId})
  } else if (request.method === 'POST') {
    if (!exact(body,['kind','payload']) || !validConnectionCommand(channel,body.kind,body.payload)) return json({error:'Invalid update. Nothing was changed.'},400)
    result = await upstream('/rest/v1/rpc/nadi_connection_command',token,{p_channel:channel,p_kind:body.kind,p_payload:body.payload})
  } else return json({error:'Method not allowed'},405)
  if (result.ok) return json(result.data)
  const status = ['40001','23505'].includes(result.data?.code) ? 409 : result.data?.code === '42501' ? 403 : ['22023','22P02','23514','23503'].includes(result.data?.code) ? 400 : 503
  return json({error:status === 409 ? 'This item changed. Refresh before trying again.' : status === 403 ? 'This account cannot access this item.' : status === 400 ? 'The update could not be accepted.' : 'Connection features are unavailable. Your existing work is retained.'},status)
}
