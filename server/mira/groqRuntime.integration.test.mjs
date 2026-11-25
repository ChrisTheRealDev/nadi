import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { creationMiraPlugin } from './creationRuntime.mjs'

const origin = 'http://127.0.0.1:5176'
const env = {
  MIRA_PROVIDER: 'groq', MIRA_LIVE_ENABLED: 'true', GROQ_API_KEY: 'fake-groq-test-key-not-real',
  MIRA_GROQ_FREE_TIER_CONFIRMED: 'true', MIRA_ADULT_DEMO_CONFIRMED: 'true',
  MIRA_GROQ_TOTAL_REQUEST_LIMIT: '2', MIRA_ALLOWED_ORIGIN: origin,
  // Deliberately ready paid settings: choosing Groq/unknown must still prevent OpenAI fallback.
  OPENAI_API_KEY: 'fake-openai-test-key-not-real', MIRA_SPEND_CAP_MICROUSD: '1000000', MIRA_MAX_REQUEST_COST_MICROUSD: '200000',
  MIRA_CAPABILITY_SECRET: 'fake-teen-test-secret-at-least-32-chars', MIRA_APPROVED_TEEN_COHORTS: 'pilot-a',
  MIRA_MODEL_COST_BOUND_VERIFIED: 'true', MIRA_VERIFIED_INPUT_MICROUSD_PER_TOKEN: '10', MIRA_VERIFIED_OUTPUT_MICROUSD_PER_TOKEN: '50',
}
const dto = { version: 2, requestId: 'runtime-test-question', revision: 7, question: 'Why do chords sound different?', history: [], workspace: { trackKind: 'melodic', hasClip: true, hasNotes: true, linkedUses: 1, canUndo: true, saved: true } }
const explanation = { topic: null, stepIds: [], explanation: 'The gaps between pitches change the character of a chord.' }
const providerResponse = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(explanation) } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }), { headers: { 'content-type': 'application/json' } })
const roots = []
async function temporaryRoot() { const root = await mkdtemp(join(tmpdir(), 'nadi-groq-runtime-test-')); roots.push(root); return root }
function runtime(root, settings = env) {
  let middleware
  creationMiraPlugin(settings).configureServer({ config: { root }, middlewares: { use(value) { middleware = value } } })
  return async (path, { method = 'GET', body, cookie, remoteAddress = '127.0.0.1', requestOrigin = origin, host = '127.0.0.1:5176', extraHeaders = {} } = {}) => {
    const input = body === undefined ? [] : [new TextEncoder().encode(JSON.stringify(body))]
    const req = Object.assign(Readable.from(input), { url: path, method, headers: { ...(requestOrigin === null ? {} : { origin: requestOrigin }), host, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extraHeaders }, socket: { remoteAddress } })
    const headers = {}, res = { statusCode: 200, setHeader(key, value) { headers[key] = value }, end(text = '') { this.body = text } }
    let passed = false
    await middleware(req, res, () => { passed = true })
    return { status: res.statusCode, headers, body: res.body, json: res.body ? JSON.parse(res.body) : null, passed }
  }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of roots.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('nadi-groq-runtime-test-')) throw new Error('Unsafe temporary cleanup path')
    await rm(target, { recursive: true, force: true })
  }
})

describe('Groq local demo runtime and persistent quota', () => {
  it('is ready without cookies or pairing; retired pairing route never reads or consumes an old code', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const root = await temporaryRoot(), code = 'a'.repeat(64), file = join(root, '.mira-private', 'groq-pairing.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'old pairing state stays untouched')
    const call = runtime(root)
    expect((await call('/api/mira/creation/status', { requestOrigin: null })).json).toMatchObject({ ready: true, authorized: true, provider: 'groq', access: 'local-demo', remainingRequests: 2 })
    const paired = await call('/api/mira/creation/adult-session', { method: 'POST', body: { code } })
    expect(paired.status).toBe(404); expect(paired.headers['set-cookie']).toBeUndefined()
    expect((await runtime(root)('/api/mira/creation/status')).json).toMatchObject({ ready: true, authorized: true, access: 'local-demo' })
    expect(await readFile(file, 'utf8')).toBe('old pairing state stays untouched')
    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(paired.json)).not.toContain(code)
    expect(JSON.stringify(paired)).not.toContain(env.GROQ_API_KEY)
  })
  it('rejects wrong Host, external or missing POST Origin, and nonlocal sockets even with forged forwarding headers', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const root = await temporaryRoot(), call = runtime(root)
    for (const options of [
      { host: 'attacker.example:5176' }, { host: 'localhost:5176' }, { host: '127.0.0.1:9999' }, { host: '' },
      { requestOrigin: 'https://attacker.example' }, { requestOrigin: 'null' },
      { remoteAddress: '192.168.1.5', extraHeaders: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': '127.0.0.1:5176' } },
      { remoteAddress: '' },
    ]) {
      expect((await call('/api/mira/creation/status', options)).status).toBe(403)
      expect((await call('/api/mira/creation', { ...options, method: 'POST', body: dto })).status).toBe(403)
    }
    expect((await call('/api/mira/creation', { method: 'POST', body: dto, requestOrigin: null })).status).toBe(403)
    for (const remoteAddress of ['::1', '::ffff:127.0.0.1']) expect((await call('/api/mira/creation/status', { remoteAddress })).json.authorized).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    expect((await call('/api/mira/creation/status')).json.remainingRequests).toBe(2)
  })
  it('persists failed and successful attempts across restarts and never falls back to OpenAI when exhausted', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('provider offline')).mockImplementation(async () => providerResponse()); vi.stubGlobal('fetch', fetcher)
    const root = await temporaryRoot(), call = runtime(root)
    const failed = await call('/api/mira/creation', { method: 'POST', body: dto })
    expect(failed.json).toMatchObject({ source: 'authored', transmission: 'sent' })
    expect((await runtime(root)('/api/mira/creation/status')).json.remainingRequests).toBe(1)
    const successful = await runtime(root)('/api/mira/creation', { method: 'POST', body: dto })
    expect(successful.json).toMatchObject({ source: 'live', reason: 'validated-groq-selection', selection: explanation })
    expect((await runtime(root)('/api/mira/creation/status')).json).toMatchObject({ ready: false, authorized: false, remainingRequests: 0 })
    expect((await runtime(root)('/api/mira/creation', { method: 'POST', body: dto })).json).toMatchObject({ source: 'authored', reason: 'quota-unavailable', transmission: 'not-sent' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => url === 'https://api.groq.com/openai/v1/chat/completions')).toBe(true)
    const ledger = JSON.parse(await readFile(join(root, '.mira-private', 'groq-requests.json'), 'utf8'))
    expect(ledger.entries).toHaveLength(2); expect(ledger.entries.every(entry => entry.amountMicrousd === 1 && entry.state === 'settled')).toBe(true)
    await expect(readFile(join(root, '.mira-private', 'ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('unknown provider and preserved legacy clients stay authored even with valid paid settings', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const root = await temporaryRoot(), unknown = runtime(root, { ...env, MIRA_PROVIDER: 'groq-typo' })
    expect((await unknown('/api/mira/creation/status')).json).toMatchObject({ ready: false, authorized: false, provider: null })
    expect((await unknown('/api/mira/creation', { method: 'POST', body: dto })).json.source).toBe('authored')
    const legacy = { version: 1, question: 'How do I change a note?', workspace: { projectId: 'test-project', revision: 0, editor: 'piano', selectedBar: 0, hasPianoNotes: true, hasDrumHits: false, selectedNote: false, visibleDrumRows: ['kick', 'snare', 'hat'], mutedInstruments: [], saved: true } }
    expect((await runtime(root)('/api/mira/creation', { method: 'POST', body: legacy })).json.source).toBe('authored')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('blocks corrupt quota data and private file URLs without leaking secrets or resetting the quota', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const root = await temporaryRoot(), file = join(root, '.mira-private', 'groq-requests.json')
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, '{broken')
    const call = runtime(root)
    expect((await call('/api/mira/creation/status')).json.ready).toBe(false)
    expect((await call('/api/mira/creation', { method: 'POST', body: dto })).json.reason).toBe('quota-unavailable')
    expect(await readFile(file, 'utf8')).toBe('{broken')
    for (const path of ['/.mira-private/groq-pairing.json', '/%252emira-private/groq-requests.json', '/@fs/C:/example/.mira-private/groq-pairing.json']) {
      const result = await call(path); expect(result.status).toBe(403); expect(result.passed).toBe(false)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})
