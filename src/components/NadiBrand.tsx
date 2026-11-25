import { useEffect } from 'react'
/** Original owner-supplied artwork. Viewports adapt it to the UI without altering the source files. */
export function NadiBird({ large = false }: { large?: boolean }) {
  return <span className={`nadi-bird${large ? ' nadi-bird--large' : ''}`} aria-hidden="true"><img src="/assets/brand/nadi-bird.png" alt="" width="1254" height="1254" /></span>
}

export function NadiWordmark() {
  return <svg className="nadi-wordmark" viewBox="170 224 825 270" role="img" aria-label="NADI"><image href="/assets/brand/nadi-banner.png" width="2172" height="724" /></svg>
}

export function NadiBrand({ compact = false }: { compact?: boolean }) {
  useEffect(() => { const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (icon) { icon.type = 'image/svg+xml'; icon.href = '/assets/brand/nadi-favicon.svg' } }, [])
  return <span className={`nadi-brand${compact ? ' nadi-brand--compact' : ''}`} role="img" aria-label="NADI"><NadiBird /></span>
}
