import { timingSafeEqual } from 'node:crypto'
import { DurableMiraBudget } from './budget.ts'
import { NodeFileMiraBudgetRepository } from './nodeFileBudgetRepository.ts'
import { readMiraCapabilityCookie, verifyTeenCapability } from './capability.ts'
import { loadCreationMiraConfig } from './creationConfig.ts'
import { miraServerReadiness } from './config.ts'
import { createCreationMiraHandler, creationJson } from './creationHandler.ts'
import { createCreationProvider } from './creationProvider.ts'
import { createStudioProvider } from './studioProvider.ts'
import { createMiraCapabilityIssueHandler } from './handler.ts'
import { classifyCreationPath } from './creationPath.ts'
import { loadGroqConfig, groqReadiness } from './groqConfig.ts'
import { createGroqStudioProvider } from './groqProvider.ts'
import { createGroqMiraHandler, durableGroqRequestQuota, isLocalGroqRequest } from './groqHandler.ts'
import { createTutorSummaryHandler } from './tutorSummaryHandler.ts'
import { MiraTrafficGate } from './policy.ts'

// This module is loaded only by Vite's Node configuration, never by frontend imports.
export function creationMiraPlugin(env) {
  // Selecting Groq or an unknown provider must never fall through to a paid provider.
  const selectedProvider = env.MIRA_PROVIDER ?? 'openai'
  const config = loadCreationMiraConfig(env)
  if (selectedProvider !== 'openai') config.enabled = false
  const groq = loadGroqConfig(env)
  const activeOrigin = selectedProvider === 'groq' ? groq.allowedOrigin : config.allowedOrigin
  const capability = { secret: config.capabilitySecret ?? '', approvedCohortIds: config.approvedTeenCohortIds, now: Date.now }
  const verifyCapability = token => config.capabilitySecret ? verifyTeenCapability(token, capability) : Promise.resolve(null)
  const supervisorToken = env.MIRA_SUPERVISOR_TOKEN
  const authorizeSupervisor = request => {
    if (!supervisorToken || supervisorToken.length < 32) return false
    const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    const a = Buffer.from(supplied), b = Buffer.from(supervisorToken)
    return a.length === b.length && timingSafeEqual(a, b)
  }
  let handler
  return {
    name: 'nadi-creation-mira-server',
    configureServer(server) {
      const budget = new DurableMiraBudget(new NodeFileMiraBudgetRepository(`${server.config.root}/.mira-private/ledger.json`), Math.max(1, config.spendCapMicrousd))
      handler = createCreationMiraHandler({ config, budget, verifyCapability, provider: miraServerReadiness(config).ready ? createCreationProvider(config) : null, studioProvider: miraServerReadiness(config).ready ? createStudioProvider(config) : null })
      // The separate ledger counts requests (including failures), not dollars. It never resets on restart.
      const requestCounter = new DurableMiraBudget(new NodeFileMiraBudgetRepository(`${server.config.root}/.mira-private/groq-requests.json`), Math.max(1, groq.totalRequestLimit))
      const groqQuota = durableGroqRequestQuota(requestCounter)
      const groqGate = new MiraTrafficGate(groq.requestsPerMinute, groq.maxConcurrent, Date.now)
      const groqHandler = createGroqMiraHandler({ config: groq, quota: groqQuota, gate: groqGate, provider: groqReadiness(groq).ready ? createGroqStudioProvider(groq) : null })
      const tutorSummaryHandler = createTutorSummaryHandler({ config: groq, quota: groqQuota, gate: groqGate })
      const issue = createMiraCapabilityIssueHandler({ config, capability, authorizeSupervisor })
      server.middlewares.use(async (req, res, next) => {
        const { path, rejection } = classifyCreationPath(req.url)
        // Durable bookkeeping must never be served as a workspace static file.
        if (rejection) { res.statusCode = rejection; res.end(); return }
        if (!path?.startsWith('/api/mira/creation')) { next(); return }
        try {
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
          if (selectedProvider === 'groq' && !isLocalGroqRequest(new Request(`${activeOrigin}${path}`, { headers }), req.socket.remoteAddress, activeOrigin, req.method === 'GET')) {
            res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'Local NADI origin required' })); return
          }
          let length = 0; const chunks = []
          for await (const chunk of req) { length += chunk.length; if (length > 16384) { res.statusCode = 413; res.end(); return } chunks.push(chunk) }
          const request = new Request(`${activeOrigin}${path}`, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) })
          let response
          if (path === '/api/mira/creation/status' && req.method === 'GET') {
            if (selectedProvider === 'groq') {
              let ready = groqReadiness(groq).ready, remaining = 0, blocker = ready ? null : 'configuration-required'
              if (ready) {
                try { const ledger = await requestCounter.snapshot(); remaining = Math.max(0, groq.totalRequestLimit - ledger.entries.reduce((sum, entry) => sum + entry.amountMicrousd, 0)); ready = remaining > 0; if (!ready) blocker = 'quota-exhausted' }
                catch { ready = false; blocker = 'quota-unavailable' }
              }
              response = creationJson({ ready, authorized: ready, provider: 'groq', access: ready ? 'local-demo' : 'authored-only', remainingRequests: remaining, blocker })
            } else {
              const claims = await verifyCapability(readMiraCapabilityCookie(request.headers.get('cookie')))
              response = creationJson({ ready: miraServerReadiness(config).ready, authorized: miraServerReadiness(config).ready && !!claims, provider: selectedProvider === 'openai' ? 'openai' : null, access: claims ? 'supervised-teen' : 'authored-only' })
            }
          } else if (path === '/api/mira/creation/tutor-summary') {
            response = selectedProvider === 'groq' ? await tutorSummaryHandler(request, req.socket.remoteAddress) : creationJson({ error: 'Optional Groq tutor summary unavailable' }, 404)
          } else if (path === '/api/mira/creation/adult-session') {
            response = creationJson({ error: 'Not found' }, 404)
          } else if (path === '/api/mira/creation/capability') response = await issue(request)
          else if (path === '/api/mira/creation') {
            // Preserved v1 clients retain authored fallback; multitrack v2/v3/v4 use Groq.
            let isLegacy = false
            try { isLegacy = JSON.parse(Buffer.concat(chunks).toString('utf8')).version === 1 } catch { /* Validated by handler. */ }
            response = selectedProvider === 'groq' && !isLegacy ? await groqHandler(request, undefined, req.socket.remoteAddress) : await handler(request)
          }
          else response = creationJson({ error: 'Not found' }, 404)
          res.statusCode = response.status; for (const [key, value] of response.headers) res.setHeader(key, value); res.end(await response.text())
        } catch { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'Authored help remains available' })) }
      })
    },
  }
}
