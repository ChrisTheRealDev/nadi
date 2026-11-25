import { createServer } from 'node:http'
import { realpath, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { isAbsolute, relative, resolve, sep, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEMO_HOST, DEMO_ORIGIN, DEMO_PORT, loadDemoEnvironment } from './config.mjs'
import { createTrackingHandler } from '../tracking/runtime.mjs'
import { creationMiraPlugin } from '../mira/creationRuntime.mjs'
import { validateCheckpoint } from '../../src/tracking/checkpoint.ts'

export { DEMO_ORIGIN, loadDemoEnvironment }
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.nadi': 'application/octet-stream',
}
const contained = (base, target) => {
  const difference = relative(base, target)
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
}

/** Dist-only static server. API modules and private ledgers are never static roots. */
export async function createDemoServer({ root = process.cwd(), env = {}, fetchImpl = fetch } = {}) {
  const projectRoot = await realpath(resolve(root))
  let distRoot
  try {
    distRoot = await realpath(resolve(projectRoot, 'dist'))
    if (!contained(projectRoot, distRoot) || !(await stat(resolve(distRoot, 'index.html'))).isFile()) throw new Error()
  } catch { throw new Error('Built frontend unavailable. Run npm run build first.') }
  const middleware = [createTrackingHandler({ env: { ...env, NADI_ORIGIN: DEMO_ORIGIN }, fetchImpl, validateCheckpoint })]
  // Reuse the existing server-side transport and unchanged quota paths. This small
  // adapter does not construct a Vite server or expose its source-file middleware.
  creationMiraPlugin({ ...env, MIRA_ALLOWED_ORIGIN: DEMO_ORIGIN }).configureServer({ config: { root: projectRoot }, middlewares: { use: handler => middleware.push(handler) } })

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cache-Control', 'no-store')
    if (req.headers.host !== new URL(DEMO_ORIGIN).host
      || req.headers.origin && req.headers.origin !== DEMO_ORIGIN
      || req.headers['sec-fetch-site'] === 'cross-site') {
      res.statusCode = 403; res.end('Local NADI origin required'); return
    }
    let pathname
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new Error()
      pathname = decodeURIComponent(req.url.split('?')[0])
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error()
    } catch { res.statusCode = 400; res.end('Invalid path'); return }
    try {
      let index = 0
      const run = async () => {
        if (index < middleware.length) {
          let continuation
          await middleware[index++](req, res, () => { continuation = run(); return continuation })
          if (continuation) await continuation
          return
        }
        if (pathname.startsWith('/api/')) { res.statusCode = 404; res.end('API not found'); return }
        if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return }
        const candidate = resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
        if (!contained(distRoot, candidate)) { res.statusCode = 403; res.end(); return }
        let target, info
        try {
          target = await realpath(candidate)
          info = await stat(target)
        } catch { res.statusCode = 404; res.end('Not found'); return }
        const mime = MIME[extname(target).toLowerCase()]
        if (!contained(distRoot, target) || !info.isFile() || !mime) { res.statusCode = 404; res.end('Not found'); return }
        res.setHeader('Content-Type', mime)
        res.setHeader('Content-Length', info.size)
        if (req.method === 'HEAD') { res.end(); return }
        const stream = createReadStream(target)
        stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.destroy() })
        stream.pipe(res)
      }
      await run()
    } catch {
      if (!res.headersSent) { res.statusCode = 503; res.end('NADI is temporarily unavailable. Keep your local work.') }
      else res.destroy()
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  return server
}

export async function startDemoServer({ root = process.cwd() } = {}) {
  const env = await loadDemoEnvironment(root)
  const server = await createDemoServer({ root, env })
  await new Promise((resolveStarted, reject) => {
    server.once('error', reject)
    server.listen(DEMO_PORT, DEMO_HOST, () => { server.off('error', reject); resolveStarted() })
  })
  console.log(`NADI demo: ${DEMO_ORIGIN}/ — localhost only; private server configuration is not served.`)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startDemoServer().catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port ' + DEMO_PORT + ' is already in use. The running service was left in place.' : 'NADI demo could not start. Check the frontend build and server configuration.')
    process.exitCode = 1
  })
}

