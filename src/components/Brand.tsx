import { Icon } from './Icon'
import { NadiBrand } from './NadiBrand'
import type { SaveState } from '../lib/projectPersistence'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <NadiBrand compact={compact} />
    </div>
  )
}

export function MidiChip({
  status,
  name,
  onClick,
}: {
  status: string
  name?: string
  onClick: () => void
}) {
  const connected = status === 'connected'
  return (
    <button
      className={`midi-chip ${connected ? 'is-connected' : ''}`}
      type="button"
      onClick={onClick}
      title={name ?? 'Open connection help'}
    >
      <span className="midi-chip__light" />
      {connected ? name ?? 'MIDI connected' : 'MIDI setup'}
    </button>
  )
}

export function Transport({
  onPlay,
  onStop,
  onHome,
  saveState,
}: {
  onPlay: () => void
  onStop: () => void
  onHome: () => void
  saveState: SaveState
}) {
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Not saved'
  return (
    <header className="transport shell-frame">
      <button className="brand-button" type="button" onClick={onHome}>
        <Brand />
        <span className="sr-only">Return home</span>
      </button>
      <div className="transport__controls">
        <button className="icon-button" type="button" onClick={onStop} aria-label="Stop and silence all notes">
          <Icon name="stop" />
        </button>
        <button className="icon-button icon-button--play" type="button" onClick={onPlay} aria-label="Play this pattern">
          <Icon name="play" />
        </button>
        <div className="transport__tempo"><span>90</span> BPM</div>
        <div className="transport__bar">BAR <span>1 · 1</span></div>
        <div className={`transport__save transport__save--${saveState}`} title={saveLabel} aria-label={saveLabel}><Icon name="save" /></div>
      </div>
      <div className="songket-band" aria-hidden="true" />
    </header>
  )
}
