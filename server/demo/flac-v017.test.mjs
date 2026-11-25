import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let server, port, expected, host
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
function call(method) {
  return new Promise((resolveResponse, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/audio/salamander/C3v5.flac', method, headers: { host } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject); req.end()
  })
}

beforeAll(async () => {
  // Explicit D:-workspace fixture storage: do not use a nearly-full system TEMP.
  const fixtures = join(projectRoot, 'audit-fixtures')
  await mkdir(fixtures, { recursive: true })
  const root = await mkdtemp(join(fixtures, 'flac-http-'))
  await mkdir(join(root, 'dist', 'audio', 'salamander'), { recursive: true })
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>Isolated FLAC regression</title>', { flag: 'wx' })
  const original = join(projectRoot, 'public', 'audio', 'salamander', 'C3v5.flac')
  expected = await readFile(original)
  expect(expected.subarray(0, 4).toString()).toBe('fLaC')
  await copyFile(original, join(root, 'dist', 'audio', 'salamander', 'C3v5.flac'))
  // Optional read-only baseline points at a preserved prior source checkout.
  const entry = pathToFileURL(join(resolve(process.env.NADI_FLAC_BASELINE_ROOT || projectRoot), 'server', 'demo', 'entry.mjs')).href
  const module = await import(/* @vite-ignore */ entry)
  host = new URL(module.DEMO_ORIGIN).host
  server = await module.createDemoServer({ root, env: { MIRA_PROVIDER: 'disabled' }, fetchImpl: () => { throw new Error('This static asset test must not contact a provider.') } })
  await new Promise((resolveStarted, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveStarted) })
  port = server.address().port
})
afterAll(async () => { if (server) await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed())) })

describe('portable piano sample transport', () => {
  it('serves the shipped FLAC piano sample unchanged with its audio MIME type', async () => {
    const result = await call('GET')
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('audio/flac')
    expect(Number(result.headers['content-length'])).toBe(expected.length)
    expect(result.bytes.equals(expected)).toBe(true)
    expect(result.headers['x-content-type-options']).toBe('nosniff')
  })
  it('provides FLAC metadata without streaming a body for HEAD', async () => {
    const result = await call('HEAD')
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('audio/flac')
    expect(Number(result.headers['content-length'])).toBe(expected.length)
    expect(result.bytes.length).toBe(0)
  })
})
