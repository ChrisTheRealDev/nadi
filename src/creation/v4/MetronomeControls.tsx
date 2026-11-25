import type { StudioProject } from './model'
import { pulseAt, type MetronomeSettings } from './metronome'
import './metronome.css'

export function MetronomeControls({ enabled, settings, onEnabled, onSettings, project, tick, active, disabled }: {
  enabled: boolean; settings: MetronomeSettings; onEnabled: (value: boolean) => void; onSettings: (value: MetronomeSettings) => void
  project: StudioProject; tick: number; active: boolean; disabled: boolean
}) {
  const pulse = pulseAt(project, tick)
  return <fieldset className="nadi-metronome" disabled={disabled}><legend>Metronome</legend>
    <button type="button" aria-pressed={enabled} onClick={() => onEnabled(!enabled)}>{enabled ? 'Click on' : 'Click off'}</button>
    <span className="nadi-metronome-beats" aria-label={`${pulse.beats}/${pulse.beatType}${active && enabled ? `, beat ${pulse.beat + 1}` : ''}`}>
      {Array.from({ length: pulse.pulses }, (_, i) => <i key={i} data-active={active && enabled && pulse.beat === i} aria-hidden="true">{i + 1}</i>)}
    </span>
    <label>Click volume<input aria-label="Click volume" type="range" min="0" max="100" value={Math.round(settings.volume * 100)} onChange={e => onSettings({ ...settings, volume: Number(e.target.value) / 100 })} /></label>
    <label><input type="checkbox" checked={settings.accent} onChange={e => onSettings({ ...settings, accent: e.target.checked })} />Accent first beat</label>
    <label>Recording count-in<select value={settings.countInBars} onChange={e => onSettings({ ...settings, countInBars: Number(e.target.value) as 0 | 1 | 2 })}><option value={0}>None</option><option value={1}>1 bar</option><option value={2}>2 bars</option></select></label>
  </fieldset>
}
