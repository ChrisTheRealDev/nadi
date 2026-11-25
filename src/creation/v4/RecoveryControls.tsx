import { useMemo, useRef, useState } from 'react'
import { packStudioProject, unpackStudioProject } from './archive'
import { createCleanContinuation } from './recovery'
import { fitProjectLength, projectCapacity, removeUnusedPatterns } from './operations'
import type { StudioProject } from './model'
import type { StudioStore } from './storage'
import './recoveryControls.css'

export interface RecoveryControlsProps {
  project: StudioProject
  store: StudioStore
  disabled?: boolean
  onEdit: (project: StudioProject) => boolean
  onContinue: (next: StudioProject) => Promise<boolean>
  onMessage: (message: string) => void
}

function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  document.body.append(anchor)
  try { anchor.click() }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000) }
}

const messageFor = (error: unknown) => error instanceof Error ? error.message : 'This action could not finish. Your project is unchanged.'
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`

/** Optional maintenance controls; nothing here runs simply by opening the panel. */
export function RecoveryControls({ project, store, disabled = false, onEdit, onContinue, onMessage }: RecoveryControlsProps) {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const capacity = useMemo(() => projectCapacity(project), [project]), unavailable = disabled || pending
  const unusedNotes = capacity.unusedPatterns.reduce((total, part) => total + part.notes, 0)
  const removeUnused = () => {
    if (disabled || busy.current || !capacity.unusedPatterns.length) return
    if (!window.confirm(`Remove ${capacity.unusedPatterns.length} unused parts (${unusedNotes} stored notes)? These parts have no clips in your song. This is undoable; original captures are preserved.`)) return
    try {
      if (onEdit(removeUnusedPatterns(project))) onMessage(`Removed ${capacity.unusedPatterns.length} unused parts. Undo restores them. Original captures are unchanged.`)
    } catch (error) { onMessage(messageFor(error)) }
  }
  const fitLength = () => {
    if (disabled || busy.current) return
    try {
      const next = fitProjectLength(project)
      if (next.bars === project.bars) { onMessage(`The project already needs ${project.bars} bars to preserve its clips, note tails, library parts and original attachments. Use an export range for a shorter audio file.`); return }
      if (!window.confirm(`Shorten the project from ${project.bars} to ${next.bars} bars? All clips, sustained notes, unused library parts and original attachments are preserved. Empty trailing bars will be removed. Undo is available.`)) return
      if (onEdit(next)) onMessage(`Project fitted to ${next.bars} bars without removing musical data. Undo restores the previous length.`)
    } catch (error) { onMessage(messageFor(error)) }
  }
  const continueClean = async () => {
    if (disabled || busy.current) return
    if (!window.confirm('Download a full .nadi backup, then open a separate clean continuation? The new copy keeps your instruments and arrangement but starts with an empty Idea Pad. Your source project and its originals remain unchanged. Check that the backup appears in your downloads.')) return
    busy.current = true; setPending(true)
    try {
      const snapshot = structuredClone(project), bytes = packStudioProject(snapshot)
      const verified = unpackStudioProject(bytes)
      if (JSON.stringify(verified) !== JSON.stringify(snapshot)) throw new Error('The backup could not be verified. No continuation was created.')
      const next = createCleanContinuation(snapshot)
      const filename = `${snapshot.name.replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 80) || 'NADI'}-full-backup.nadi`
      download(bytes, filename, 'application/octet-stream')
      const opened = await onContinue(next)
      onMessage(opened
        ? 'Clean continuation opened. Your source project and originals remain intact. Full backup download requested—check your browser downloads; the app cannot confirm where your browser saved it.'
        : 'Full backup download requested. The continuation was not opened; your current project remains here.')
    } catch (error) { onMessage(messageFor(error)) }
    finally { busy.current = false; setPending(false) }
  }
  const backupLegacy = async () => {
    if (disabled || busy.current) return
    busy.current = true; setPending(true)
    try {
      const raw = await store.recoveryCopy(project.id)
      if (raw === undefined) { onMessage('This project has no pre-v4 recovery copy. Save a full .nadi backup instead.'); return }
      download(new TextEncoder().encode(JSON.stringify(raw, null, 2)), 'NADI-pre-v4-recovery.json', 'application/json')
      onMessage('Pre-upgrade recovery JSON download requested. Import it using the project/recovery file picker to restore a separate copy.')
    } catch (error) { onMessage(messageFor(error)) }
    finally { busy.current = false; setPending(false) }
  }
  return <details className="v4-recovery-controls" data-mira-target="project-recovery">
    <summary>Project care <span>· {capacity.storedNotes.toLocaleString()} stored notes</span></summary>
    <div className="v4-recovery-content">
      <dl aria-label="Project capacity">
        <div><dt>Tracks</dt><dd>{capacity.tracks} / {capacity.trackLimit}</dd></div>
        <div><dt>Stored notes</dt><dd>{capacity.storedNotes.toLocaleString()} / {capacity.noteLimit.toLocaleString()}</dd></div>
        <div><dt>Played notes</dt><dd>{capacity.expandedNotes.toLocaleString()} / {capacity.noteLimit.toLocaleString()}</dd></div>
        <div><dt>Project data</dt><dd>{sizeLabel(capacity.projectBytes)} / {sizeLabel(capacity.byteLimit)}</dd></div>
        <div><dt>Original captures</dt><dd>{capacity.originals} / {capacity.originalLimit}</dd></div>
        <div><dt>Original MIDI events</dt><dd>{capacity.originalEvents.toLocaleString()} / {capacity.originalEventLimit.toLocaleString()}</dd></div>
        <div><dt>Original audio</dt><dd>{sizeLabel(capacity.originalAudioBytes)} / {sizeLabel(capacity.originalAudioByteLimit)}</dd></div>
        <div><dt>Project length</dt><dd>{capacity.bars} / {capacity.barLimit} bars</dd></div>
      </dl>
      <p>Stored notes include unused parts; played notes count every clip occurrence. Limits protect this browser, not a subscription tier.</p>
      {capacity.unusedPatterns.length > 0 && <details className="v4-unused-list"><summary>{capacity.unusedPatterns.length} unused parts · {unusedNotes.toLocaleString()} notes</summary><ul>{capacity.unusedPatterns.map(part => <li key={part.id}>{part.name} · {part.notes.toLocaleString()} notes</li>)}</ul></details>}
      <div className="v4-recovery-actions">
        <button type="button" disabled={unavailable || !capacity.unusedPatterns.length} onClick={removeUnused}>Remove unused parts</button>
        <button type="button" disabled={unavailable} onClick={fitLength}>Fit project length</button>
        <button type="button" disabled={unavailable} onClick={() => void continueClean()}>Back up and continue clean copy</button>
        <button type="button" disabled={unavailable} onClick={() => void backupLegacy()}>Download pre-upgrade recovery</button>
      </div>
      <p>Undo and Redo are available during this session only, within the history limit. Reload clears history. Download .nadi to keep a portable backup.</p>
      {pending && <p role="status">Preparing recovery action…</p>}
    </div>
  </details>
}
