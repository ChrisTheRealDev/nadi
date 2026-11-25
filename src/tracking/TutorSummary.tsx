import { useEffect, useRef, useState } from 'react'
import type { StudioProject } from '../creation/v4/model'
import { buildTutorEvidence, parseTutorInterpretation, parseTutorEvidence, TEACHING_ACTION_TEXT, tutorFactText, type ExchangeCounts, type TutorInterpretation } from './tutorSummaryData'

export interface TutorSummaryProps { current: StudioProject; previous?: StudioProject; snapshotId: string; receivedRevision: number; conversationCounts?: ExchangeCounts }
async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > 8192) throw new Error('Invalid summary response.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0
  try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 8192) { await reader.cancel(); throw new Error('Invalid summary response.') } chunks.push(next.value) } } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

/** Optional, explicit request. Authoritative deterministic observations remain visible in the parent review. */
export function TutorSummary({ current, previous, snapshotId, receivedRevision, conversationCounts }: TutorSummaryProps) {
  const evidence = buildTutorEvidence(current, previous, conversationCounts), evidenceKey = JSON.stringify(evidence)
  const contextKey = `${snapshotId}:${receivedRevision}:${evidenceKey}`
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [state, setState] = useState<{ key: string; pending: boolean; interpretation?: TutorInterpretation; notice?: string } | null>(null)
  const requestRef = useRef<AbortController | null>(null), activeKey = useRef(contextKey)
  useEffect(() => { activeKey.current = contextKey; return () => requestRef.current?.abort() }, [contextKey])
  const currentState = state?.key === contextKey ? state : null
  async function generate() {
    if (previewKey !== contextKey || !parseTutorEvidence(evidence) || currentState?.pending) return
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller
    const key = contextKey, requestId = crypto.randomUUID()
    const timeout = window.setTimeout(() => { controller.abort(); if (activeKey.current === key) setState({ key, pending: false, notice: 'AI request timed out. Use the observed changes above; its quota request may already have been used.' }) }, 30000)
    setState({ key, pending: true })
    try {
      const response = await fetch('/api/mira/creation/tutor-summary', { method: 'POST', signal: controller.signal, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, evidence }) })
      if (!response.ok) throw new Error('unavailable')
      const value = await boundedResponse(response)
      if (!value || typeof value !== 'object' || !('requestId' in value) || value.requestId !== requestId || !('revision' in value) || value.revision !== evidence.revision || !('source' in value) || value.source !== 'ai-selection' || !('interpretation' in value)) throw new Error('unavailable')
      const interpretation = parseTutorInterpretation(value.interpretation, evidence)
      if (!interpretation) throw new Error('unavailable')
      if (!controller.signal.aborted && activeKey.current === key) setState({ key, pending: false, interpretation })
    } catch {
      if (!controller.signal.aborted && activeKey.current === key) setState({ key, pending: false, notice: 'AI review priorities are unavailable. Use the observed changes above; nothing in the composition was changed.' })
    } finally { window.clearTimeout(timeout) }
  }
  return <section className="tp-note" aria-label="Optional AI tutor summary">
    <h3>Optional Mira tutor summary</h3>
    <p>Mira can suggest which recorded changes to discuss. Observed changes above remain the evidence; this does not assess ability, practice time or intent.</p>
    <p>Evidence cutoff: received revision {receivedRevision}, composition revision {current.revision}{previous ? ` compared with composition revision ${previous.revision}` : '; no earlier revision loaded'}.</p>
    {conversationCounts && <p>Conversation counts show their currently recorded status for exchanges attached to this composition revision or earlier; they are not a historical snapshot of response status.</p>}
    {previewKey !== contextKey ? <button type="button" onClick={() => setPreviewKey(contextKey)}>Preview summary input</button> : <>
      <p>Only the following numeric facts and revision numbers will be sent to the configured Groq service. No names, musical notes, recordings or conversation text are included. This uses one request from the shared local demo quota; no paid-provider fallback.</p>
      <ul>{evidence.facts.map(fact => <li key={fact.id} id={`tutor-fact-${fact.id}`}><strong>{fact.id}:</strong> {tutorFactText(fact)}</li>)}</ul>
      <button type="button" disabled={currentState?.pending || !parseTutorEvidence(evidence)} onClick={() => void generate()}>{currentState?.pending ? 'Selecting review priorities…' : 'Generate AI review priorities'}</button>
      <button type="button" disabled={currentState?.pending} onClick={() => setPreviewKey(null)}>Close preview</button>
    </>}
    {currentState?.notice && <p role="status">{currentState.notice}</p>}
    {currentState?.interpretation && <div><h4>AI interpretation · suggested review priorities</h4><ol>{currentState.interpretation.claims.map(claim => {
      const fact = evidence.facts.find(f => f.id === claim.evidenceId)!
      return <li key={claim.evidenceId}><p>{tutorFactText(fact)} <button type="button" onClick={() => { setPreviewKey(contextKey); requestAnimationFrame(() => document.getElementById(`tutor-fact-${fact.id}`)?.scrollIntoView({ block: 'nearest' })) }}>Evidence: {fact.id}</button></p><p>{TEACHING_ACTION_TEXT[claim.action]}</p></li>
    })}</ol><p>The AI selected these priorities. The observations and suggested actions use validated, fixed wording; your musical judgment determines the feedback.</p></div>}
  </section>
}
