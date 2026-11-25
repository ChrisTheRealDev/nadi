import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioProject } from './model'
import { instrumentProfile } from './instrumentProfiles'
import { analyzePlayability, pitchLabel, PLAYABILITY_LIMITATION, type PerformerMode, type PlayabilityFinding, type PlayabilitySnapshot } from './playability'
import './playability.css'

export interface PlayabilityPanelProps {
  project: StudioProject
  onReveal?: (finding: PlayabilityFinding) => void
  onSnapshot?: (snapshot: PlayabilitySnapshot) => void
  performerModes?: Readonly<Record<string, PerformerMode>>
  onPerformerModeChange?: (trackId: string, mode: PerformerMode) => void
  readOnly?: boolean
}
const DEFAULT_MODES: Readonly<Record<string, PerformerMode>> = Object.freeze({})
export function PlayabilityPanel({ project, onReveal, onSnapshot, performerModes = DEFAULT_MODES, onPerformerModeChange, readOnly = false }: PlayabilityPanelProps) {
  const [local, setLocal] = useState<{ projectId: string; modes: Readonly<Record<string, PerformerMode>> }>({ projectId: project.id, modes: {} })
  const modes = readOnly || onPerformerModeChange ? performerModes : local.projectId === project.id ? local.modes : DEFAULT_MODES
  // Parent transport renders may recreate an equivalent map; those must not starve the debounce.
  const modesKey = JSON.stringify(Object.entries(modes).sort(([a], [b]) => a.localeCompare(b)))
  const [result, setResult] = useState<{ source: StudioProject; modesKey: string; snapshot: PlayabilitySnapshot } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const snapshotCallback = useRef(onSnapshot)
  useEffect(() => { snapshotCallback.current = onSnapshot }, [onSnapshot])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const snapshot = analyzePlayability(project, Object.fromEntries(JSON.parse(modesKey)))
      setResult({ source: project, modesKey, snapshot }); snapshotCallback.current?.(snapshot)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [project, modesKey])
  const current = result?.source === project && result.modesKey === modesKey ? result.snapshot : null
  const findings = current?.findings ?? []
  const problems = findings.filter(finding => finding.severity !== 'information').length
  const display = expanded ? findings : findings.slice(0, 3)
  const activeTracks = useMemo(() => project.tracks.filter(track => project.patterns.some(pattern => pattern.trackId === track.id && pattern.notes.length)), [project.tracks, project.patterns])
  if (!activeTracks.length) return null
  return <section className="playability-panel" aria-label="Mira playability guidance" data-testid="playability-panel">
    <div className="playability-heading"><strong>Mira · Real performers</strong><span role="status" aria-live="polite">{!current ? 'Checking your changes…' : problems ? `${problems} ${problems === 1 ? 'passage issue' : 'passage issues'} to review` : 'No range or single-player overlap warnings'}</span></div>
    {display.map(finding => <article key={finding.id} className={`playability-finding playability-${finding.severity}`} data-rule={finding.rule}>
      <div className="playability-finding-heading"><strong>{finding.trackName} · {finding.title}</strong>{onReveal && <button type="button" onClick={() => onReveal(finding)}>Show notes</button>}</div>
      <p>{finding.explanation}</p>
      <ul>{finding.alternatives.map(alternative => <li key={alternative}>{alternative}</li>)}</ul>
      <details><summary>{finding.affected.length} affected note occurrence{finding.affected.length === 1 ? '' : 's'} · assumptions and reference</summary>
        <p>{instrumentProfile(finding.soundId).assumption}</p>
        <p>{finding.affected.slice(0, 8).map(note => `${pitchLabel(note.pitch)} (${note.clipId ? 'arranged' : 'unplaced part'})`).join(', ')}{finding.affected.length > 8 ? '…' : ''}</p>
        {finding.sources.map(source => <a key={source} href={source} target="_blank" rel="noreferrer">Instrument reference</a>)}
      </details>
    </article>)}
    {findings.length > 3 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : `Show all ${findings.length} findings`}</button>}
    <details className="playability-assumptions"><summary>Performance assumptions</summary><p>{readOnly ? 'These assumptions belong to this saved revision. Ask the student to revise them if needed.' : 'Tell Mira when a part is shared by several players or stays electronic.'} {readOnly || onPerformerModeChange ? '' : 'These choices apply during this studio session.'}</p>
      {activeTracks.map(track => <label key={track.id}>{track.name}<select disabled={readOnly} aria-label={`Performers for ${track.name}`} value={modes[track.id] ?? 'default'} onChange={event => {
        const mode = event.target.value as PerformerMode
        if (onPerformerModeChange) onPerformerModeChange(track.id, mode)
        else setLocal({ projectId: project.id, modes: { ...modes, [track.id]: mode } })
      }}><option value="default">Instrument default</option><option value="solo">One player</option><option value="ensemble">Multiple players</option><option value="electronic">Electronic playback</option></select></label>)}
    </details>
    <p className="playability-limit">{PLAYABILITY_LIMITATION} Suggestions never change your music automatically.</p>
  </section>
}
