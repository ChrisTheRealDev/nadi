import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { request } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildDemoServer } from '../../scripts/build-demo.mjs'
import { DEMO_ORIGIN } from './config.mjs'
import { createStudioProject } from '../../src/creation/v4/model'
import { createCheckpoint } from '../../src/tracking/checkpoint'

let root, output, module, server, port, fetchImpl, fontBytes
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', MIRA_PROVIDER: 'disabled' }
const actor = '11111111-1111-4111-8111-111111111111'
function call(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: new URL(DEMO_ORIGIN).host, ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'nadi-demo-test-'))
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>NADI test build</title>')
  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'console.log("compiled frontend")')
  fontBytes = await readFile(new URL('../../public/assets/brand/NunitoSans-Variable.ttf', import.meta.url))
  await writeFile(join(root, 'dist', 'assets', 'NunitoSans-Variable.ttf'), fontBytes)
  await writeFile(join(root, 'dist', 'assets', 'study.nadi'), 'Fictional archive test')
  await writeFile(join(root, 'private.json'), '{"secret":"do-not-serve"}')
  await mkdir(join(root, 'outside-dist'))
  await writeFile(join(root, 'outside-dist', 'private.json'), '{"secret":"do-not-serve"}')
  await symlink(join(root, 'outside-dist'), join(root, 'dist', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(root, '.env.local'), 'MIRA_PROVIDER=disabled\nSERVER_ONLY_TEST=private-value\n')
  await writeFile(join(root, '.env.tracking.local'), 'SUPABASE_URL=https://example.supabase.co\n')
  await mkdir(join(root, '.mira-private'))
  await writeFile(join(root, '.mira-private', 'groq-requests.json'), 'unchanged-test-ledger')
  output = join(root, 'server.mjs')
  await buildDemoServer(output)
  module = await import(pathToFileURL(output).href)
  fetchImpl = vi.fn(async url => new Response(JSON.stringify(url.endsWith('/auth/v1/user') ? { id: actor } : { id: 'shared', shared: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
  server = await module.createDemoServer({ root, env, fetchImpl })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
}, 20000)
afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  // Temp fixtures are deliberately left outside the workspace; no broad cleanup.
})

describe('bundled standalone Node server', () => {
  it('serves only compiled frontend content and HEAD metadata', async () => {
    const page = await call('/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('NADI test build')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect((await call('/assets/app.js')).headers['content-type']).toContain('javascript')
    const head = await call('/', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.text).toBe('')
  })

  it('serves the bundled studio font and downloadable NADI archives', async () => {
    const font = await call('/assets/NunitoSans-Variable.ttf', { method: 'HEAD' })
    expect(font).toMatchObject({ status: 200, text: '' })
    expect(font.headers['content-type']).toBe('font/ttf')
    expect(Number(font.headers['content-length'])).toBe(fontBytes.length)
    const archive = await call('/assets/study.nadi')
    expect(archive).toMatchObject({ status: 200, text: 'Fictional archive test' })
    expect(archive.headers['content-type']).toBe('application/octet-stream')
  })

  it.each(['/.env.local', '/.env.tracking.local', '/.mira-private/groq-requests.json', '/%2e%2e/private.json', '/assets/%2e%2e/%2e%2e/private.json', '/assets%5c..%5cprivate.json', '/%00'])('does not expose private or traversal path %s', async path => {
    const result = await call(path)
    expect(result.status).toBe(400)
    expect(result.text).not.toContain('private-value')
    expect(result.text).not.toContain('do-not-serve')
  })

  it('does not serve workspace source, vendor files, or a fake SPA success', async () => {
    for (const path of ['/src/main.tsx', '/server/tracking/runtime.mjs', '/private.json', '/design-references/apple.dmg', '/does-not-exist', '/linked/private.json']) {
      expect((await call(path)).status).toBe(404)
    }
  })

  it('rejects unexpected host/origin and cross-site requests', async () => {
    expect((await call('/', { headers: { host: 'localhost:' + new URL(DEMO_ORIGIN).port } })).status).toBe(403)
    expect((await call('/', { headers: { origin: 'https://attacker.test' } })).status).toBe(403)
    expect((await call('/', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })

  it('passes a checkpoint through the bundled actual validator, not an injected stub', async () => {
    fetchImpl.mockClear()
    const response = await call('/api/v1/checkpoints', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mock-user', origin: module.DEMO_ORIGIN }, body: JSON.stringify({
      submissionId: '33333333-3333-4333-8333-333333333333', goalId: '22222222-2222-4222-8222-222222222222', reflection: 'Please listen to my timing.', checkpoint: createCheckpoint(createStudioProject()),
    }) })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.text).shared).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('/rpc/nadi_command')
  })

  it('rejects unknown/private checkpoint fields before its command RPC', async () => {
    fetchImpl.mockClear()
    const response = await call('/api/v1/checkpoints', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mock-user' }, body: JSON.stringify({
      submissionId: '33333333-3333-4333-8333-333333333333', goalId: '22222222-2222-4222-8222-222222222222', reflection: '', checkpoint: { ...createCheckpoint(createStudioProject()), originals: [] },
    }) })
    expect(response.status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('loads the preserved Mira route without live activation or changing a quota ledger', async () => {
    const response = await call('/api/mira/creation/status')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.text)).toMatchObject({ ready: false, authorized: false, access: 'authored-only' })
    expect(await readFile(join(root, '.mira-private/groq-requests.json'), 'utf8')).toBe('unchanged-test-ledger')
  })

  it('uses the built server origin for both API families even with stale settings', async () => {
    const alternate = await module.createDemoServer({
      root,
      env: { MIRA_PROVIDER: 'groq', MIRA_ALLOWED_ORIGIN: 'http://127.0.0.1:5176', NADI_ORIGIN: 'http://127.0.0.1:5176' },
    })
    await new Promise((resolve, reject) => {
      alternate.once('error', reject)
      alternate.listen(0, '127.0.0.1', resolve)
    })
    const previousPort = port
    port = alternate.address().port
    try {
      for (const path of ['/api/v1/status', '/api/mira/creation/status']) {
        expect((await call(path, { headers: { origin: DEMO_ORIGIN } })).status).toBe(200)
        expect((await call(path, { headers: { origin: 'http://127.0.0.1:5176' } })).status).toBe(403)
      }
    } finally {
      port = previousPort
      await new Promise((resolve, reject) => alternate.close(error => error ? reject(error) : resolve()))
    }
  })

  it('reads server configuration privately with explicit process overrides', async () => {
    const loaded = await module.loadDemoEnvironment(root, { MIRA_PROVIDER: 'override' })
    expect(loaded.MIRA_PROVIDER).toBe('override')
    expect(loaded.SERVER_ONLY_TEST).toBe('private-value')
    expect(loaded.SUPABASE_URL).toBe('https://example.supabase.co')
    expect(await readFile(output, 'utf8')).not.toContain('private-value')
  })

  it('requires a real frontend build and rejects unsupported static methods', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'nadi-no-build-'))
    await expect(module.createDemoServer({ root: emptyRoot, env })).rejects.toThrow('Built frontend unavailable')
    expect((await call('/', { method: 'POST' })).status).toBe(405)
  })

  it('imports and handles a valid checkpoint in a separate plain Node process', async () => {
    const payload = { submissionId: '33333333-3333-4333-8333-333333333333', goalId: '22222222-2222-4222-8222-222222222222', reflection: '', checkpoint: createCheckpoint(createStudioProject()) }
    const script = `
      const {createDemoServer}=await import(${JSON.stringify(pathToFileURL(output).href)});
      const {request}=await import('node:http');
      const server=await createDemoServer({root:${JSON.stringify(root)},env:${JSON.stringify(env)},fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/auth/v1/user')?{id:${JSON.stringify(actor)}}:{shared:true}))});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const status=await new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:server.address().port,path:'/api/v1/checkpoints',method:'POST',headers:{host:new URL(${JSON.stringify(DEMO_ORIGIN)}).host,'content-type':'application/json',authorization:'Bearer mock'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end(${JSON.stringify(JSON.stringify(payload))});});
      await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify({status}));
    `
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 15000 })
    expect(JSON.parse(stdout.trim())).toEqual({ status: 200 })
  }, 20000)
})
