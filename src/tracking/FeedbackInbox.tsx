import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTrackingSession } from './TrackingSession'
import { groupFeedback, parseFeedback, type FeedbackItem, type FeedbackTarget } from './feedbackTypes'
import './feedbackInbox.css'
import { AccountStudioStore } from './accountStore'
import { deliverFeedback, feedbackReply, type FeedbackPending } from './feedbackOutbox'
import { feedbackGuide } from './feedbackGuide'
import { FEEDBACK_READ_BATCH, feedbackUnreadCount, rememberFeedbackViews, restoredFeedbackViews, visibleFeedbackIds } from './feedbackViewed'

interface InboxContext { items: FeedbackItem[]; unread: number; open: () => void; ask: () => void; target: FeedbackTarget | null; refresh: () => Promise<void> }
const FeedbackContext = createContext<InboxContext | null>(null)
// eslint-disable-next-line react-refresh/only-export-components
export function useFeedbackInbox() { return useContext(FeedbackContext) }
export function FeedbackButton() {
  const inbox = useFeedbackInbox()
  if (!inbox) return null
  return <button type="button" className="tp-primary nadi-feedback-button" onClick={inbox.open}>Feedback{inbox.unread > 0 && <span className="nadi-feedback-badge" aria-label={`${inbox.unread} unread`}>{inbox.unread}</span>}</button>
}
export function AskTutorButton() { const inbox = useFeedbackInbox(); return inbox ? <button type="button" className="tp-primary nadi-feedback-button" onClick={inbox.ask}>Ask my tutor</button> : null }
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const session = useTrackingSession(), actorId = session?.workspace?.profile.id ?? ''
  return actorId && session ? <AccountFeedback key={actorId} actorId={actorId} mentor={session.workspace?.profile.role === 'mentor'} client={session.client}>{children}</AccountFeedback> : children
}
function AccountFeedback({ actorId, mentor, client, children }: { actorId: string; mentor: boolean; client: NonNullable<ReturnType<typeof useTrackingSession>>['client']; children: ReactNode }) {
  const [items, setItems] = useState<FeedbackItem[]>([]), [open, setOpen] = useState(false), [thread, setThread] = useState('')
  const [error, setError] = useState(''), [target, setTarget] = useState<FeedbackTarget | null>(null), [toast, setToast] = useState<FeedbackItem | null>(null)
  const [refreshError, setRefreshError] = useState(''), [confirmedBody, setConfirmedBody] = useState<{ threadId: string; message: string } | null>(null)
  const [reply, setReply] = useState(''), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState('')
  const [store] = useState(() => new AccountStudioStore(actorId)), [ready, setReady] = useState(false), [pending, setPending] = useState<FeedbackPending | null>(null)
  const drafts = useRef(new Map<string, string>()), drawer = useRef<HTMLElement | null>(null), returnFocus = useRef<HTMLElement | null>(null)
  const [theme, setTheme] = useState('eclipse')
  const alive = useRef(true), inFlight = useRef(false), seen = useRef<Set<string> | null>(null)
  const sending = useRef(false)
  const currentThread = useRef(''), [readAttempt, setReadAttempt] = useState(0)
  const selected = items.filter(item => item.threadId === thread)
  const [viewed, setViewed] = useState<Set<string>>(() => new Set())
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible')
  const [readError, setReadError] = useState(''), [viewedError, setViewedError] = useState('')
  const unread = feedbackUnreadCount(items, actorId, viewed)
  const guide = feedbackGuide(!!selected[0]?.projectId, selected.find(item => item.anchor?.measures)?.anchor?.measures)
  useEffect(() => {
    let active = true
    void Promise.all([store.records<string>('inbox-draft:'), store.records<FeedbackPending>('inbox-command:'), store.records<boolean>('inbox-viewed:')]).then(([savedDrafts, commands, viewedRows]) => {
      if (!active) return
      for (const row of savedDrafts) drafts.current.set(row.key.slice(12), row.value)
      setReply(drafts.current.get(currentThread.current) ?? '')
      setViewed(previous => new Set([...previous, ...restoredFeedbackViews(viewedRows)])); setPending(commands[0]?.value ?? null); setReady(true)
    }).catch(() => { if (active) setError('Saved feedback could not be recovered. Refresh before sending so pending messages are preserved.') })
    return () => { active = false; store.close() }
  }, [store])
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    const syncTheme = () => { const active = document.querySelector('[data-theme]:not(.nadi-feedback-inbox):not(.nadi-feedback-toast)'); setTheme(active?.getAttribute('data-theme') ?? 'eclipse') }
    syncTheme(); const observer = new MutationObserver(syncTheme); observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending.current) { setOpen(false); returnFocus.current?.focus() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  const refresh = useCallback(async () => {
    if (inFlight.current || !alive.current) return
    inFlight.current = true
    try {
      const next = parseFeedback(await client.feedbackRead(actorId))
      if (!alive.current) return
      const fresh = seen.current ? next.filter(item => !seen.current!.has(item.id) && !item.readAt && item.authorId !== actorId) : []
      seen.current = new Set(next.map(item => item.id)); setItems(next); setRefreshError('')
      setConfirmedBody(previous => previous && next.some(item => item.authorId === actorId && item.threadId === previous.threadId && item.message === previous.message) ? null : previous)
      if (fresh.length) setToast(fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
    } catch { if (alive.current) setRefreshError('Feedback could not refresh. Your saved discussions remain available; try again when connected.') }
    finally { inFlight.current = false }
  }, [actorId, client])
  useEffect(() => {
    alive.current = true
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const first = setTimeout(refreshVisible, 0), timer = setInterval(refreshVisible, 5000)
    window.addEventListener('focus', refreshVisible); window.addEventListener('nadi:feedback-changed', refreshVisible); document.addEventListener('visibilitychange', refreshVisible)
    return () => { alive.current = false; clearTimeout(first); clearInterval(timer); window.removeEventListener('focus', refreshVisible); window.removeEventListener('nadi:feedback-changed', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
  }, [refresh])
  function openThread(id: string) {
    if (sending.current) return
    currentThread.current = id; setThread(id); setOpen(true); setReply(drafts.current.get(id) ?? ''); setConfirmation(''); setToast(null)
    const linked = items.find(item => item.threadId === id && item.kind === 'comment' && item.projectId && item.snapshotId) ?? items.find(item => item.threadId === id && item.projectId && item.snapshotId)
    if (linked) { setTarget(linked); window.location.hash = '#progress'; window.dispatchEvent(new CustomEvent('nadi:open-feedback', { detail: linked })) }
  }
  function changeReply(value: string) { setReply(value); drafts.current.set(thread, value); void store.put(`inbox-draft:${thread}`, value).catch(() => setError('This draft could not be saved on this device. Keep this page open.')) }
  // Opening the inbox never marks messages read. Only the visible discussion does.
  const unreadIds = JSON.stringify(visibleFeedbackIds(items, actorId, thread, open, pageVisible))
  useEffect(() => {
    const ids: string[] = JSON.parse(unreadIds)
    if (!ids.length) return
    let active = true
    // Synchronizes external read-tracking (store + server) with local badge state; not derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewed(previous => new Set([...previous, ...ids]))
    void rememberFeedbackViews(store, ids).then(() => { if (active) setViewedError('') }).catch(() => { if (active) setViewedError('Viewed here, but this device could not remember the read status. The count may return after refresh.') })
    void client.feedbackCommand(actorId, 'read', { mutationId: crypto.randomUUID(), itemIds: ids.slice(0, FEEDBACK_READ_BATCH) }).then(() => { if (active && alive.current) { setReadError(''); void refresh() } }).catch(() => { if (active) setReadError('Viewed on this device. Read status has not synced yet; other devices may still show it as unread. Retry when connected.') })
    return () => { active = false }
  }, [actorId, client, unreadIds, refresh, readAttempt, store])
  async function sendReply(retry?: FeedbackPending) {
    if (sending.current || !ready || (!retry && (pending || !reply.trim() || !thread))) return
    sending.current = true; setBusy(true); setConfirmation(''); setError('')
    const saved = retry ?? feedbackReply(thread, reply, selected[0]?.snapshotId ?? null, crypto.randomUUID())
    setPending(saved)
    try {
      const outcome = await deliverFeedback(store, saved, command => command.shared ? client.sharedCommand(actorId, command.kind, command.payload) : client.feedbackCommand(actorId, command.kind, command.payload))
      if (!alive.current) return
      if (outcome.cleaned) setPending(null)
      else setError('Reply is confirmed, but local receipt cleanup failed. Retry the saved reply to finish cleanup; its original identifier prevents duplicates.')
      drafts.current.delete(saved.threadId)
      const receipt = outcome.receipt as { id?: string }
      const confirmedThread = saved.kind === 'question' && receipt.id ? `question:${receipt.id}` : saved.threadId
      if (saved.kind === 'question') { currentThread.current = confirmedThread; setThread(confirmedThread) }
      setConfirmedBody({ threadId: confirmedThread, message: String(saved.payload.message) })
      setConfirmation(saved.kind === 'question' ? 'Question sent and confirmed. Your tutor will see it in Feedback.' : 'Reply sent and confirmed.')
      await store.removeRecord(`inbox-draft:${saved.threadId}`).catch(() => setError('Reply is confirmed, but the old local draft could not be cleared. Do not resend it.'))
      if (thread === saved.threadId) setReply('')
      await refresh()
    } catch { if (alive.current) setError('Reply was not confirmed. Your text is retained. Check the discussion before retrying.') }
    finally { sending.current = false; if (alive.current) setBusy(false) }
  }
  function openComposition(item: FeedbackItem) {
    setTarget({ learnerId: item.learnerId, projectId: item.projectId, snapshotId: item.snapshotId, threadId: item.threadId }); setOpen(false)
    window.location.hash = '#progress'
    window.dispatchEvent(new CustomEvent('nadi:open-feedback', { detail: item }))
  }
  return <FeedbackContext.Provider value={{ items, unread, open: () => { setOpen(true); void refresh() }, ask: () => openThread('new-question'), target, refresh }}>{children}
    {toast && !open && <aside className="nadi-feedback-toast" data-theme={theme} role="status"><div><strong>New feedback</strong><p>{toast.authorName}: {toast.preview}</p></div><button type="button" onClick={() => openThread(toast.threadId)}>View</button><button type="button" aria-label="Dismiss feedback notification" onClick={() => setToast(null)}>×</button></aside>}
    {open && <aside ref={drawer} className="nadi-feedback-inbox" data-theme={theme} role="dialog" aria-modal="false" aria-label="Feedback inbox"><header><div><span>YOUR CONVERSATIONS</span><h2>Feedback {unread > 0 && `· ${unread} unread`}</h2></div><button type="button" disabled={busy} onClick={() => { setOpen(false); returnFocus.current?.focus() }}>Close ×</button></header>{(error || refreshError || readError || viewedError) && <p role="alert">{error || refreshError || readError || viewedError} <button type="button" onClick={() => { setReadAttempt(value => value + 1); void refresh() }}>Retry</button></p>}
      {pending && <p role="status">A reply awaits confirmation. <button type="button" disabled={busy} onClick={() => void sendReply(pending)}>Retry saved reply</button></p>}{!thread ? <>{!mentor && <button type="button" onClick={() => openThread('new-question')}>Ask my tutor · new question</button>}<p>All received feedback and questions in one place. Open a discussion to mark it as read.</p>{!items.length && <p>No feedback received yet.</p>}{groupFeedback(items).map(group => { const last = group[group.length - 1], count = group.filter(item => !item.readAt && !viewed.has(item.id) && item.authorId !== actorId).length; return <button className="nadi-feedback-row" type="button" key={last.threadId} onClick={() => openThread(last.threadId)}><strong>{last.authorName}{count > 0 && <span>{count} unread</span>}</strong><span>{last.preview}</span><small>{new Date(last.createdAt).toLocaleString()} · {group.length} message{group.length === 1 ? '' : 's'}</small></button> })}</> : <><button type="button" disabled={busy} onClick={() => { currentThread.current = ''; setThread(''); setReply('') }}>← All feedback</button>{selected.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(item => <article className="nadi-feedback-message" key={item.id}><strong>{item.authorName}</strong><small>{new Date(item.createdAt).toLocaleString()}{item.anchor?.measures ? ` · Measures ${item.anchor.measures}` : ''}{item.anchor?.trackId ? ' · Instrument-specific feedback' : ''}</small><p>{item.message}</p></article>)}{confirmedBody?.threadId === thread && <article className="nadi-feedback-message"><strong>You · confirmed</strong><p>{confirmedBody.message}</p></article>}{!mentor && selected.some(item => item.authorId !== actorId) && <details className="tp-note nadi-feedback-guide"><summary>Mira · Help me act on this feedback</summary><p>Software steps and a neutral checklist. This built-in guide does not interpret the tutor’s creative intent or compose for you.</p><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><strong>Before replying</strong><ul>{guide.checks.map(check => <li key={check}>{check}</li>)}</ul></details>}{selected[0]?.projectId && <button type="button" onClick={() => openComposition(selected[0])}>Open linked composition & revision</button>}{<form onSubmit={event => { event.preventDefault(); void sendReply() }}><label htmlFor="nadi-inbox-reply">{thread === 'new-question' ? 'What would you like to ask your tutor?' : 'Reply to this discussion'}</label><textarea id="nadi-inbox-reply" value={reply} maxLength={4000} required disabled={busy || !ready || !!pending} onChange={event => changeReply(event.target.value)} /><button type="submit" disabled={busy || !ready || !!pending || !reply.trim()}>{busy ? 'Sending…' : thread === 'new-question' ? 'Send question' : 'Send reply'}</button></form>}{confirmation && <p role="status">{confirmation}</p>}</>}
    </aside>}
  </FeedbackContext.Provider>
}
