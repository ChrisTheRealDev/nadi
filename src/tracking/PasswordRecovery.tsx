import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NadiBird } from '../components/NadiBrand'
import { updateRecoveryPassword, type RecoveryLink } from './recoveryFragment'
import './trackingPortal.css'

export function RecoveryRequest({ initialEmail = '' }: { initialEmail?: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const reply = await fetch('/api/v1/auth/recover', { method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      setMessage(reply.ok ? 'If this email has an account, a recovery link will arrive shortly. Check your inbox and spam folder. Open the newest link on this laptop while NADI is running.' : reply.status === 429 ? 'Too many requests. Wait a few minutes before trying again.' : 'Recovery email could not be requested. Please try again shortly.')
    } catch { setMessage('Could not connect. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <div className="tp-recovery-request"><div className="tp-actions"><button className="tp-secondary" type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) setEmail(initialEmail) }}>Forgot password?</button></div>{open && <form onSubmit={event => void submit(event)}><p className="tp-subtle">Recover your existing account. Your linked music and feedback stay with it.</p><label htmlFor="tp-recovery-email">Account email</label><input id="tp-recovery-email" type="email" autoComplete="email" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /><button className="tp-primary" type="submit" disabled={busy}>{busy ? 'Requesting email…' : 'Send recovery email'}</button><p role="status">{message}</p></form>}</div>
}

export function PasswordRecoveryGate({ initialLink, onCaptured, children }: { initialLink: RecoveryLink; onCaptured?: () => void; children: ReactNode }) {
  // Recovery credentials never enter TrackingClient, storage, workspace state or logs.
  const token = useRef(initialLink?.token ?? null)
  useEffect(() => { onCaptured?.() }, [onCaptured])
  const [hasToken, setHasToken] = useState(Boolean(initialLink?.token))
  const [active, setActive] = useState(initialLink !== null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')
  const [theme] = useState(() => { try { const saved = localStorage.getItem('nadi.tracking.theme'); if (saved === 'light' || saved === 'dark') return saved } catch { /* default theme */ } return 'eclipse' })
  if (!active) return children
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !token.current) return
    if (password !== confirm) { setMessage('The two passwords do not match. Please enter them again.'); return }
    setBusy(true); setMessage('')
    try { await updateRecoveryPassword(token.current, password); token.current = null; setHasToken(false); setPassword(''); setConfirm(''); try { sessionStorage.removeItem('nadi.tracking.tab-session.v1') } catch { /* Storage may be unavailable. */ } setDone(true) }
    catch (error) { setMessage(error instanceof Error && error.name === 'Error' && !error.message.includes('fetch') ? error.message : 'Could not connect. Keep this page open and try again.') }
    finally { setBusy(false) }
  }
  return <div className="tracking-portal" data-theme={theme}><div className="tp-page"><main className="tp-centered"><section className="tp-surface tp-login-card"><div className="tp-auth-brand"><NadiBird large /><p>Your music. Your progress.</p></div><span className="tp-eyebrow">Account recovery</span><h1>{done ? 'Password updated' : hasToken ? 'Choose a new password' : 'Request a new recovery link'}</h1><p>{done ? 'Your existing account and linked work are preserved. Sign in with your new password.' : hasToken ? 'Set a password for your existing account. Keep this page open until you finish.' : 'This link is incomplete, expired or unsupported. Request a new email and use its latest recovery link.'}</p>{hasToken && !done && <form onSubmit={event => void submit(event)}><label htmlFor="tp-new-password">New password</label><input id="tp-new-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /><label htmlFor="tp-confirm-password">Confirm new password</label><input id="tp-confirm-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} /><p className="tp-subtle">Use at least 8 characters; a longer unique password is better.</p><button className="tp-primary" type="submit" disabled={busy}>{busy ? 'Updating password…' : 'Update password'}</button></form>}{message && <p role="alert" className="tp-error">{message}</p>}{!done && <RecoveryRequest />}<div className="tp-actions"><button className="tp-secondary" type="button" disabled={busy} onClick={() => { token.current = null; setHasToken(false); setPassword(''); setConfirm(''); window.location.hash = '#progress'; setActive(false) }}>{done ? 'Continue to sign in' : 'Back to sign in'}</button></div></section></main></div></div>
}
