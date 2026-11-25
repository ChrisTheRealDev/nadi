import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { TrackingClient, type TrackingWorkspace } from './client'
import './trackingPortal.css'

export interface TrackingSession {
  client: TrackingClient
  workspace: TrackingWorkspace | null
  setWorkspace: (workspace: TrackingWorkspace | null) => void
  signOut: () => void
}
const Context = createContext<TrackingSession | null>(null)
export function TrackingSessionProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    try { return new TrackingClient(fetch, Date.now, window.sessionStorage) }
    catch { return new TrackingClient() }
  })
  const [workspace, setWorkspace] = useState<TrackingWorkspace | null>(null)
  const [restoration, setRestoration] = useState<'ready' | 'checking' | 'failed'>(() => client.hasSession() ? 'checking' : 'ready')
  const [restorationError, setRestorationError] = useState('')
  const [theme] = useState(() => {
    try { const value = localStorage.getItem('nadi.tracking.theme'); if (value === 'light' || value === 'dark') return value } catch { /* Use the default appearance. */ }
    return 'eclipse'
  })
  useEffect(() => {
    if (restoration !== 'checking') return
    let active = true
    void client.workspace().then(restored => {
      if (active) { setWorkspace(restored); setRestoration('ready') }
    }).catch(error => {
      if (active) { setRestorationError(error instanceof Error ? error.message : 'Your session could not be checked.'); setRestoration('failed') }
    })
    return () => { active = false }
  }, [client, restoration])
  // Do not mount an anonymous studio while an enrolled account is being restored.
  if (restoration !== 'ready') return <div className="tracking-portal" data-theme={theme}><div className="tp-page"><main className="tp-centered"><section className="tp-surface tp-state-card" aria-live="polite"><span className="tp-eyebrow">Your account workspace</span><h1>{restoration === 'checking' ? 'Restoring your session' : 'Let’s reconnect your account'}</h1><p>{restoration === 'checking' ? 'Checking your sign-in before opening your music and tutor feedback.' : restorationError}</p>{restoration === 'failed' && <div className="tp-actions">{client.hasSession() && <button type="button" className="tp-primary" onClick={() => setRestoration('checking')}>Retry connection</button>}<button type="button" className="tp-secondary" onClick={() => { client.signOut(); setWorkspace(null); window.location.hash = '#progress'; setRestoration('ready') }}>Sign in again</button></div>}<p className="tp-subtle">Your music remains on this device. This tab remembers your sign-in across refreshes; your password is never saved. Sign out clears this tab’s saved session.</p></section></main></div></div>
  return <Context.Provider value={{ client, workspace, setWorkspace, signOut: () => { client.signOut(); setWorkspace(null) } }}>{children}</Context.Provider>
}
// A null result keeps standalone/anonymous studio use independent of authentication.
// eslint-disable-next-line react-refresh/only-export-components
export function useTrackingSession() { return useContext(Context) }
