import { useState } from 'react'
import { Icon } from './Icon'

interface MiraPanelProps {
  title?: string
  message: string
  mood?: 'listening' | 'thinking' | 'encouraging' | 'celebrating' | 'technical'
  compact?: boolean
  actionLabel?: string
  onAction?: () => void
}

export function MiraPanel({
  title,
  message,
  mood = 'listening',
  compact = false,
  actionLabel,
  onAction,
}: MiraPanelProps) {
  const [imageMissing, setImageMissing] = useState(false)
  const imageByMood = {
    listening: 'mira-listening.png',
    thinking: 'mira-thinking.png',
    encouraging: 'mira-encouraging.png',
    celebrating: 'mira-celebrating.png',
    technical: 'mira-gently-correcting.png',
  } as const
  return (
    <aside className={`mira-panel shell-frame ${compact ? 'mira-panel--compact' : ''}`} tabIndex={0}>
      <div className="mira-panel__heading">
        <div>
          <strong>Mira</strong> <span>· AI Studio Partner</span>
        </div>
        <span className="mira-panel__flower" aria-hidden="true">✣</span>
      </div>
      <div className={`mira-panel__portrait mira-panel__portrait--${mood}`}>
        {!imageMissing ? (
          <img
            src={`/assets/mira/${imageByMood[mood]}`}
            alt="Mira, NADI’s AI studio partner"
            onError={() => setImageMissing(true)}
          />
        ) : (
          <div className="mira-fallback" role="img" aria-label="Mira, NADI’s AI studio partner">
            <span className="mira-fallback__hair" />
            <span className="mira-fallback__face">◡</span>
            <span className="mira-fallback__headphones"><Icon name="headphones" /></span>
            <span className="mira-fallback__jacket">M</span>
          </div>
        )}
      </div>
      <div className="mira-panel__copy">
        {title && <div className="eyebrow amber">{title}</div>}
        <p>{message}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" className="button button--quiet mira-panel__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </aside>
  )
}
