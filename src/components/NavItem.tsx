import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const paths: Record<string, string> = {
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  goals: 'M20 12a8 8 0 1 1-8-8m0 4a4 4 0 1 0 4 4m-4 0 9-9m-5 0h5v5',
  learners: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4',
  notes: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 4-7 4-7 1s7-4 7-1m11-2c0 4-7 4-7 1s7-4 7-1',
  arrangement: 'M3 4h12v4H3zM8 10h13v4H8zM3 16h10v4H3z',
  drums: 'M4 9c0-4 16-4 16 0s-16 4-16 0m0 0v8c0 4 16 4 16 0V9M5 2l9 4M19 2l-6 4M7 11l3 8m4-8 3 8',
  mixer: 'M5 3v7m0 4v7m7-18v12m0 4v2m7-18v3m0 4v11M2 10h6v4H2zM9 15h6v4H9zM16 6h6v4h-6z',
  sounds: 'M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4',
  keyboard: 'M3 5h18v14H3zM7 5v8m5-8v8m5-8v8M9 13v6m6-6v6',
  ideas: 'M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7zM9 20h6M10 23h4',
  alongside: 'M3 4h18v16H3zM12 4v16',
  more: 'M4 12h1m6 0h1m6 0h1',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  mira: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0ZM7 10h.01M12 10h.01M17 10h.01',
  project: 'M3 6h7l2 2h9v12H3zM3 6V4h6l2 2',
  export: 'M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7',
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8',
  metronome: 'M8 3h8l5 18H3zM12 16l6-12M8 17h8',
  score: 'M4 3h16v18H4zM7 8h10M7 12h10M7 16h10M13 6v10m0 0c0 3-4 3-4 1s4-3 4-1',
  microphone: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
  signout: 'M9 3H3v18h6m5-14 5 5-5 5m-6-5h14',
}

/** The label remains the control's accessible name and appears on hover/focus. */
export function NavItem({ name, label }: { name: string; label: string }) {
  const touchLabel = ({ arrangement: 'Arrange', alongside: 'Split', microphone: 'Capture', score: 'Score', metronome: 'Click', mira: 'Mira', signout: 'Sign out' } as Record<string,string>)[name] ?? label
  const item = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  useEffect(() => {
    const control = item.current?.parentElement
    if (!control) return
    const hide = () => setPosition(null)
    const show = () => {
      if (matchMedia('(pointer: coarse)').matches || control.matches(':disabled')) return
      const rect = control.getBoundingClientRect()
      const above = rect.bottom + 60 > innerHeight
      setPosition({ left: Math.max(118, Math.min(innerWidth - 118, rect.left + rect.width / 2)), top: above ? rect.top - 8 : rect.bottom + 8, above })
    }
    const focus = () => { if (control.matches(':focus-visible')) show() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    control.addEventListener('pointerenter', show)
    control.addEventListener('pointerleave', hide)
    control.addEventListener('focus', focus)
    control.addEventListener('blur', hide)
    control.addEventListener('click', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', key)
    return () => {
      control.removeEventListener('pointerenter', show)
      control.removeEventListener('pointerleave', hide)
      control.removeEventListener('focus', focus)
      control.removeEventListener('blur', hide)
      control.removeEventListener('click', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', key)
    }
  }, [])
  return <><span ref={item} className="nadi-nav-item"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.more} /></svg><span className="nadi-nav-label">{label}</span><span className="nadi-nav-touch-label" aria-hidden="true">{touchLabel}</span></span>{position && createPortal(<span className="nadi-nav-tooltip" aria-hidden="true" style={{ left: position.left, top: position.top, transform: `translate(-50%, ${position.above ? '-100%' : '0'})` }}>{label}</span>, document.body)}</>
}
