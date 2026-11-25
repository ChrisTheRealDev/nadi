import { lazy, Suspense, useEffect, useState } from 'react'
import CreationApp from './creation/v4/StudioApp'
import { TrackingSessionProvider, useTrackingSession } from './tracking/TrackingSession'
import { NadiBrand } from './components/NadiBrand'
import { FeedbackProvider } from './tracking/FeedbackInbox'
import './experience.css'
import './creation/studioGlass.css'
import './brand.css'

const LearningApp = lazy(() => import('./App'))
const TrackingPortal = lazy(() => import('./tracking/TrackingPortal'))

type Appearance = 'light' | 'eclipse' | 'dark'
function savedAppearance(): Appearance {
  try { const value = localStorage.getItem('nadi.tracking.theme'); if (value === 'light' || value === 'eclipse' || value === 'dark') return value } catch { /* Appearance remains usable without storage. */ }
  return 'eclipse'
}

export default function Root() {
  return <TrackingSessionProvider><FeedbackProvider>
    <Suspense fallback={<p role="status">Opening NADI…</p>}><RoutedRoot /></Suspense>
  </FeedbackProvider></TrackingSessionProvider>
}
function RoutedRoot() {
  const session = useTrackingSession()
  const accountId = session?.workspace?.profile.role === 'student' && session.workspace.musicSharingAccepted ? session.workspace.profile.id : undefined
  const [hash, setHash] = useState(() => window.location.hash)
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance)
  useEffect(() => { const changed = () => setHash(window.location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [])
  useEffect(() => { const sync = () => setAppearance(savedAppearance()); window.addEventListener('hashchange', sync); window.addEventListener('storage', sync); return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('storage', sync) } }, [])
  if (['#progress', '#goals', '#mentors'].includes(hash)) return <TrackingPortal />
  const studio = hash === '' || hash === '#create'
  return <div className="nadi-experience" data-theme={appearance}>
    <div className="nadi-appearance-bar">
      <div className="nadi-identity"><NadiBrand /><strong>Your music. Your progress.</strong><span className="nadi-location">{studio ? 'Music studio' : 'Learn & explore'}</span></div>
      <label className="nadi-appearance">Appearance <select aria-label="Appearance" value={appearance} onChange={event => { const next = event.target.value as Appearance; setAppearance(next); try { localStorage.setItem('nadi.tracking.theme', next) } catch { /* In-memory preference still works. */ } }}><option value="light">Light</option><option value="eclipse">Eclipse</option><option value="dark">Dark</option></select></label>
    </div>
    <div className="nadi-experience-content">{studio ? <CreationApp key={accountId ?? 'anonymous'} accountId={accountId} /> : <LearningApp />}</div>
  </div>
}
