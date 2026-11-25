import { hydrateRevision, revisionSummary, type SharedRevision } from './sharedReviewData'
import type { TrackingClient } from './client'

export function latestReviewRevision(revisions: SharedRevision[]) {
  return revisions.reduce<SharedRevision | undefined>((latest, revision) => !latest || revision.revision > latest.revision ? revision : latest, undefined)
}

/** A missing older capture must not hide the current, valid composition. */
export async function loadReviewRevision(revision: SharedRevision, revisions: SharedRevision[], client: TrackingClient, actorId: string, learnerId: string) {
  const current = await hydrateRevision(revision.manifest, client, actorId, learnerId)
  const earlier = revisions.find(item => item.revision === revision.revision - 1)
  let previous, warning = ''
  try { previous = earlier ? await hydrateRevision(earlier.manifest, client, actorId, learnerId) : undefined }
  catch { warning = 'The preceding revision could not be loaded. This saved composition is available, but changes cannot be compared.' }
  const summary = previous ? revisionSummary(current, previous) : [
    `Selected revision: ${current.patterns.reduce((count, pattern) => count + pattern.notes.length, 0)} stored notes across ${current.tracks.length} parts, including unused patterns.`,
    warning || 'No immediately preceding revision is available for comparison.',
  ]
  return { current, previous, warning, summary }
}
