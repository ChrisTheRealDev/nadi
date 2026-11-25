import { useEffect, useRef, useState } from 'react'
import type { CreationMiraResponse, CreationWorkspace, HelpAction } from './contracts'
import { authoredResponse, helpSteps, stepCompleted, targetInContext, validateCreationResponse } from './registry'
export interface CreationMiraProps {
  open: boolean; workspace: CreationWorkspace; observedAction: { sequence: number; type: HelpAction } | null
  onClose: () => void
  onRevealTarget?: (target: string) => void
}
export function CreationMira({ open, workspace, observedAction, onClose, onRevealTarget }: CreationMiraProps) {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<CreationMiraResponse | null>(null)
  const [index, setIndex] = useState(0), [different, setDifferent] = useState(false)
  const [online, setOnline] = useState(false), [busy, setBusy] = useState(false)
  const latest = useRef(workspace)
  useEffect(() => { latest.current = workspace }, [workspace])
  const latestAction = useRef(observedAction?.sequence ?? 0)
  useEffect(() => { latestAction.current = observedAction?.sequence ?? 0 }, [observedAction])
  const baseline = useRef(0), generation = useRef(0)
  const revealedStep = useRef('')
  const step = response ? helpSteps[response.selection.stepIds[index]] : undefined
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/mira/creation/status', { signal: controller.signal, credentials: 'same-origin' }).then(r => r.json()).then((v: unknown) => {
      if (v && typeof v === 'object' && 'authorized' in v && v.authorized === true) setOnline(true)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!open || !step?.target || response?.projectId !== workspace.projectId || !targetInContext(step, workspace)) return
    const target = document.querySelector<HTMLElement>(`[data-help-target="${step.target}"]`)
    const revealKey = `${generation.current}:${workspace.projectId}:${index}:${step.target}`
    if (!target || target.getClientRects().length === 0 || target.closest('[hidden]')) {
      if (revealedStep.current !== revealKey) { revealedStep.current = revealKey; onRevealTarget?.(step.target) }
      return
    }
    revealedStep.current = revealKey
    target.classList.add('mira-help-highlight')
    return () => target.classList.remove('mira-help-highlight')
  }, [open, step, index, response?.projectId, workspace, onRevealTarget])
  useEffect(() => {
    if (!open || !step || response?.projectId !== workspace.projectId) return
    if (stepCompleted(step, workspace, observedAction, baseline.current)) { baseline.current = observedAction?.sequence ?? baseline.current; setIndex(n => n + 1); setDifferent(false) }
  }, [open, step, observedAction, workspace, response?.projectId])
  const ask = async () => {
    const request = { version: 1 as const, question: question.trim(), workspace: { ...workspace } }
    if (!request.question) return
    const id = ++generation.current
    const askedAtSequence = observedAction?.sequence ?? 0
    baseline.current = askedAtSequence; setIndex(0); setDifferent(false)
    setResponse(authoredResponse(request)); setBusy(online)
    if (!online) return
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      const result = await fetch('/api/mira/creation', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
      const value: unknown = await result.json()
      // Never attach a delayed response to a different revision or project.
      // Immediate authored help may already have advanced; a delayed AI answer must not rewind it.
      if (generation.current === id && latestAction.current === askedAtSequence && validateCreationResponse(value, latest.current)) { setResponse(value); setIndex(0); baseline.current = askedAtSequence }
    } catch { /* Authored guidance is already available; creation remains independent. */ }
    finally { window.clearTimeout(timeout); if (generation.current === id) setBusy(false) }
  }
  if (!open) return null
  const sameProject = response?.projectId === workspace.projectId
  return <aside className="creation-mira" aria-label="Mira help">
    <header><img className="mira-avatar" src="/assets/mira/mira-encouraging.png" alt="" /><h2>Mira</h2><button onClick={() => { generation.current++; onClose() }}>Close help</button></header>
    <p>Read-only advice. You compose and make every change. I have not listened to your audio.</p>
    <label htmlFor="mira-question">What are you trying to do?</label>
    <textarea id="mira-question" value={question} maxLength={500} onChange={e => setQuestion(e.target.value)} placeholder="For example: how do I change a note?" />
    <button onClick={() => void ask()}>Ask Mira</button>
    <p className="mira-source">{response?.source === 'live' ? 'AI-selected authored instructions' : 'Authored help — not a live AI answer'}{busy ? ' · Checking online help…' : ''}</p>
    {online && <small>Only your question and minimal workspace facts are sent. No recording or full project. Provider abuse-monitoring retention may apply.</small>}
    <div aria-live="polite">
      {response && !sameProject ? <p>Your project changed. Ask again for help with this workspace.</p> : response && !response.selection.topic ? <p>I do not have supported instructions for that request. I can help you start, explain ticks, beats, bars and velocity, or explain sound, chords and recording, deleting, moving, resizing or previewing notes, drums, repetition, mixing, and saving or exporting. I cannot install plugins, import samples or make music for you.</p> : step ? <>
        {step.observes && <p>Let’s work on that, one optional action at a time.</p>}<p>{different ? step.differently : step.idea}</p><p>{step.action}</p>
        {!targetInContext(step, workspace) && <p>That control is not visible in this editor yet. Choose the matching editor or select a note first.</p>}
        <button onClick={() => setDifferent(v => !v)}>Explain differently</button>
        <small>I can explain and highlight controls, but cannot generate, play, edit or apply musical parts for you.</small>
      </> : response ? <p>You’ve tried the supported action. Repeat it when you’re ready, or ask another question. This does not measure understanding.</p> : <p>Try “I don’t know where to start”, “What is a tick?”, or ask about sound, a chord, notes, drums, repeating a bar, volume, or exporting.</p>}
    </div>
  </aside>
}
