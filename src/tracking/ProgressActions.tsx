import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { TrackingRequestError, type TrackingClient, type TrackingWorkspace } from './client'
import type { TrackingCommand } from './commands'
import { PendingCommands, type PendingCommand } from './submissions'

interface Props {
  client: TrackingClient
  workspace: TrackingWorkspace
  selectedLearnerId: string | null
  onChanged: () => void
  defaultExpanded?: boolean
}

type Message = { tone: 'success' | 'warning' | 'error'; text: string }

const commandNames: Record<TrackingCommand['kind'], string> = {
  'goal-create': 'Create goal',
  'goal-status': 'Update goal status',
  'help-create': 'Ask for help',
  'help-resolve': 'Resolve help request',
  disclosure: 'Accept progress disclosure',
}

function uuid(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('A secure browser context is needed to prepare an update. Nothing was sent.')
  return globalThis.crypto.randomUUID()
}

function rejectionMessage(error: unknown): string | null {
  if (!(error instanceof TrackingRequestError)) return null
  if (error.status === 409) return 'The server rejected this version conflict. Refresh and review the goal. The frozen update was not changed or retried automatically.'
  if (error.status === 403) return 'The server refused this account’s update. Nothing was accepted. Review the assignment or account before preparing a replacement.'
  if (error.status === 400) return 'The server rejected this update’s details. Nothing was accepted. Review the frozen fields before preparing a replacement.'
  return null
}

function readActionDraft(actorId: string, field: string): string {
  try { const saved: unknown = JSON.parse(localStorage.getItem(`nadi.progress-action-draft.v1:${actorId}`) || '{}'); if (saved && typeof saved === 'object' && typeof (saved as Record<string, unknown>)[field] === 'string') return (saved as Record<string, string>)[field] } catch { /* Preserve the live form when storage is unavailable. */ }
  return ''
}

export default function ProgressActions({ client, workspace, selectedLearnerId, onChanged, defaultExpanded = false }: Props) {
  const actorId = workspace.profile.id
  const queue = useMemo(() => new PendingCommands(actorId), [actorId])
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [pending, setPending] = useState<PendingCommand[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [title, setTitle] = useState(() => readActionDraft(actorId, 'title'))
  const [description, setDescription] = useState(() => readActionDraft(actorId, 'description'))
  const [dueDate, setDueDate] = useState(() => readActionDraft(actorId, 'dueDate'))
  const [draftLearnerId, setDraftLearnerId] = useState<string | null>(() => readActionDraft(actorId, 'draftLearnerId') || null)
  const [goalId, setGoalId] = useState('')
  const [helpMessage, setHelpMessage] = useState(() => readActionDraft(actorId, 'helpMessage'))
  const [helpDraftGoalId, setHelpDraftGoalId] = useState<string | null>(() => readActionDraft(actorId, 'helpDraftGoalId') || null)
  const [disclosureChecked, setDisclosureChecked] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(`nadi.progress-action-draft.v1:${actorId}`, JSON.stringify({ title, description, dueDate, draftLearnerId, helpMessage, helpDraftGoalId })) } catch { /* Keep the live form; pending sends still require durable command storage. */ }
  }, [actorId, title, description, dueDate, draftLearnerId, helpMessage, helpDraftGoalId])

  const mentor = workspace.profile.role === 'mentor'
  const selectedLearner = mentor ? workspace.learners.find((learner) => learner.profile.id === selectedLearnerId) : undefined
  const ownProgress = !mentor ? workspace.learners.find((learner) => learner.profile.id === actorId)?.progress : undefined
  const selectedGoal = ownProgress?.goals.find((goal) => goal.id === goalId)
  const openHelp = selectedLearner?.progress.helpRequests.filter((request) => !request.resolved_at) ?? []
  const unresolved = pending.filter((item) => item.actorId === actorId)
  const canStartNew = !busy && !queueLoading && !queueError && unresolved.length === 0
  const goalDraftMismatch = !!selectedLearner && !!draftLearnerId && draftLearnerId !== selectedLearner.profile.id
  const helpDraftMismatch = !!helpDraftGoalId && helpDraftGoalId !== goalId

  useEffect(() => {
    let active = true
    void queue.list().then((items) => {
      if (!active) return
      setPending(items.filter((item) => item.actorId === actorId))
      setQueueError(false)
      setQueueLoading(false)
    }).catch(() => {
      if (active) { setQueueLoading(false); setQueueError(true); setMessage({ tone: 'error', text: 'Pending updates could not be read. New updates are paused so recovery is not lost.' }) }
    })
    return () => { active = false }
  }, [queue, actorId])

  const reloadPending = async () => {
    const items = await queue.list()
    setPending(items.filter((item) => item.actorId === actorId))
    setQueueError(false)
  }

  const retryLocalStorage = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setQueueLoading(true)
    setMessage(null)
    try {
      await reloadPending()
      setMessage({ tone: 'success', text: 'Pending storage is readable again. No update was sent.' })
    } catch {
      setQueueError(true)
      setMessage({ tone: 'error', text: 'Pending storage is still unavailable. No update was sent; keep this page open and try again.' })
    } finally {
      setQueueLoading(false)
      busyRef.current = false
      setBusy(false)
    }
  }

  const clearConfirmedDraft = (command: TrackingCommand) => {
    if (command.kind === 'goal-create') { setTitle(''); setDescription(''); setDueDate(''); setDraftLearnerId(null) }
    if (command.kind === 'help-create') { setHelpMessage(''); setHelpDraftGoalId(null) }
    if (command.kind === 'disclosure') setDisclosureChecked(false)
  }

  const confirmed = (command: TrackingCommand, localCleanupPending = false) => {
    clearConfirmedDraft(command)
    setMessage(localCleanupPending
      ? { tone: 'warning', text: `${commandNames[command.kind]} was confirmed by the server, but its local pending copy could not be cleared. Checking or retrying that exact update is safe and will not duplicate it.` }
      : { tone: 'success', text: `${commandNames[command.kind]} was confirmed by the server. Refreshing the workspace now.` })
    onChanged()
    window.dispatchEvent(new Event('nadi:planner-changed'))
  }

  const submit = async (command: TrackingCommand) => {
    if (busyRef.current || !canStartNew) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    let prepared: PendingCommand | null = null
    try {
      prepared = await queue.prepare(command)
      await reloadPending()
      const result = await queue.send(prepared.id, client)
      let localCleanupPending = !!result.localCleanupPending
      try { await reloadPending() } catch { setQueueError(true); localCleanupPending = true }
      confirmed(command, localCleanupPending)
    } catch (error) {
      try { await reloadPending() } catch { setQueueError(true) }
      setMessage(prepared
        ? { tone: 'warning', text: rejectionMessage(error)
          ?? 'The result is not confirmed here. Your exact update remains pending. Check its status before retrying; do not submit a new copy.' }
        : { tone: 'error', text: 'The update could not be saved safely in this browser. Nothing was sent.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const revisit = async (item: PendingCommand, action: 'check' | 'retry') => {
    if (busyRef.current || item.actorId !== actorId) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      if (action === 'check') {
        const status = await queue.check(item.id, client)
        let localCleanupPending = !!status.result?.localCleanupPending
        try { await reloadPending() } catch { setQueueError(true); localCleanupPending = true }
        if (status.found && status.result) confirmed(item.command, localCleanupPending)
        else setMessage({ tone: 'warning', text: 'No confirmed result was found. The exact update remains pending; retry it only when you are ready.' })
      } else {
        const result = await queue.send(item.id, client)
        let localCleanupPending = !!result.localCleanupPending
        try { await reloadPending() } catch { setQueueError(true); localCleanupPending = true }
        confirmed(item.command, localCleanupPending)
      }
    } catch (error) {
      try { await reloadPending() } catch { setQueueError(true) }
      setMessage({ tone: 'warning', text: action === 'retry' && rejectionMessage(error)
        ? rejectionMessage(error)!
        : 'The result is still uncertain. The original update remains pending; check its status again when connected.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const removeRejected = async (item: PendingCommand) => {
    if (busyRef.current || item.actorId !== actorId || !item.rejection) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      await queue.discardRejected(item.id)
      await reloadPending()
      setMessage({ tone: 'warning', text: 'The rejected update was removed from this browser only. That did not undo any server change. Review current progress before preparing a revised update.' })
    } catch {
      try { await reloadPending() } catch { setQueueError(true) }
      setMessage({ tone: 'error', text: 'The rejected local update could not be removed. It remains in the pending tray.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const createGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedLearner || !title.trim() || goalDraftMismatch) return
    try {
      const submittedDueDate = String(new FormData(event.currentTarget).get('dueDate') ?? '')
      const command: TrackingCommand = { kind: 'goal-create', payload: { submissionId: uuid(), learnerId: selectedLearner.profile.id, title: title.trim(), description: description.trim(), ...(submittedDueDate ? { dueDate: submittedDueDate } : {}) } }
      void submit(command)
    } catch { setMessage({ tone: 'error', text: 'A secure browser context is needed to prepare an update. Nothing was sent.' }) }
  }

  const sendStatus = (status: 'in-progress' | 'student-complete') => {
    if (!selectedGoal || !workspace.disclosureAccepted) return
    try { void submit({ kind: 'goal-status', payload: { submissionId: uuid(), goalId: selectedGoal.id, expectedVersion: selectedGoal.version, status } }) }
    catch { setMessage({ tone: 'error', text: 'A secure browser context is needed to prepare an update. Nothing was sent.' }) }
  }

  const askHelp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedGoal || !helpMessage.trim() || !workspace.disclosureAccepted || helpDraftMismatch) return
    try { void submit({ kind: 'help-create', payload: { submissionId: uuid(), goalId: selectedGoal.id, message: helpMessage.trim() } }) }
    catch { setMessage({ tone: 'error', text: 'A secure browser context is needed to prepare an update. Nothing was sent.' }) }
  }

  const resolveHelp = (requestId: string) => {
    try { void submit({ kind: 'help-resolve', payload: { submissionId: uuid(), requestId } }) }
    catch { setMessage({ tone: 'error', text: 'A secure browser context is needed to prepare an update. Nothing was sent.' }) }
  }

  return <section id="tp-command-panel" className="tp-surface tp-command-panel" aria-label="Progress actions">
    <div className="tp-command-heading">
      <div><span className="tp-eyebrow">Shared progress</span><h2>{mentor ? 'Create an assignment' : 'Questions & progress'}</h2><p>Updates are sent only when you choose an action and the server confirms it.</p></div>
      <button type="button" className="tp-secondary" aria-expanded={expanded} aria-controls="tp-command-content" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide actions' : 'Show actions'}</button>
    </div>

    {unresolved.length > 0 && <div className="tp-pending-tray" role="status"><h3>{unresolved.length} saved update{unresolved.length === 1 ? '' : 's'} need attention</h3><p>Uncertain updates keep their exact identity for Check status or Retry. Known rejected updates can be reviewed and removed locally before drafting a replacement.</p><div className="tp-pending-list">{unresolved.map((item) => <div className="tp-pending-row" key={item.id}><div className="tp-pending-description"><strong>{commandNames[item.command.kind]}{item.rejection ? ` · Rejected: ${item.rejection}` : ' · Outcome unconfirmed'}</strong><small>Prepared {new Date(item.createdAt).toLocaleString()} · {item.id.slice(0, 8)}…</small><details className="tp-frozen-fields"><summary>View saved update fields</summary>{item.command.kind === 'goal-create' ? <><p><b>Learner ID:</b> {item.command.payload.learnerId}</p><p><b>Title:</b> {item.command.payload.title}</p><p><b>Description:</b> {item.command.payload.description || 'None'}</p><p><b>Due:</b> {item.command.payload.dueDate || 'None'}</p></> : item.command.kind === 'goal-status' ? <><p><b>Goal ID:</b> {item.command.payload.goalId}</p><p><b>Requested status:</b> {item.command.payload.status}</p><p><b>Expected version:</b> {item.command.payload.expectedVersion}</p></> : item.command.kind === 'help-create' ? <><p><b>Goal ID:</b> {item.command.payload.goalId}</p><p><b>Message:</b> {item.command.payload.message}</p></> : item.command.kind === 'help-resolve' ? <p><b>Request ID:</b> {item.command.payload.requestId}</p> : <p>Progress-sharing disclosure, version 1.</p>}</details></div><div className="tp-pending-buttons">{item.rejection ? <><button type="button" className="tp-secondary" disabled={busy} onClick={() => void revisit(item, 'check')}>Check status</button><button type="button" className="tp-secondary tp-remove-rejected" disabled={busy} onClick={() => void removeRejected(item)}>Remove rejected local update</button></> : <><button type="button" className="tp-secondary" disabled={busy} onClick={() => void revisit(item, 'check')}>Check status</button><button type="button" className="tp-secondary" disabled={busy} onClick={() => void revisit(item, 'retry')}>Retry exact update</button></>}</div>{item.rejection && <small className="tp-rejection-note">Removal affects this browser’s pending copy only; it does not undo a server change.</small>}</div>)}</div></div>}
    {queueError && <div className="tp-command-storage-error" role="alert"><p className="tp-command-alert error">Pending storage could not be read. Do not send another update until it is available.</p><button type="button" className="tp-secondary" disabled={busy} onClick={() => void retryLocalStorage()}>Retry local storage</button></div>}
    {message && <p className={`tp-command-alert ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

    {expanded && <div id="tp-command-content" className="tp-command-content">
      {mentor ? <>
        <div className="tp-command-intro"><h3>For your learner</h3><p>Select an assigned learner above. Goal creation and help resolution require a confirmed server response.</p></div>
        {!selectedLearner ? <p className="tp-muted">Choose a learner to see available actions.</p> : <div className="tp-command-columns">
          <form className="tp-command-form" onSubmit={createGoal}><h3>New assignment</h3><p>Only the goal and its description are sent. This does not access the learner’s music.</p><label htmlFor="tp-goal-title">Assignment title</label><input id="tp-goal-title" value={title} onChange={(event) => { setTitle(event.target.value); setDraftLearnerId((previous) => previous ?? selectedLearner.profile.id) }} required maxLength={160} disabled={!canStartNew || goalDraftMismatch} /><label htmlFor="tp-goal-description">Description</label><textarea id="tp-goal-description" value={description} onChange={(event) => { setDescription(event.target.value); setDraftLearnerId((previous) => previous ?? selectedLearner.profile.id) }} maxLength={2000} rows={3} disabled={!canStartNew || goalDraftMismatch} /><label htmlFor="tp-goal-due">Due date <span className="tp-muted">(optional)</span></label><input id="tp-goal-due" name="dueDate" type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); setDraftLearnerId((previous) => previous ?? selectedLearner.profile.id) }} disabled={!canStartNew || goalDraftMismatch} />{goalDraftMismatch && <p className="tp-command-alert warning">This draft began for another learner. Return to that learner or clear it before assigning.</p>}<div className="tp-command-inline"><button type="submit" className="tp-primary" disabled={!canStartNew || !title.trim() || goalDraftMismatch}>{busy ? 'Sending…' : `Assign to ${selectedLearner.profile.display_name}`}</button>{goalDraftMismatch && <button type="button" className="tp-secondary" onClick={() => { setTitle(''); setDescription(''); setDueDate(''); setDraftLearnerId(null) }}>Clear draft</button>}</div></form>
          <div className="tp-command-form"><h3>Help requests</h3>{openHelp.length === 0 ? <p className="tp-muted">No open help requests received for this learner.</p> : openHelp.map((request) => <div className="tp-help-action" key={request.id}><p>{request.message}</p><small>Received {new Date(request.created_at).toLocaleDateString()}</small><button type="button" className="tp-secondary" disabled={!canStartNew} onClick={() => resolveHelp(request.id)}>Mark resolved</button></div>)}<p className="tp-subtle">Resolving a request is a status update, not written feedback.</p></div>
        </div>}
      </> : <>
        {!workspace.disclosureAccepted && <div className="tp-disclosure-form"><h3>Before progress updates</h3><p>After you accept, your assigned tutor may receive goal and lesson milestone summaries, status changes and help requests. Music sharing has a separate enrollment above: once enabled, all account projects, finalized captures and Mira conversations synchronize automatically. Anonymous device projects require explicit import.</p><label><input type="checkbox" checked={disclosureChecked} onChange={(event) => setDisclosureChecked(event.target.checked)} disabled={!canStartNew} /> I understand these progress-sharing rules.</label><button type="button" className="tp-primary" disabled={!canStartNew || !disclosureChecked} onClick={() => void submit({ kind: 'disclosure', payload: { version: 1 } })}>Accept disclosure</button></div>}
        <div className="tp-command-intro"><h3>Stay in touch with your tutor</h3><p>Choose your lesson, update its progress, or send a question. Your enrolled account compositions synchronize automatically; review the saved music and reply to tutor comments below.</p></div>
        {!ownProgress || ownProgress.goals.length === 0 ? <p className="tp-muted">No assigned goal is available for an update yet.</p> : <div className="tp-command-columns">
          <div className="tp-command-form"><label htmlFor="tp-goal-select">Choose a goal</label><select id="tp-goal-select" value={goalId} onChange={(event) => setGoalId(event.target.value)}><option value="">Select a goal…</option>{ownProgress.goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select>{selectedGoal && <p className="tp-subtle">Current status: {selectedGoal.status.replaceAll('-', ' ')}. This is the latest received version.</p>}<div className="tp-status-buttons"><button type="button" className="tp-secondary" disabled={!canStartNew || !workspace.disclosureAccepted || !selectedGoal || selectedGoal.status !== 'not-started'} onClick={() => sendStatus('in-progress')}>I’m starting</button><button type="button" className="tp-secondary" disabled={!canStartNew || !workspace.disclosureAccepted || !selectedGoal || selectedGoal.status === 'student-complete'} onClick={() => sendStatus('student-complete')}>Report complete</button></div><p className="tp-subtle">Completion is student-reported, not a mentor assessment.</p></div>
          <form className="tp-command-form" onSubmit={askHelp}><h3>Ask your tutor</h3><label htmlFor="tp-help-message">Short message for your mentor</label><textarea id="tp-help-message" value={helpMessage} onChange={(event) => { setHelpMessage(event.target.value); setHelpDraftGoalId((previous) => previous ?? goalId) }} maxLength={2000} rows={4} placeholder="Which part or bar are you working on? What have you tried, and what would you like help with?" required disabled={!canStartNew || !workspace.disclosureAccepted || !selectedGoal || helpDraftMismatch} />{helpDraftMismatch && <p className="tp-command-alert warning">This message began for another goal. Select that goal or clear the message.</p>}<div className="tp-command-inline"><button type="submit" className="tp-primary" disabled={!canStartNew || !workspace.disclosureAccepted || !selectedGoal || !helpMessage.trim() || helpDraftMismatch}>Send question</button>{helpDraftMismatch && <button type="button" className="tp-secondary" onClick={() => { setHelpMessage(''); setHelpDraftGoalId(null) }}>Clear message</button>}</div><p className="tp-subtle">This sends only your message and selected goal, not your draft or recordings.</p></form>
        </div>}
      </>}
    </div>}
    {!mentor && !!ownProgress?.helpRequests.length && <div className="tp-sent-questions"><h3>Your sent questions</h3>{[...ownProgress.helpRequests].reverse().map(request => <article className="tp-note" key={request.id}><small>{request.resolved_at ? 'Resolved' : 'Received · awaiting tutor review'} · {new Date(request.created_at).toLocaleDateString()}</small><p>{request.message}</p></article>)}</div>}
  </section>
}
