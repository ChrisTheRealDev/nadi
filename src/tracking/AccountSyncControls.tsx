import { useState } from 'react'
import { AccountStudioStore, resolveAccountConflict, type PendingRevision } from './accountStore'
import type { TrackingClient } from './client'
import type { StudioProject } from '../creation/v4/model'

export default function AccountSyncControls({ store, client, currentProject, onOpenRemote, onForkLocal, onMessage, beforeResolve, onResolveFinished, disabled = false }: {
  store: AccountStudioStore; client: TrackingClient; currentProject: StudioProject | null
  onOpenRemote: (project: StudioProject) => void | Promise<void>; onForkLocal: (project: StudioProject) => void | Promise<void>; onMessage: (message: string) => void
  beforeResolve?: () => Promise<void>; onResolveFinished?: () => void; disabled?: boolean
}) {
  const [busy, setBusy] = useState(false), [conflicts, setConflicts] = useState<string[] | null>(null)
  async function inspect() {
    setBusy(true)
    try { const pending = await store.records<PendingRevision>('sync:'); setConflicts([...new Set(pending.filter(r => r.value.state === 'conflict').map(r => r.value.project.id))]) }
    catch { onMessage('Could not read pending revisions. Local work is retained.') }
    finally { setBusy(false) }
  }
  async function resolve(projectId: string, keepCopy: boolean) {
    setBusy(true)
    try {
      await beforeResolve?.()
      await resolveAccountConflict(store, client, projectId, keepCopy)
      const project = await store.load()
      if (project) await (keepCopy ? onForkLocal : onOpenRemote)(project)
      setConflicts(list => list?.filter(id => id !== projectId) ?? [])
      onMessage(keepCopy ? 'Your local version is retained as a separate project. The shared version is also saved.' : 'Shared revision opened. Your prior local version is retained in recovery storage.')
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Conflict not resolved. Both versions are retained.') }
    finally { setBusy(false); onResolveFinished?.() }
  }
  return <div className="account-sync-controls"><button type="button" disabled={busy || disabled} onClick={() => void inspect()}>Review synchronization conflicts</button>
    {conflicts?.length === 0 && <span role="status"> No unresolved conflicts.</span>}
    {conflicts?.map(id => <div key={id}><p>Another session saved {id === currentProject?.id ? currentProject.name : 'this composition'}. Choose which version to continue. Neither version is discarded.</p><button type="button" disabled={busy || disabled} onClick={() => void resolve(id, false)}>Open shared version</button><button type="button" disabled={busy || disabled} onClick={() => void resolve(id, true)}>Keep my work as a separate copy</button></div>)}
  </div>
}
