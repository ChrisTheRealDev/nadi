import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type TrackingClient } from './client'
import { parseSharedWork, type SharedWork } from './sharedReviewData'
import { loadReviewRevision, latestReviewRevision } from './reviewSelection'
import { confirmReviewUpdate } from './confirmReviewUpdate'
import { type StudioProject } from '../creation/v4/model'
import { SheetMusic } from '../creation/v4/SheetMusicDialog'
import { StudioAudio } from '../creation/v4/audio'
import { AccountStudioStore } from './accountStore'
import { TutorSummary } from './TutorSummary'
import { CompositionPreview } from './CompositionPreview'
import { analyzePlayability } from '../creation/v4/playability'
import { useFeedbackInbox } from './FeedbackInbox'
import { isReviewAcknowledgement } from './reviewAcknowledgement'

type ReviewProps = { client: TrackingClient; actorId: string; learnerId: string; mentor: boolean }
export default function SharedReview(props: ReviewProps) { return <SharedReviewSession key={`${props.actorId}:${props.learnerId}`} {...props} /> }
function SharedReviewSession({ client, actorId, learnerId, mentor }: ReviewProps) {
  const inbox = useFeedbackInbox(), target = inbox?.target
  const handledTarget = useRef<typeof target>(undefined)
  const sending = useRef(false)
  const [confirmation, setConfirmation] = useState(''), [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [work, setWork] = useState<SharedWork | null>(null), [projectId, setProjectId] = useState(''), [snapshotId, setSnapshotId] = useState('')
  const [music, setMusic] = useState<StudioProject | null>(null), [summary, setSummary] = useState<string[]>([]), [error, setError] = useState('')
  const [previousMusic, setPreviousMusic] = useState<StudioProject | undefined>(undefined)
  const playability = useMemo(() => music ? analyzePlayability(music) : null, [music])
  const [message, setMessage] = useState(''), [part, setPart] = useState(''), [measures, setMeasures] = useState(''), [score, setScore] = useState(false), [busy, setBusy] = useState(false)
  const [scoreTrack, setScoreTrack] = useState('')
  const [loadingRevision, setLoadingRevision] = useState(false), [comparisonWarning, setComparisonWarning] = useState('')
  const drafts = useRef(new Map<string, { message: string; part: string; measures: string }>())
  function saveDraft() { if (snapshotId) { const value = { message, part, measures }; drafts.current.set(`${projectId}:${snapshotId}`, value); void commandStore.put(`review-draft:${learnerId}:${projectId}:${snapshotId}`, value).catch(() => setError('Draft could not be saved. Keep this page open.')) } }
  function restoreDraft(project: string, snapshot: string) {
    const draft = drafts.current.get(`${project}:${snapshot}`)
    setMessage(draft?.message ?? ''); setPart(draft?.part ?? ''); setMeasures(draft?.measures ?? '')
  }
  const [audio] = useState(() => new StudioAudio()), generation = useRef(0)
  const latestWork = useRef<SharedWork | null>(null)
  const [commandStore] = useState(() => new AccountStudioStore(actorId))
  const [pendingCommand, setPendingCommand] = useState<{ key: string; kind: string; payload: Record<string, unknown> } | null>(null)
  const [queueReady, setQueueReady] = useState(false), [queueError, setQueueError] = useState(false), [queueAttempt, setQueueAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void Promise.all([commandStore.records<{ kind: string; payload: Record<string, unknown> }>('review-command:'), commandStore.records<{ message: string; part: string; measures: string }>(`review-draft:${learnerId}:`), commandStore.records<string>(`review-reply:${learnerId}:`)]).then(([rows, savedDrafts, replies]) => {
      if (!active) return
      for (const row of savedDrafts) drafts.current.set(row.key.slice(`review-draft:${learnerId}:`.length), row.value)
      setReplyDrafts(Object.fromEntries(replies.map(row => [row.key.slice(`review-reply:${learnerId}:`.length), row.value])))
      setPendingCommand(rows[0] ? { key: rows[0].key, ...rows[0].value } : null); setQueueReady(true); setQueueError(false)
    }).catch(() => { if (active) setQueueError(true) })
    return () => { active = false }
  }, [commandStore, learnerId, queueAttempt])
  useEffect(() => {
    if (!queueReady || !snapshotId) return
    const value = { message, part, measures }; drafts.current.set(`${projectId}:${snapshotId}`, value)
    void commandStore.put(`review-draft:${learnerId}:${projectId}:${snapshotId}`, value).catch(() => setError('Draft could not be saved. Keep this page open.'))
  }, [queueReady, snapshotId, projectId, message, part, measures, commandStore, learnerId])
  useEffect(() => () => commandStore.close(), [commandStore])
  const reload = useCallback(async () => {
    const g = generation.current
    try {
      const heads = parseSharedWork(await client.sharedRead(actorId, learnerId))
      const result = projectId ? parseSharedWork(await client.sharedRead(actorId, learnerId, projectId)) : heads
      if (g === generation.current) { latestWork.current = result; setWork(result) }
    }
    catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : 'Review unavailable.') }
  }, [client, actorId, learnerId, projectId])
  useEffect(() => {
    generation.current++
    const first = setTimeout(() => void reload(), 0)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 5000)
    return () => {
      // This counter intentionally invalidates every outstanding request; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      clearTimeout(first); clearInterval(poll)
    }
  }, [reload])
  useEffect(() => () => audio.dispose(), [audio])
  async function selectSnapshot(id: string) {
    const revision = work?.revisions.find(r => r.id === id); if (!revision) return
    saveDraft(); restoreDraft(projectId, id)
    const g = ++generation.current; setSnapshotId(id); setMusic(null); setPreviousMusic(undefined); setSummary([]); setComparisonWarning(''); setError(''); setScore(false); setScoreTrack(''); audio.stop(); setLoadingRevision(true)
    try {
      const result = await loadReviewRevision(revision, work?.revisions ?? [], client, actorId, learnerId)
      if (g === generation.current) { setMusic(result.current); setPreviousMusic(result.previous); setSummary(result.summary); setComparisonWarning(result.warning); setError('') }
    } catch (e) { if (g === generation.current) setError(e instanceof Error ? e.message : 'Revision unavailable.') }
    finally { if (g === generation.current) setLoadingRevision(false) }
  }
  function selectProject(id: string) {
    saveDraft(); restoreDraft(id, '')
    generation.current++; latestWork.current = null; audio.stop(); setProjectId(id); setSnapshotId(''); setMusic(null); setPreviousMusic(undefined); setSummary([]); setWork(null); setLoadingRevision(false); setComparisonWarning(''); setError(''); setScore(false); setScoreTrack('')
  }
  useEffect(() => {
    if (!target || handledTarget.current === target || target.learnerId !== learnerId || !target.projectId || busy || !queueReady) return
    const timer = setTimeout(() => {
      if (projectId !== target.projectId) selectProject(target.projectId!)
      else if (target.snapshotId && snapshotId !== target.snapshotId && work?.revisions.some(revision => revision.id === target.snapshotId)) void selectSnapshot(target.snapshotId)
      else if (snapshotId === target.snapshotId) { handledTarget.current = target; document.getElementById(`review-thread-${target.threadId.replace('comment:', '')}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
    }, 0)
    return () => clearTimeout(timer)
    // Target navigation is a one-shot route intent; selection functions use current render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, learnerId, projectId, snapshotId, work, busy, queueReady])
  function changeReply(id: string, value: string) { setReplyDrafts(previous => ({ ...previous, [id]: value })); void commandStore.put(`review-reply:${learnerId}:${id}`, value).catch(() => setError('Reply draft could not be saved. Keep this page open.')) }
  async function confirmSaved(saved: { key: string; kind: string; payload: Record<string, unknown> }) {
    const receipt = await client.sharedCommand(actorId, saved.kind, saved.payload)
    if (!isReviewAcknowledgement(saved.kind, receipt)) throw new Error('Feedback acknowledgement was not confirmed.')
    setError('')
    try { await commandStore.removeRecord(saved.key); setPendingCommand(null) }
    catch { setError('Feedback is confirmed, but local receipt cleanup failed. Retry the saved update to finish cleanup without creating a duplicate.') }
    setConfirmation(saved.kind === 'resolve' ? 'Discussion resolved and confirmed.' : `${saved.kind === 'comment' ? 'Comment' : 'Reply'} sent and confirmed: ${String(saved.payload.message)}`)
    if (saved.kind === 'comment' && saved.payload.snapshotId === snapshotId) { drafts.current.delete(`${projectId}:${snapshotId}`); setMessage(''); await commandStore.removeRecord(`review-draft:${learnerId}:${projectId}:${snapshotId}`).catch(() => setError('Comment is confirmed; the old local draft could not be cleared. Do not resend it.')) }
    if (saved.kind === 'reply' && typeof saved.payload.threadId === 'string') { const id = saved.payload.threadId; setReplyDrafts(previous => ({ ...previous, [id]: '' })); await commandStore.removeRecord(`review-reply:${learnerId}:${id}`).catch(() => setError('Reply is confirmed; the old local draft could not be cleared. Do not resend it.')) }
    latestWork.current = null; void inbox?.refresh(); await reload()
  }

  async function command(kind: string, payload: Record<string, unknown>) {
    if (sending.current) return false
    if (!queueReady) { setError('Saved feedback recovery must finish before sending a new update.'); return false }
    if (pendingCommand) { setError('A previous feedback update is unconfirmed. Retry that saved update before sending another.'); return false }
    sending.current = true; setBusy(true); setConfirmation(''); setError('')
    const mutationId = crypto.randomUUID(), saved = { key: `review-command:${mutationId}`, kind, payload: { ...payload, mutationId } }
    try { return await confirmReviewUpdate(async () => { await commandStore.put(saved.key, { kind, payload: saved.payload }); setPendingCommand(saved); await confirmSaved(saved) }, e => setError(e instanceof Error ? e.message : 'Comment not confirmed.')) }
    finally { sending.current = false; setBusy(false) }
  }
  return <section className="tp-surface tp-review"><h2>{mentor ? 'Compositions & feedback' : 'My compositions & feedback'}</h2><p>{mentor ? 'Review the student’s saved music and respond to a specific revision.' : 'Open your saved compositions and discuss them with your tutor.'}</p>{confirmation && <p className="tp-note" role="status">{confirmation}</p>}
    {!queueReady && <p role={queueError ? 'alert' : 'status'}>{queueError ? 'Saved feedback could not be checked. New updates are paused so an unconfirmed update is not lost.' : 'Checking saved feedback updates…'}{queueError && <button type="button" onClick={() => { setQueueError(false); setQueueAttempt(value => value + 1) }}>Retry feedback recovery</button>}</p>}
    {pendingCommand && <p role="status">A feedback update is saved locally and awaits confirmation. <button disabled={busy} onClick={() => { setBusy(true); void confirmSaved(pendingCommand).catch(e => setError(String(e))).finally(() => setBusy(false)) }}>Retry saved feedback update</button></p>}
    {error && <p role="alert" className="tp-error">{error} <button onClick={() => void reload()}>Retry</button></p>}
    <label>Project <select disabled={busy} value={projectId} onChange={e => selectProject(e.target.value)}><option value="">Choose a composition</option>{work?.projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name} · received revision {p.revision}</option>)}</select></label>
    {work?.projects.length === 0 && <p>No composition received yet. This does not establish whether the student practised.</p>}
    {projectId && <><div className="tp-actions"><button type="button" className="tp-primary" disabled={busy || loadingRevision || !latestReviewRevision(work?.revisions ?? [])} onClick={() => { const latest = latestReviewRevision(work?.revisions ?? []); if (latest) void selectSnapshot(latest.id) }}>Open latest saved composition</button></div><p>Inspect the arrangement and notes, listen, or open the full score and individual instrument parts. Choose an earlier saved revision below to compare work.</p><label>Saved revision <select disabled={busy} value={snapshotId} onChange={e => void selectSnapshot(e.target.value)}><option value="">Choose a revision to review</option>{work?.revisions.map(r => <option key={r.id} value={r.id}>Revision {r.revision} · {new Date(r.received_at).toLocaleString()}</option>)}</select></label>
      {loadingRevision && <p role="status">Loading saved composition…</p>}{busy && <p role="status">Sending feedback…</p>}
      {music && <><div className="tp-actions"><button className="tp-primary" onClick={() => { setScoreTrack(''); setScore(true) }}>Full score · all instruments</button><button onClick={() => { void audio.play(music, () => {}, () => {}).catch(e => setError(String(e))) }}>Listen</button><button onClick={() => audio.stop()}>Stop</button></div>
        <CompositionPreview key={snapshotId} project={music} onPartScore={id => { setScoreTrack(id); setScore(true) }} onAnnotate={mentor ? (id, bar) => { setPart(id); setMeasures(String(bar)); const field = document.querySelector<HTMLTextAreaElement>('.tp-feedback-form textarea'); field?.focus(); field?.scrollIntoView({ block: 'center', behavior: 'smooth' }) } : undefined} />
        <h3>Observed changes</h3><p>Evidence: {previousMusic ? 'selected revision compared with its immediately preceding revision.' : comparisonWarning || 'No immediately preceding revision is available for comparison.'}</p><ul>{summary.map(line => <li key={line}>{line}</li>)}</ul>
        {playability && <details><summary>Playability review ({playability.findings.length})</summary><p>{playability.limitation}</p>{playability.findings.map(finding => <article key={finding.id}><h4>{finding.trackName}: {finding.title}</h4><p>{finding.explanation}</p><p>{finding.affected.length} affected note occurrences in this saved revision.</p><ul>{finding.alternatives.map(alternative => <li key={alternative}>{alternative}</li>)}</ul></article>)}</details>}
        {mentor && <TutorSummary key={snapshotId} current={music} previous={previousMusic} snapshotId={snapshotId} receivedRevision={work?.revisions.find(r => r.id === snapshotId)?.revision ?? 0} conversationCounts={{ complete: work?.exchanges.filter(e => e.project_revision <= music.revision && e.status === 'complete').length ?? 0, pending: work?.exchanges.filter(e => e.project_revision <= music.revision && e.status === 'pending').length ?? 0, failed: work?.exchanges.filter(e => e.project_revision <= music.revision && e.status === 'failed').length ?? 0 }} />}
        <details><summary>All parts and unused patterns</summary>{music.patterns.map(p => <p key={p.id}>{p.name}: {p.notes.length} notes · {music.clips.some(c => c.patternId === p.id) ? 'placed in arrangement' : 'not yet placed'}</p>)}</details>
        <details><summary>Finalized Idea Pad captures ({music.ideas.length})</summary>{music.ideas.map(idea => <article key={idea.id}><h4>{idea.name}</h4>{idea.original.kind === 'text' ? <p>{idea.original.text}</p> : idea.original.kind === 'audio' ? <audio controls src={`data:${idea.original.mimeType};base64,${idea.original.base64}`} /> : <p>{idea.original.events.length} preserved MIDI events · {Math.round(idea.original.durationMs / 1000)} seconds</p>}</article>)}</details>
      </>}
      <details><summary>Mira conversations ({work?.exchanges.length ?? 0})</summary>{work?.exchanges.map(e => <article className="tp-note" key={e.request_id}><small>Local composition revision {e.project_revision} · {e.status}</small><p><strong>Student:</strong> {e.prompt}</p><p><strong>Mira:</strong> {e.response || 'Response not received.'}</p></article>)}</details>
      {mentor && music && <form className="tp-feedback-form" onSubmit={e => { e.preventDefault(); void command('comment', { snapshotId, message, anchor: { trackId: part || null, measures: measures || null } }) }}><h3>Leave feedback</h3><label>Part <select disabled={busy} value={part} onChange={e => setPart(e.target.value)}><option value="">Whole composition</option>{music.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Measures (optional) <input disabled={busy} value={measures} maxLength={80} onChange={e => setMeasures(e.target.value)} placeholder="e.g. 4–8" /></label><label>Comment <textarea disabled={busy} required maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} /></label><button disabled={busy || !queueReady || !!pendingCommand || !message.trim()}>Send comment</button></form>}
      {work?.threads.map(t => <article className="tp-note tp-feedback-thread" id={`review-thread-${t.id}`} key={t.id}><small>Revision {work.revisions.find(r => r.id === t.snapshot_id)?.revision ?? 'earlier'}{t.resolved_at ? ' · resolved' : ' · open'} · {typeof t.anchor.measures === 'string' ? `Measures ${t.anchor.measures}` : 'Composition'}</small><p>{t.message}</p>{t.replies.map(r => <p key={r.id}>Reply: {r.message}{r.revision_id ? ' · linked revision' : ''}</p>)}<form onSubmit={e => { e.preventDefault(); void command('reply', { threadId: t.id, message: replyDrafts[t.id] ?? '', revisionId: snapshotId || null }) }}><label>Reply <input disabled={busy || !queueReady || !!pendingCommand} name="reply" value={replyDrafts[t.id] ?? ''} onChange={event => changeReply(t.id, event.target.value)} maxLength={4000} required /></label><button disabled={busy || !queueReady || !!pendingCommand}>Send reply{snapshotId ? ' with selected revision' : ''}</button></form>{mentor && !t.resolved_at && <button disabled={busy || !queueReady || !!pendingCommand} onClick={() => void command('resolve', { threadId: t.id })}>Resolve discussion</button>}</article>)}
    </>}
    {score && music && <SheetMusic project={music} initialTrackId={scoreTrack} onClose={() => setScore(false)} />}
  </section>
}

