import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { TrackingClient, TrackingRequestError, type TrackingWorkspace } from './client'
import { NavItem } from '../components/NavItem'
import { NadiBrand, NadiBird } from '../components/NadiBrand'
import ProgressActions from './ProgressActions'
import PlannerDashboard from './PlannerDashboard'
import { FeedbackButton, AskTutorButton, useFeedbackInbox } from './FeedbackInbox'
import { useTrackingSession } from './TrackingSession'
import SharedReview from './SharedReview'
import { RecoveryRequest } from './PasswordRecovery'

type Theme = 'light' | 'eclipse' | 'dark'
type View = 'home' | 'goals' | 'learners'
type LoadState = 'checking' | 'setup' | 'login' | 'loading' | 'ready' | 'error'
type Learner = TrackingWorkspace['learners'][number]

const THEME_KEY = 'nadi.tracking.theme'
const THEMES: Theme[] = ['light', 'eclipse', 'dark']

function savedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return THEMES.find((theme) => theme === value) ?? 'eclipse'
  } catch {
    return 'eclipse'
  }
}

function displayDate(value: string | null | undefined): string {
  if (!value) return 'No date supplied'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function displayTime(value: Date | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : 'Not refreshed yet'
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ')
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function findOwnProgress(workspace: TrackingWorkspace): Learner | undefined {
  return workspace.learners.find((entry) => entry.profile.id === workspace.profile.id)
}

function latestByDate<T extends { created_at: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).at(-1)
}

function matchingFeedback(learner?: Learner) {
  if (!learner) return undefined
  const checkpoint = latestByDate(learner.progress.checkpoints)
  return checkpoint ? latestByDate(learner.progress.feedback.filter((item) => item.checkpoint_id === checkpoint.id)) : undefined
}

function GoalList({ learner }: { learner?: Learner }) {
  if (!learner || learner.progress.goals.length === 0) {
    return <div className="tp-empty"><span className="tp-empty-icon" aria-hidden="true">◎</span><h3>No goals received yet</h3><p>When an assigned goal is available, it will appear here after refresh.</p></div>
  }

  return <div className="tp-list">
    {learner.progress.goals.map((goal) => <article className="tp-list-row" key={goal.id}>
      <span className="tp-list-symbol" aria-hidden="true">◎</span>
      <div className="tp-list-copy"><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}<small>{goal.due_date ? `Due ${displayDate(goal.due_date)}` : `Added ${displayDate(goal.created_at)}`}</small></div>
      <span className="tp-pill">{humanize(goal.status)}</span>
    </article>)}
  </div>
}

function ProgressList({ learner }: { learner?: Learner }) {
  if (!learner) return <div className="tp-empty tp-empty-compact"><p>No progress record was returned for this account.</p></div>
  const { workSessions, events, checkpoints, feedback, helpRequests } = learner.progress
  const openHelp = helpRequests.filter((request) => !request.resolved_at)
  return <div className="tp-progress-grid">
    <div className="tp-stat"><strong>{workSessions.length}</strong><span>Work sessions</span></div>
    <div className="tp-stat"><strong>{events.length}</strong><span>Milestones</span></div>
    <div className="tp-stat"><strong>{checkpoints.length}</strong><span>Shared checkpoints</span></div>
    <div className="tp-stat"><strong>{feedback.length}</strong><span>Feedback notes</span></div>
    <div className="tp-stat"><strong>{openHelp.length}</strong><span>Open help requests</span></div>
  </div>
}

function LearnerDetail({ learner }: { learner: Learner }) {
  const { checkpoints, feedback, helpRequests, events } = learner.progress
  const latestCheckpoint = latestByDate(checkpoints)
  const latestFeedback = latestCheckpoint ? latestByDate(feedback.filter((item) => item.checkpoint_id === latestCheckpoint.id)) : undefined
  return <div className="tp-detail-stack">
    <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Assigned work</span><h2>Goals</h2></div><span className="tp-count">{countLabel(learner.progress.goals.length, 'goal')}</span></div><GoalList learner={learner} /></section>
    <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Received progress</span><h2>Activity summary</h2></div></div><ProgressList learner={learner} /></section>
    <div className="tp-duo">
      <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Deliberately shared</span><h2>Latest checkpoint</h2></div></div>{latestCheckpoint ? <div className="tp-note"><small>{displayDate(latestCheckpoint.created_at)}</small><p>{latestCheckpoint.reflection || 'No reflection supplied.'}</p><span className="tp-subtle">Review saved compositions and listen in Compositions & feedback above.</span></div> : <p className="tp-muted">No shared checkpoint received.</p>}</section>
      <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Mentor conversation</span><h2>Feedback & help</h2></div></div>{latestFeedback ? <div className="tp-note"><small>On latest checkpoint · {displayDate(latestFeedback.created_at)}</small><p>{latestFeedback.message}</p></div> : <p className="tp-muted">No feedback on the latest checkpoint.</p>}{helpRequests.filter((request) => !request.resolved_at).map((request) => <div className="tp-note tp-help" key={request.id}><small>Open help request · {displayDate(request.created_at)}</small><p>{request.message}</p></div>)}</section>
    </div>
    {events.length > 0 && <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Disclosed summary</span><h2>Recent milestones</h2></div></div><div className="tp-list">{[...events].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)).slice(0, 5).map((event) => <div className="tp-list-row" key={event.id}><span className="tp-list-symbol" aria-hidden="true">◌</span><div className="tp-list-copy"><h3>{humanize(event.kind)}</h3><small>Evidence: {humanize(event.evidence)} · Occurred {displayDate(event.occurred_at)} · Received {displayDate(event.received_at)}</small></div></div>)}</div></section>}
  </div>
}

export default function TrackingPortal({ clientFactory }: { clientFactory?: () => TrackingClient } = {}) {
  const inbox = useFeedbackInbox()
  const session = useTrackingSession()
  const hasSession = !!session, publishWorkspace = session?.setWorkspace
  const initialSessionWorkspace = useRef(session?.workspace)
  const [client] = useState(() => clientFactory ? clientFactory() : session?.client ?? new TrackingClient())
  const [theme, setTheme] = useState<Theme>(savedTheme)
  const [view, setView] = useState<View>(() => window.location.hash === '#goals' ? 'goals' : window.location.hash === '#mentors' ? 'learners' : 'home')
  const [loadState, setLoadState] = useState<LoadState>(session?.workspace ? 'ready' : 'checking')
  const [setupReason, setSetupReason] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginMessage, setLoginMessage] = useState('')
  const [workspace, setWorkspace] = useState<TrackingWorkspace | null>(session?.workspace ?? null)
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [refreshError, setRefreshError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const generation = useRef(0)
  const refreshBusy = useRef<number | null>(null)


  const chooseTheme = (next: Theme) => {
    setTheme(next)
    try { window.localStorage.setItem(THEME_KEY, next) } catch { /* Theme still changes for this view. */ }
  }

  const checkSetup = useCallback(async () => {
    const current = ++generation.current
    setLoadState('checking')
    try {
      const result = await client.status()
      if (current !== generation.current) return
      if (result.configured) { setLoadState('login'); setSetupReason('') }
      else { setSetupReason(result.reason || 'Tracking service is not configured.'); setLoadState('setup') }
    } catch {
      if (current === generation.current) { setSetupReason('Could not check the tracking service.'); setLoadState('setup') }
    }
  }, [client])

  useEffect(() => {
    const timer = window.setTimeout(() => { if (!initialSessionWorkspace.current) void checkSetup() }, 0)
    return () => { window.clearTimeout(timer); generation.current += 1; if (!hasSession) client.signOut() }
  }, [checkSetup, client, hasSession])

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])

  useEffect(() => {
    const syncView = () => {
      if (window.location.hash === '#goals') setView('goals')
      else if (window.location.hash === '#mentors') setView('learners')
      else if (window.location.hash === '#progress') setView('home')
    }
    window.addEventListener('hashchange', syncView)
    return () => window.removeEventListener('hashchange', syncView)
  }, [])

  const refresh = useCallback(async (initial = false) => {
    const current = generation.current
    if (refreshBusy.current === current) return
    refreshBusy.current = current
    if (!initial) setRefreshing(true)
    try {
      const next = await client.workspace()
      if (current !== generation.current) return
      setWorkspace(next)
      publishWorkspace?.(next)
      setLastRefreshed(new Date())
      setRefreshError(false)
      setLoadState('ready')
      if (initial) setView(next.profile.role === 'mentor' ? 'learners' : window.location.hash === '#goals' ? 'goals' : 'home')
    } catch {
      if (current !== generation.current) return
      setRefreshError(true)
      // Autosync may already have cleared expired tokens before this view opens;
      // workspace() then throws a plain missing-session error, not another 401.
      if (!client.hasSession()) {
        client.signOut(); setWorkspace(null); publishWorkspace?.(null); setSelectedLearnerId(null)
        setLoginMessage('Your sign-in session has expired. Sign in again to reconnect; your saved music is retained.')
        setLoadState('login')
        return
      }
      if (initial) setLoadState('error')
    } finally {
      if (refreshBusy.current === current) refreshBusy.current = null
      if (current === generation.current) setRefreshing(false)
    }
  }, [client, publishWorkspace])

  useEffect(() => {
    if (loadState !== 'ready') return
    const poll = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh() }
    const timer = window.setInterval(poll, 5000)
    const visible = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', poll)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', poll) }
  }, [loadState, refresh])

  const signOut = () => {
    generation.current += 1
    refreshBusy.current = null
    client.signOut()
    setWorkspace(null)
    session?.setWorkspace(null)
    setPassword('')
    setSelectedLearnerId(null)
    setLastRefreshed(null)
    setRefreshError(false)
    setRefreshing(false)
    setLoadState('login')
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim() || !password) return
    const current = ++generation.current
    setRefreshError(false)
    setLoginMessage('')
    setLoadState('loading')
    try {
      await client.login(email.trim(), password)
      if (current !== generation.current) return
      setPassword('')
      await refresh(true)
    } catch (error) {
      if (current === generation.current) {
        client.signOut(); setLoadState('login'); setRefreshError(true)
        setLoginMessage(error instanceof TrackingRequestError && error.code === 'auth-account-attention' ? 'This account needs attention before sign-in. Ask the account administrator to check its confirmation and access status.' : error instanceof TrackingRequestError && error.status === 401 ? 'The sign-in service did not accept this sign-in. If this account previously worked, recover the existing account or ask the administrator for help.' : error instanceof TrackingRequestError && error.status === 429 ? 'Too many sign-in attempts. Wait a moment, then try again.' : 'The sign-in service is temporarily unavailable. This does not mean your password is wrong. Retry shortly; your saved work is unchanged.')
      }
    }
  }

  useEffect(() => { const target = inbox?.target; if (!target || workspace?.profile.role !== 'mentor') return; const timer = setTimeout(() => { setSelectedLearnerId(target.learnerId); setView('home') }, 0); return () => clearTimeout(timer) }, [inbox?.target, workspace?.profile.role])

  const profile = workspace?.profile
  const mentor = profile?.role === 'mentor'
  const ownProgress = workspace && !mentor ? findOwnProgress(workspace) : undefined
  const ownFeedback = matchingFeedback(ownProgress)
  const selectedLearner = workspace?.learners.find((learner) => learner.profile.id === selectedLearnerId)

  return <div className="tracking-portal" data-theme={theme}>
    <div className="tp-backdrop" aria-hidden="true" />
    <div className="tp-page">
      <header className="tp-topbar">
        <a className="tp-brand" href={mentor ? '#mentors' : '#progress'} aria-label="NADI tracking home"><NadiBrand /></a>
        {workspace && <nav className="tp-nav" aria-label="Tracking portal">
          {mentor ? <button type="button" className={view === 'learners' ? 'active' : ''} onClick={() => { setSelectedLearnerId(null); setView('learners'); window.location.hash = '#mentors' }}><NavItem name="learners" label="Learners" /></button> : <><button type="button" className={view === 'home' ? 'active' : ''} onClick={() => { setView('home'); window.location.hash = '#progress' }}><NavItem name="home" label="Home" /></button><button type="button" className={view === 'goals' ? 'active' : ''} onClick={() => { setView('goals'); window.location.hash = '#goals' }}><NavItem name="goals" label="Goals" /></button></>}
        </nav>}
        <div className="tp-top-actions">{workspace && <FeedbackButton />}{workspace && !mentor && <AskTutorButton />}{workspace && !mentor && <a className="tp-primary" href="#create">Open studio</a>}<label className="tp-theme-label" htmlFor="tp-theme">Theme</label><select id="tp-theme" value={theme} onChange={(event) => chooseTheme(event.target.value as Theme)}>{THEMES.map((option) => <option value={option} key={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select>{workspace && <button type="button" className="tp-signout" onClick={signOut}><NavItem name="signout" label="Sign out" /></button>}</div>
      </header>

      {loadState === 'checking' && <main className="tp-centered"><div className="tp-surface tp-state-card" role="status"><span className="tp-eyebrow">Tracking portal</span><h1>Checking setup…</h1><p>Looking for the configured tracking service.</p></div></main>}
      {loadState === 'setup' && <main className="tp-centered"><div className="tp-surface tp-state-card"><span className="tp-eyebrow">Setup needed</span><h1>Tracking is not ready yet</h1><p>{setupReason}</p><p className="tp-subtle">The music studio remains available on this device. This screen does not create accounts or shared records.</p><div className="tp-actions"><button type="button" className="tp-primary" onClick={() => void checkSetup()}>Check again</button><a className="tp-secondary" href="#create">Open anonymous device studio</a></div></div></main>}
      {loadState === 'login' && <main className="tp-centered"><div className="tp-surface tp-login-card"><div className="tp-auth-brand"><NadiBird large /><p>Your music. Your progress.</p></div><span className="tp-eyebrow">Rondo mentor connection</span><h1>Welcome to NADI</h1><p>Sign in to see goals and progress received for your account.</p><form onSubmit={(event) => void submitLogin(event)}><label htmlFor="tp-email">Email</label><input id="tp-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="tp-password">Password</label><input id="tp-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />{refreshError && <p className="tp-error" role="alert">{loginMessage || 'Sign in failed. Please try again.'}</p>}<button type="submit" className="tp-primary">Sign in</button></form><RecoveryRequest initialEmail={email} /><a className="tp-secondary tp-studio-entry" href="#create">Open anonymous device studio <span aria-hidden="true">↗</span></a><p className="tp-subtle">This tab remembers your sign-in across refreshes when browser storage is available. Your password is never saved. Sign out clears this tab’s saved session. Enrolled account work is shared with your assigned tutor. Existing anonymous projects stay separate until you explicitly import them.</p></div></main>}
      {loadState === 'loading' && <main className="tp-centered"><div className="tp-surface tp-state-card" role="status"><span className="tp-eyebrow">Connecting</span><h1>Loading your workspace…</h1><p>Waiting for a response from the tracking service.</p><button type="button" className="tp-secondary" onClick={signOut}>Cancel and sign out</button></div></main>}
      {loadState === 'error' && <main className="tp-centered"><div className="tp-surface tp-state-card"><span className="tp-eyebrow">No workspace loaded</span><h1>We could not load your workspace</h1><p>No account data is being shown. Check the connection and try again.</p><div className="tp-actions"><button type="button" className="tp-primary" onClick={() => void refresh(true)}>Retry</button><button type="button" className="tp-secondary" onClick={signOut}>Sign out</button></div></div></main>}

      {loadState === 'ready' && workspace && <main className="tp-main">
        <div className="tp-heading"><div><span className="tp-eyebrow">{mentor ? 'Mentor workspace' : 'Learner workspace'}</span><h1>{mentor ? 'Learners' : `Welcome, ${firstName(profile?.display_name || '')}`}</h1><p>{mentor ? 'Progress received from learners assigned to you.' : workspace.musicSharingAccepted ? 'Account compositions, captures and Mira conversations are visible to your assigned tutor.' : 'Accept music sharing below to begin an account workspace.'}</p></div><div className="tp-presence"><span className="tp-role">{profile?.display_name} · {mentor ? 'Mentor' : 'Learner'}</span><span className="tp-refresh">Last refreshed: {displayTime(lastRefreshed)}</span><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button></div></div>
        {(offline || refreshError) && <div className="tp-banner" role="status"><strong>{offline ? 'You appear offline.' : 'Refresh failed.'}</strong> Showing the last workspace response from {displayTime(lastRefreshed)}. Changes elsewhere may not appear yet. <button type="button" onClick={() => void refresh()} disabled={refreshing}>Retry refresh</button></div>}
        {!mentor && !workspace.disclosureAccepted && <div className="tp-banner tp-disclosure" role="status"><strong>Progress-sharing disclosure not accepted.</strong> Read the disclosure in Progress actions before sending goal updates or help requests.</div>}

        {!mentor && !workspace.musicSharingAccepted && <section className="tp-surface tp-disclosure"><h2>Connect your composing workspace</h2><p>All projects you create or import into this account, including unfinished parts, finalized Idea Pad recordings, and your Mira prompts and replies, will be visible to your assigned tutor. Your tutor can comment but cannot edit your music. Existing anonymous projects are not imported automatically.</p><button type="button" className="tp-primary" onClick={() => { void client.sharedCommand(workspace.profile.id, 'enroll', { mutationId: crypto.randomUUID(), version: 2 }).then(() => refresh()).catch(() => setRefreshError(true)) }}>Accept and enable music sharing</button></section>}
        <PlannerDashboard key={`planner:${workspace.profile.id}`} client={client} workspace={workspace} selectedLearnerId={selectedLearnerId} onSelectLearner={setSelectedLearnerId} onChanged={() => void refresh()} />
        <ProgressActions defaultExpanded={true} key={`actions:${workspace.profile.id}`} client={client} workspace={workspace} selectedLearnerId={selectedLearnerId} onChanged={() => void refresh()} />

        {mentor ? <div className="tp-mentor-layout">

          <div>{selectedLearner ? <><div className="tp-selected-heading"><span className="tp-eyebrow">Learner detail · music is read only</span><h2>{selectedLearner.profile.display_name}</h2></div><SharedReview key={selectedLearner.profile.id} client={client} actorId={workspace.profile.id} learnerId={selectedLearner.profile.id} mentor /><LearnerDetail learner={selectedLearner} /></> : <section className="tp-surface tp-select-prompt"><span className="tp-empty-icon" aria-hidden="true">◎</span><h2>Select a learner</h2><p>See their received goals, progress, shared checkpoints and feedback. Progress actions above are available for confirmed updates.</p></section>}</div>
        </div> : <>
          {workspace.musicSharingAccepted && <SharedReview client={client} actorId={workspace.profile.id} learnerId={workspace.profile.id} mentor={false} />}
          {view === 'home' && <div className="tp-home-grid">
            <section className="tp-surface tp-feature"><div className="tp-section-head"><div><span className="tp-eyebrow">Your music</span><h2>My compositions</h2></div><span className="tp-icon" aria-hidden="true">♫</span></div><p>Compose in your enrolled account workspace. Local saves remain available offline and synchronize when connected.</p><a className="tp-primary" href="#create">{workspace.musicSharingAccepted ? 'Open account studio' : 'Open anonymous device studio'} <span aria-hidden="true">↗</span></a><small>Music sharing starts after the disclosure above is accepted. The studio shows its current sharing state.</small></section>
            <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Assigned by your mentor</span><h2>Current goals</h2></div><span className="tp-icon tp-violet" aria-hidden="true">◎</span></div><GoalList learner={ownProgress} />{ownProgress && ownProgress.progress.goals.length > 0 && <button type="button" className="tp-text-button" onClick={() => { setView('goals'); window.location.hash = '#goals' }}>View all goals →</button>}</section>
            <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Received from the service</span><h2>Progress history</h2></div><span className="tp-icon tp-peach" aria-hidden="true">◌</span></div><ProgressList learner={ownProgress} />{ownFeedback && <div className="tp-note"><small>Mentor feedback on latest shared checkpoint · {displayDate(ownFeedback.created_at)}</small><p>{ownFeedback.message}</p></div>}<p className="tp-subtle">Counts reflect the last response. They are not a measure of practice quality or composing time.</p></section>
            <section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Keep the conversation going</span><h2>Feedback</h2></div></div><p>Read your tutor’s comments, reply to a discussion and open the exact composition they reviewed.</p><FeedbackButton /></section>
          </div>}
          {view === 'goals' && <div className="tp-detail-stack"><section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Assigned work</span><h2>Your goals</h2></div><span className="tp-count">{countLabel(ownProgress?.progress.goals.length || 0, 'goal')}</span></div><GoalList learner={ownProgress} /></section><section className="tp-surface"><div className="tp-section-head"><div><span className="tp-eyebrow">Received progress</span><h2>Progress summary</h2></div></div><ProgressList learner={ownProgress} /></section></div>}
        </>}
        <footer className="tp-footer">After music-sharing enrollment, account projects, finalized captures and Mira conversations synchronize automatically for your assigned tutor. Anonymous device projects require explicit import. Displayed data reflects the last service response.</footer>
      </main>}
    </div>
  </div>
}
