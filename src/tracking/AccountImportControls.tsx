import { useState } from 'react'
import { StudioStore } from '../creation/v4/storage'
import { AccountStudioStore } from './accountStore'
import type { StudioProject } from '../creation/v4/model'

export default function AccountImportControls({ store, onImported, onMessage, disabled = false, beforeImport, onImportFinished }: {
  store: AccountStudioStore; onImported: (project: StudioProject) => void | Promise<void>; onMessage: (message: string) => void; disabled?: boolean
  beforeImport?: () => Promise<void>; onImportFinished?: () => void
}) {
  const [projects, setProjects] = useState<StudioProject[] | null>(null), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false)
  async function inspect() {
    const anonymous = new StudioStore(); setBusy(true)
    try { setProjects((await anonymous.listEntries()).healthy) }
    catch { onMessage('Could not read anonymous device projects. Their originals are unchanged.') }
    finally { anonymous.close(); setBusy(false) }
  }
  async function importSelected() {
    const project = projects?.find(p => p.id === selected); if (!project) return
    setBusy(true)
    try {
      await beforeImport?.()
      const copy: StudioProject = { ...structuredClone(project), id: crypto.randomUUID(), revision: 0 }
      await store.save(copy, null)
      await onImported(copy); setSelected(''); setProjects(null)
      onMessage('A complete copy is saved in this account and queued for tutor sharing. The anonymous original is unchanged.')
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Import failed. The anonymous original is unchanged.') }
    finally { setBusy(false); onImportFinished?.() }
  }
  return <div className="account-import-controls"><button type="button" disabled={busy || disabled} onClick={() => void inspect()}>Import a device project into this account</button>
    {projects && <><p>The selected composition, unused parts and finalized Idea Pad originals will be copied into this account and shared with your assigned tutor.</p><select aria-label="Anonymous device project to import" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a device project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="button" disabled={busy || disabled || !selected} onClick={() => void importSelected()}>Copy and share selected project</button>{projects.length === 0 && <span>No anonymous projects were found.</span>}</>}
  </div>
}
