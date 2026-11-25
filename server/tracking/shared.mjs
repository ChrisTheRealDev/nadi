import { createHash } from 'node:crypto'
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const fail = result => json({ error: 'Shared work request failed. Local work is retained.' }, ['40001', '23505'].includes(result.data?.code) ? 409 : result.data?.code === '42501' ? 403 : ['22023','22P02','23514','23503'].includes(result.data?.code) ? 400 : 503)
export async function handleShared({ request, url, body, actor, token, upstream, config, fetchImpl }) {
  if (url.pathname === '/api/v1/shared') {
    if (request.method === 'GET') {
      const learnerId = url.searchParams.get('learnerId'), projectId = url.searchParams.get('projectId')
      if (!uuid(learnerId) || projectId && projectId.length > 120) return json({ error: 'Invalid identity' }, 400)
      const result = await upstream('/rest/v1/rpc/nadi_shared_read', token, { p_learner_id: learnerId, p_project_id: projectId })
      return result.ok ? json(result.data) : fail(result)
    }
    if (request.method !== 'POST' || !body || !['enroll','revision','exchange','comment','reply','resolve'].includes(body.kind) || !body.payload || typeof body.payload !== 'object' || typeof body.payload.mutationId !== 'string') return json({ error: 'Invalid shared command' }, 400)
    if (body.kind === 'revision') {
      // Validate the full current musical schema without copying original audio into revisions.
      const candidate = structuredClone(body.payload.manifest)
      if (!candidate || !Array.isArray(candidate.ideas)) return json({ error: 'Invalid composition' }, 400)
      for (const idea of candidate.ideas) {
        if (idea?.original?.kind !== 'audio') continue
        const original = idea.original
        if (!hash(original.assetHash) || Object.hasOwn(original, 'base64') || !Number.isInteger(original.byteLength) || original.byteLength < 1 || original.byteLength > 1024 * 1024) return json({ error: 'Invalid capture reference' }, 400)
        delete original.assetHash
        original.base64 = Buffer.alloc(original.byteLength).toString('base64')
      }
      const { validateStudioProject } = await import('../../src/creation/v4/model.ts')
      if (!validateStudioProject(candidate) || candidate.id !== body.payload.projectId) return json({ error: 'Invalid composition' }, 400)
    }
    const result = await upstream('/rest/v1/rpc/nadi_music_command', token, { p_kind: body.kind, p_payload: body.payload })
    return result.ok ? json(result.data) : fail(result)
  }
  if (url.pathname !== '/api/v1/captures') return null
  const headers = { apikey: config.key, Authorization: `Bearer ${token}` }
  if (request.method === 'GET') {
    const learner = url.searchParams.get('learnerId'), digest = url.searchParams.get('hash')
    if (!uuid(learner) || !hash(digest)) return json({ error: 'Invalid capture' }, 400)
    const response = await fetchImpl(`${config.url}/storage/v1/object/authenticated/nadi-captures/${learner}/${digest}`, { headers, signal: AbortSignal.timeout(12000) })
    if (!response.ok) return json({ error: 'Capture unavailable or access denied' }, response.status === 403 || response.status === 404 ? 403 : 503)
    const bytes = Buffer.from(await response.arrayBuffer())
    return json({ base64: bytes.toString('base64'), mimeType: response.headers.get('content-type') || 'audio/webm' })
  }
  if (request.method !== 'POST' || !hash(body?.hash) || typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64) || typeof body.mimeType !== 'string' || !/^audio\/(webm|ogg|mp4|wav)(;.*)?$/i.test(body.mimeType)) return json({ error: 'Invalid capture' }, 400)
  const bytes = Buffer.from(body.base64, 'base64')
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.toString('base64') !== body.base64 || createHash('sha256').update(bytes).digest('hex') !== body.hash) return json({ error: 'Capture integrity failed' }, 400)
  const path = `${config.url}/storage/v1/object/nadi-captures/${actor}/${body.hash}`
  const response = await fetchImpl(path, { method: 'POST', headers: { ...headers, 'content-type': body.mimeType, 'x-upsert': 'false' }, body: bytes, signal: AbortSignal.timeout(12000) })
  if (response.ok) return json({ saved: true })
  // A lost acknowledgement is retriable only when immutable existing bytes match.
  if ([400,409].includes(response.status)) {
    const existing = await fetchImpl(`${config.url}/storage/v1/object/authenticated/nadi-captures/${actor}/${body.hash}`, { headers, signal: AbortSignal.timeout(12000) })
    if (existing.ok && createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex') === body.hash) return json({ saved: true })
  }
  return json({ error: 'Capture upload unconfirmed. Local original retained.' }, response.status === 403 ? 403 : 503)
}
