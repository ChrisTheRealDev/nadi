import { createServer, get } from 'node:http'
import { once } from 'node:events'
import { describe, it, expect } from 'vitest'
import { trackingPlugin } from './runtime.mjs'

describe('versioned preview tracking origin', () => {
  it('accepts its own listener, overrides stale config and rejects foreign origins/hosts', async () => {
    let middleware
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end() }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = server.address().port
    const origin = `http://127.0.0.1:${port}`
    trackingPlugin({ NADI_ORIGIN: 'http://127.0.0.1:5176', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }).configureServer({
      config: { server: { host: '127.0.0.1', port } },
      middlewares: { use: handler => { middleware = handler } },
    })
    try {
      const status = await fetch(`${origin}/api/v1/status`)
      expect(status.status).toBe(200)
      expect(await status.json()).toMatchObject({ configured: true })
      expect((await fetch(`${origin}/api/v1/status`, { headers: { origin } })).status).toBe(200)
      expect((await fetch(`${origin}/api/v1/status`, { headers: { origin: 'http://127.0.0.1:5176' } })).status).toBe(403)
      const reboundStatus = await new Promise((resolve, reject) => {
        get(`${origin}/api/v1/status`, { headers: { host: 'attacker.test' } }, response => {
          response.resume()
          resolve(response.statusCode)
        }).on('error', reject)
      })
      expect(reboundStatus).toBe(403)
      expect((await fetch(`${origin}/api/v1/workspace`)).status).toBe(401)
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })
})
