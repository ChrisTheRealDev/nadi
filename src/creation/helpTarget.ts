export interface HelpDestination { trackId?: string; clipId?: string }

const DESTINATION_TARGETS = new Set(['make-independent', 'pattern-context', 'duplicate-independent', 'repeat-linked', 'delete-clip', 'note-body', 'note-resize'])

/** Never point at a different part merely because it has the same help marker. */
export function matchesHelpDestination(target: string, candidate: HelpDestination, requested?: HelpDestination): boolean {
  if (['track-pan', 'track-space', 'track-expression'].includes(target)) return !requested?.trackId || candidate.trackId === requested.trackId
  if (!DESTINATION_TARGETS.has(target) || !requested) return true
  return (!requested.trackId || candidate.trackId === requested.trackId)
    && (!requested.clipId || candidate.clipId === requested.clipId)
}
