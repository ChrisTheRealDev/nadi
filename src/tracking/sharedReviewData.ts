import { decodeStudioProject, type StudioProject } from '../creation/v4/model'
import type { TrackingClient } from './client'
export interface SharedRevision { id: string; revision: number; received_at: string; manifest: unknown }
export interface ReviewThread { id: string; snapshot_id: string; message: string; anchor: Record<string, unknown>; resolved_at: string | null; replies: { id: string; message: string; revision_id: string | null }[] }
export interface SharedWork { projects: { project_id: string; name: string; revision: number; updated_at: string }[]; revisions: SharedRevision[]; exchanges: { request_id: string; prompt: string; response: string; status: string; project_revision: number }[]; threads: ReviewThread[] }
export function parseSharedWork(value: unknown): SharedWork {
  if (!value || typeof value !== 'object') throw new Error('Shared response unavailable.')
  const v = value as SharedWork
  if (![v.projects, v.revisions, v.exchanges, v.threads].every(Array.isArray)) throw new Error('Shared response unavailable.')
  for (const revision of v.revisions) if (typeof revision.id !== 'string' || !Number.isInteger(revision.revision)) throw new Error('Invalid revision response.')
  return v
}
export async function hydrateRevision(manifest: unknown, client: TrackingClient, actorId: string, learnerId: string): Promise<StudioProject> {
  const project = structuredClone(manifest) as StudioProject
  if (!Array.isArray(project.ideas)) throw new Error('Invalid shared composition.')
  for (const idea of project.ideas) {
    if (idea.original.kind !== 'audio') continue
    const original = idea.original as typeof idea.original & { assetHash?: string }
    if (!original.assetHash) throw new Error('Missing recording reference.')
    const capture = await client.capture(actorId, learnerId, original.assetHash)
    const bytes = Uint8Array.from(atob(capture.base64), c => c.charCodeAt(0))
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    if (hash !== original.assetHash || bytes.length !== original.byteLength) throw new Error('Recording integrity mismatch.')
    original.base64 = capture.base64; delete original.assetHash
  }
  return decodeStudioProject(project)
}
/** Musical facts only: no inferred practice time, quality, understanding or misconduct. */
export function revisionSummary(current: StudioProject, previous?: StudioProject): string[] {
  const notes = current.patterns.flatMap(p => p.notes), old = previous?.patterns.flatMap(p => p.notes) ?? []
  if (!previous) return [`First received version: ${notes.length} stored notes across ${current.tracks.length} parts, including unused patterns. No earlier revision is available for comparison.`]
  const oldById = new Map(old.map(n => [n.id, n])), currentIds = new Set(notes.map(n => n.id))
  const added = notes.filter(n => !oldById.has(n.id)).length, removed = old.filter(n => !currentIds.has(n.id)).length
  const rhythm = notes.filter(n => { const p = oldById.get(n.id); return p && (p.startTick !== n.startTick || p.durationTicks !== n.durationTicks) }).length
  const pitches = notes.filter(n => { const p = oldById.get(n.id); return p && p.pitch !== n.pitch }).length
  return [`${added} notes added; ${removed} removed.`, `Rhythm: timing or duration changed for ${rhythm} retained notes.`, `Melody / harmony: pitch changed for ${pitches} retained notes. These counts do not establish musical quality or understanding.`, `Tempo: ${previous.bpm} → ${current.bpm} BPM. Finalized captures: ${previous.ideas.length} → ${current.ideas.length}.`, 'Suggested teaching action: listen to the changed passages and ask the student to explain their choices.']
}
