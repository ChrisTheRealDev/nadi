import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { TrackingRequestError, type TrackingClient, type TrackingWorkspace } from './client'
import type { PlannerData, PlannerGoal, PlannerKind, PlannerStep } from './connectionTypes'
import { AccountStudioStore, type PendingRevision } from './accountStore'
import { usePlannerDraft } from './plannerDraft'
import { useFeedbackInbox } from './FeedbackInbox'
import { attentionReasons, goalOrder, orderedStepIds, unansweredQuestions, REVIEW_LABELS } from './plannerView'
import './plannerDashboard.css'

type SavedUpdate = { key: string; learnerId: string; kind: PlannerKind; payload: Record<string, unknown>; rejected?: boolean }
type Send = (kind: PlannerKind, payload: Record<string, unknown>) => Promise<boolean>
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value.slice(0, 10)}T12:00:00`))

export default function PlannerDashboard({ client, workspace, selectedLearnerId, onSelectLearner, onChanged }: { client: TrackingClient; workspace: TrackingWorkspace; selectedLearnerId: string | null; onSelectLearner: (id: string) => void; onChanged: () => void }) {
  const inbox = useFeedbackInbox()
  const [attentionOnly, setAttentionOnly] = useState(false)
  const actorId = workspace.profile.id, mentor = workspace.profile.role === 'mentor'
  const ids = (mentor ? workspace.learners.map(item => item.profile.id) : [actorId]).sort().join(',')
  const learnerId = mentor ? selectedLearnerId : actorId
  const [data, setData] = useState<Record<string, PlannerData>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [store] = useState(() => new AccountStudioStore(actorId))
  const [pending, setPending] = useState<SavedUpdate | null>(null)
  const [queueReady, setQueueReady] = useState(false), [queueError, setQueueError] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const sending = useRef(false), reading = useRef(false), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; store.close() } }, [store])
  const loadPending = useCallback(async () => {
    const rows = await store.records<Omit<SavedUpdate, 'key'>>('planner-command:')
    if (live.current) { setPending(rows[0] ? { ...rows[0].value, key: rows[0].key } : null); setQueueReady(true); setQueueError(false) }
  }, [store])
  useEffect(() => { void loadPending().catch(() => { if (live.current) setQueueError(true) }) }, [loadPending])
  const reload = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      await Promise.all(ids.split(',').filter(Boolean).map(async id => {
        try { const next = await client.plannerRead(actorId, id); if (live.current) { setData(old => ({ ...old, [id]: next })); setErrors(old => ({ ...old, [id]: '' })) } }
        catch { if (live.current) setErrors(old => ({ ...old, [id]: 'The planner could not refresh. Showing the last received details, if available.' })) }
      }))
    } finally { reading.current = false }
  }, [actorId, client, ids])
  useEffect(() => { const start = setTimeout(() => void reload(), 0); const timer = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine && !sending.current) void reload() }, 15000); return () => { clearTimeout(start); clearInterval(timer) } }, [reload])
  useEffect(() => { const changed = () => void reload(); window.addEventListener('nadi:planner-changed', changed); return () => window.removeEventListener('nadi:planner-changed', changed) }, [reload])
  const sendSaved = async (saved: SavedUpdate) => {
    const guard = client.sessionGuard(actorId)
    guard()
    await client.plannerCommand(actorId, saved.kind, saved.payload)
    guard()
    // Server confirmation and local cleanup are distinct; a retained exact update is safe to retry.
    let cleanupPending = false
    try { await store.removeRecord(saved.key); guard(); await loadPending() }
    catch { cleanupPending = true }
    guard()
    if (live.current) { setMessage(cleanupPending ? 'Update confirmed by the server. Local receipt cleanup is pending; retry the exact saved update to finish cleanup without creating a duplicate.' : 'Update confirmed. Your planner is refreshing.'); onChanged() }
    await reload()
  }
  const execute = async (saved: SavedUpdate, persist: boolean): Promise<boolean> => {
    if (sending.current) return false
    sending.current = true; setBusy(true); setMessage('')
    try {
      const guard = client.sessionGuard(actorId)
      if (persist) { await store.put(saved.key, { learnerId: saved.learnerId, kind: saved.kind, payload: saved.payload }); guard(); if (live.current) setPending(saved) }
      if (!persist && saved.rejected) {
        saved = { ...saved, rejected: false }
        await store.put(saved.key, { learnerId: saved.learnerId, kind: saved.kind, payload: saved.payload })
        guard(); if (live.current) setPending(saved)
      }
      await sendSaved(saved)
      return true
    } catch (error) {
      const rejected = error instanceof TrackingRequestError && [400, 403, 409, 422].includes(error.status ?? 0)
      if (rejected) { saved = { ...saved, rejected: true }; try { await store.put(saved.key, { learnerId: saved.learnerId, kind: saved.kind, payload: saved.payload, rejected: true }) } catch { /* Keep the original persisted identity. */ } }
      if (live.current) { if (rejected) setPending(saved); setMessage(rejected ? 'This update was rejected. Refresh and review the current assignment before preparing a replacement.' : 'The update is not confirmed here. If saved below, retry that exact update; do not create a second copy. Your draft stays open.') }
      return false
    } finally { sending.current = false; if (live.current) setBusy(false) }
  }
  const send: Send = async (kind, payload) => {
    if (!learnerId || !queueReady || queueError || pending || sending.current) return false
    if (kind === 'review-submit') {
      sending.current = true; setBusy(true)
      try {
        const guard = client.sessionGuard(actorId)
        const fresh = await client.plannerRead(actorId, learnerId); guard()
        const goal = fresh.goals.find(item => item.id === payload.goalId)
        const project = fresh.projects.find(item => item.projectId === goal?.project_id)
        const local = await store.records<PendingRevision>('sync:'); guard()
        if (!project || local.some(row => row.value.project.id === project.projectId)) {
          setMessage('Your composition has unsynchronized changes. Open the studio, wait for Shared with your tutor · synced, then return and refresh before sending for review.')
          return false
        }
        if (project.snapshotId !== payload.snapshotId || goal?.version !== payload.expectedVersion) {
          setData(old => ({ ...old, [learnerId]: fresh })); setMessage('Newer received work is available. Review the displayed revision, then send again. Nothing was submitted.'); return false
        }
      } catch { setMessage('Could not verify the latest saved music. Nothing was submitted; reconnect and retry.'); return false }
      finally { sending.current = false; if (live.current) setBusy(false) }
    }
    const mutationId = crypto.randomUUID()
    return execute({ key: `planner-command:${mutationId}`, learnerId, kind, payload: { ...payload, mutationId } }, true)
  }
  const disabled = busy || !queueReady || queueError || !!pending
  const current = learnerId ? data[learnerId] : undefined
  return <section className="tp-planner" aria-label={mentor ? 'Tutor tracker' : 'Student planner'}>
    <div className="tp-planner-heading"><div><span className="tp-eyebrow">{mentor ? 'Tutor tracker' : 'Your planner'}</span><h2>{mentor ? 'What needs your attention' : 'Next steps'}</h2><p>{mentor ? 'Received work, questions and dates. These signals do not measure effort or ability.' : 'Break your assignment into small steps, link your music and send a saved revision for review.'}</p></div><div className="tp-actions">{mentor && <button type="button" className="tp-primary" onClick={() => document.getElementById('tp-command-panel')?.scrollIntoView({ block: 'start' })}>Create assignment</button>}<button type="button" className="tp-secondary" onClick={() => void reload()} disabled={busy}>Refresh planner</button></div></div>
    {mentor && <><label className="tp-attention-filter"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} /> Show only learners needing attention</label><div className="tp-attention-grid">{workspace.learners.map(learner => {
      const received = data[learner.profile.id]
      const reasons = attentionReasons(received?.goals ?? learner.progress.goals, unansweredQuestions(inbox?.items ?? [], learner.profile.id))
      if (attentionOnly && received && !reasons.length && !errors[learner.profile.id]) return null
      return <button type="button" className="tp-attention-card" aria-pressed={learnerId === learner.profile.id} key={learner.profile.id} onClick={() => onSelectLearner(learner.profile.id)}><strong>{learner.profile.display_name}</strong>{errors[learner.profile.id] ? <span>Refresh unavailable</span> : !received ? <span>Checking received work…</span> : reasons.length ? reasons.map(reason => <span key={reason}>{reason}</span>) : <span>No pending attention signals</span>}<small>{received ? `${received.goals.length} assignments · ${received.projects.length} compositions` : 'Select to view assignments'}</small>{received?.projects.length ? <small>Latest work received {new Date([...received.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].updatedAt).toLocaleString()}</small> : null}</button>
    })}</div></>}
    {queueError && <p role="alert">Saved planner updates could not be read. New updates are paused. <button type="button" onClick={() => void loadPending().catch(() => setQueueError(true))}>Retry local storage</button></p>}
    {pending && <div className="tp-planner-pending" role="status"><strong>{pending.rejected ? 'Saved update rejected' : 'A saved update needs confirmation'}</strong><p>{pending.kind.replaceAll('-', ' ')} · {workspace.learners.find(l => l.profile.id === pending.learnerId)?.profile.display_name || 'Your account'}. Its exact identity is retained across refreshes.</p><button type="button" disabled={busy} onClick={() => void execute(pending, false)}>Retry exact update</button>{pending.rejected && <button type="button" disabled={busy} onClick={() => { if (sending.current) return; sending.current = true; setBusy(true); void store.removeRecord(pending.key).then(loadPending).then(() => { setMessage('Rejected local copy removed. No server data was changed.'); return reload() }).catch(() => setMessage('The saved update could not be removed. Try again.')).finally(() => { sending.current = false; if (live.current) setBusy(false) }) }}>Discard rejected local copy</button>}</div>}
    {message && <p role="status" className="tp-planner-message">{message}</p>}
    {learnerId && errors[learnerId] && <p role="alert">{errors[learnerId]}</p>}
    {!learnerId ? <p>Select a learner to review their assignments or create one below.</p> : !current ? <p role="status">Loading assignments…</p> : <>
      {!current.goals.length && <div className="tp-planner-empty"><h3>{mentor ? 'No assignments yet' : 'Your assignments will appear here'}</h3><p>{mentor ? 'Create a new assignment below for this learner.' : 'Your tutor can assign a goal and deadline. You can keep composing while you wait.'}</p></div>}
      <div className="tp-goal-grid">{goalOrder(current.goals).map(goal => <PlannerGoalCard key={`${learnerId}:${goal.id}`} goal={goal} data={current} mentor={mentor} disabled={disabled || (!mentor && !workspace.disclosureAccepted)} send={send} />)}</div>
    </>}
  </section>
}

function StepRow({ step, goal, index, count, disabled, send }: { step: PlannerStep; goal: PlannerGoal; index: number; count: number; disabled: boolean; send: Send }) {
  const [editing, setEditing] = useState(false)
  const draft = usePlannerDraft(`${goal.learner_id}:${goal.id}:step:${step.id}`, { label: step.label, version: step.version })
  const { label, version } = draft.value
  return <li className="tp-planner-step"><label><input type="checkbox" checked={step.done} disabled={disabled} onChange={event => void send('step-toggle', { stepId: step.id, expectedVersion: step.version, done: event.target.checked })} /><span className={step.done ? 'is-done' : ''}>{step.label}</span></label><div className="tp-planner-step-actions"><button type="button" aria-label={`Move ${step.label} earlier`} disabled={disabled || index === 0} onClick={() => void send('step-reorder', { goalId: goal.id, expectedVersion: goal.version, stepIds: orderedStepIds(goal.steps, step.id, -1) })}>↑</button><button type="button" aria-label={`Move ${step.label} later`} disabled={disabled || index === count - 1} onClick={() => void send('step-reorder', { goalId: goal.id, expectedVersion: goal.version, stepIds: orderedStepIds(goal.steps, step.id, 1) })}>↓</button><button type="button" disabled={disabled} onClick={() => { if (!draft.saved) draft.clear({ label: step.label, version: step.version }); setEditing(true) }}>Edit</button></div>{editing && <form className="tp-planner-inline" onSubmit={event => { event.preventDefault(); void send('step-edit', { stepId: step.id, expectedVersion: version, label: label.trim() }).then(ok => { if (ok) { draft.clear({ label: label.trim(), version: version + 1 }); setEditing(false) } }) }}>{draft.failed && <p role="alert">Draft storage unavailable. Keep this page open.</p>}<label>Step text<input value={label} onChange={event => draft.set({ ...draft.value, label: event.target.value })} required maxLength={300} disabled={disabled} /></label><button type="submit" disabled={disabled || !label.trim()}>Save step</button><button type="button" disabled={disabled} onClick={() => setEditing(false)}>Cancel</button></form>}</li>
}

function GoalEditor({ goal, disabled, send, close }: { goal: PlannerGoal; disabled: boolean; send: Send; close: () => void }) {
  const draft = usePlannerDraft(`${goal.mentor_id}:${goal.id}:assignment`, { title: goal.title, description: goal.description, due: goal.due_date || '', version: goal.version })
  const { title, description, due, version } = draft.value
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const submittedDue = String(new FormData(event.currentTarget).get('dueDate') ?? ''); void send('goal-edit', { goalId: goal.id, expectedVersion: version, title: title.trim(), description: description.trim(), dueDate: submittedDue || null }).then(ok => { if (ok) { draft.clear(); close() } }) }
  return <form className="tp-planner-form" onSubmit={submit}>{draft.failed && <p role="alert">Draft storage unavailable. Keep this page open.</p>}<label>Assignment title<input required maxLength={160} value={title} onChange={e => draft.set({ ...draft.value, title: e.target.value })} disabled={disabled} /></label><label>What to work on<textarea rows={3} maxLength={2000} value={description} onChange={e => draft.set({ ...draft.value, description: e.target.value })} disabled={disabled} /></label><label>Due date<input name="dueDate" type="date" value={due} onChange={e => draft.set({ ...draft.value, due: e.target.value })} disabled={disabled} /></label><div className="tp-actions"><button type="submit" disabled={disabled || !title.trim()}>Save assignment</button><button type="button" disabled={disabled} onClick={close}>Cancel</button></div></form>
}

function PlannerGoalCard({ goal, data, mentor, disabled, send }: { goal: PlannerGoal; data: PlannerData; mentor: boolean; disabled: boolean; send: Send }) {
  const [editing, setEditing] = useState(false)
  const stepDraft = usePlannerDraft<string>(`${goal.learner_id}:${goal.id}:new-step`, '')
  const reviewDraft = usePlannerDraft<string>(`${goal.learner_id}:${goal.id}:reflection`, '')
  const step = stepDraft.value, reflection = reviewDraft.value
  const project = data.projects.find(item => item.projectId === goal.project_id)
  const steps = [...goal.steps].sort((a, b) => a.position - b.position), done = steps.filter(item => item.done).length
  return <article className="tp-planner-goal">
    {(stepDraft.failed || reviewDraft.failed) && <p role="alert">Draft storage unavailable. Keep this page open until your update is confirmed.</p>}<header><div><h3>{goal.title}</h3><p>{goal.due_date ? `Due ${date(goal.due_date)}` : 'No deadline set'}</p></div>{mentor && <button type="button" disabled={disabled} onClick={() => setEditing(!editing)}>{editing ? 'Close edit' : 'Edit assignment'}</button>}</header>
    {editing ? <GoalEditor goal={goal} disabled={disabled} send={send} close={() => setEditing(false)} /> : <p className="tp-goal-description">{goal.description || 'No additional instructions.'}</p>}
    <div className="tp-goal-statuses"><span>Student progress: <b>{goal.status === 'student-complete' ? 'Reported complete' : goal.status === 'in-progress' ? 'In progress' : 'Not started'}</b></span><span>Tutor review: <b>{goal.review ? REVIEW_LABELS[goal.review.status] : 'Not submitted'}</b></span></div>
    <div className="tp-step-heading"><h4>{mentor ? 'Student’s next steps' : 'My next steps'}</h4><span>{done} / {steps.length} checked</span></div>{steps.length > 0 && <progress aria-label={`${goal.title}: checklist progress`} value={done} max={steps.length} />}
    {mentor ? <ul className="tp-readonly-steps">{steps.map(item => <li key={item.id}><span aria-hidden="true">{item.done ? '✓' : '○'}</span> {item.label}<small>{item.done ? 'Student checked' : 'Open'}</small></li>)}</ul> : <ul className="tp-planner-steps">{steps.map((item, index) => <StepRow key={item.id} step={item} goal={goal} index={index} count={steps.length} disabled={disabled} send={send} />)}</ul>}
    {!steps.length && <p className="tp-subtle">{mentor ? 'The learner has not added steps yet.' : 'Add a small action you can work on next, such as “try a four-bar melody”.'}</p>}
    {!mentor && <form className="tp-planner-inline" onSubmit={event => { event.preventDefault(); void send('step-add', { goalId: goal.id, expectedVersion: goal.version, label: step.trim() }).then(ok => { if (ok) stepDraft.clear() }) }}><label>New step<input value={step} onChange={e => stepDraft.set(e.target.value)} maxLength={300} required disabled={disabled} placeholder="What will you work on next?" /></label><button type="submit" disabled={disabled || !step.trim()}>Add step</button></form>}
    <div className="tp-planner-link"><h4>Linked composition</h4>{mentor ? <p>{project ? `${project.name} · received revision ${project.revision}` : 'No composition linked yet.'}</p> : <label>Choose your saved account composition<select value={goal.project_id || ''} disabled={disabled} onChange={e => void send('project-link', { goalId: goal.id, expectedVersion: goal.version, projectId: e.target.value || null })}><option value="">No composition linked</option>{data.projects.map(item => <option key={item.projectId} value={item.projectId}>{item.name} · received revision {item.revision}</option>)}</select></label>}
      {!mentor && <a className="tp-secondary" href="#create">Open music studio</a>}<p className="tp-subtle">{project ? 'The compositions section below lets you listen and view the received score.' : 'Save in your account studio and wait for synchronization; then refresh the planner to link it.'}</p>
    </div>
    {!mentor && <form className="tp-planner-form tp-submit-review" onSubmit={event => { event.preventDefault(); if (project?.snapshotId) void send('review-submit', { goalId: goal.id, expectedVersion: goal.version, snapshotId: project.snapshotId, reflection: reflection.trim() }).then(ok => { if (ok) reviewDraft.clear() }) }}><label>Reflection for your tutor<textarea rows={2} maxLength={2000} value={reflection} onChange={e => reviewDraft.set(e.target.value)} disabled={disabled} placeholder="What changed? What would you like feedback on?" /></label><p>{project?.snapshotId ? `This sends received revision ${project.revision} of “${project.name}”. NADI checks for unsynchronized edits before sending.` : 'Link a synchronized composition before sending it for review.'}</p><button type="submit" className="tp-primary" disabled={disabled || !project?.snapshotId || goal.review?.status === 'awaiting-review'}>Send for review</button><small>Sending for review does not mark your assignment complete.</small></form>}
    {goal.review && <div className="tp-review-request"><h4>Latest review request · revision {goal.review.revision}</h4><p>{goal.review.reflection || 'No reflection supplied.'}</p><small>Received {new Date(goal.review.created_at).toLocaleString()}</small>{mentor && <div className="tp-actions"><button type="button" disabled={disabled || goal.review.status === 'changes-requested'} onClick={() => void send('review-status', { reviewId: goal.review!.id, expectedVersion: goal.review!.version, status: 'changes-requested' })}>Request changes</button><button type="button" disabled={disabled || goal.review.status === 'reviewed'} onClick={() => void send('review-status', { reviewId: goal.review!.id, expectedVersion: goal.review!.version, status: 'reviewed' })}>Mark reviewed</button></div>}{mentor && <p className="tp-subtle">Leave specific guidance in the composition feedback below. Review status is separate from student-reported completion.</p>}</div>}
    {goal.reviews.length > 0 && <details className="tp-review-history"><summary>Progress history · {goal.reviews.length} review {goal.reviews.length === 1 ? 'request' : 'requests'}</summary><ol>{[...goal.reviews].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(review => <li key={review.id}><strong>Revision {review.revision} · {REVIEW_LABELS[review.status]}</strong><small>{new Date(review.created_at).toLocaleString()}</small><p>{review.reflection || 'No reflection supplied.'}</p></li>)}</ol></details>}
  </article>
}
