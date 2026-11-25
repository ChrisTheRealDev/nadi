import { describe, expect, it } from 'vitest'
import { matchesHelpDestination } from './helpTarget'

describe('destination-aware control reveal', () => {
  it.each(['track-pan', 'track-space', 'track-expression'])('targets %s on only the intended track independently of selected clip', target => {
    const requested = { trackId: 'reed', clipId: 'reed-copy' }
    expect(matchesHelpDestination(target, { trackId: 'oboe' }, requested)).toBe(false)
    expect(matchesHelpDestination(target, {}, requested)).toBe(false)
    expect(matchesHelpDestination(target, { trackId: 'reed' }, requested)).toBe(true)
    expect(matchesHelpDestination(target, { trackId: 'reed', clipId: 'old-copy' }, requested)).toBe(true)
  })
  it.each(['track-pan', 'track-space', 'track-expression'])('scopes %s to the intended track, not its clip', target => {
    const requested = { trackId: 'reed', clipId: 'reed-clip' }
    expect(matchesHelpDestination(target, { trackId: 'reed' }, requested)).toBe(true)
    expect(matchesHelpDestination(target, { trackId: 'reed', clipId: 'other-placement' }, requested)).toBe(true)
    expect(matchesHelpDestination(target, { trackId: 'piano' }, requested)).toBe(false)
    expect(matchesHelpDestination(target, {}, requested)).toBe(false)
  })
  it('rejects another drum row or clip while allowing global controls', () => {
    const requested = { trackId: 'kick', clipId: 'kick-copy' }
    expect(matchesHelpDestination('make-independent', { trackId: 'snare', clipId: 'snare-copy' }, requested)).toBe(false)
    expect(matchesHelpDestination('make-independent', { trackId: 'kick', clipId: 'old-kick-copy' }, requested)).toBe(false)
    expect(matchesHelpDestination('make-independent', requested, requested)).toBe(true)
    expect(matchesHelpDestination('select-chord', {}, requested)).toBe(true)
    expect(matchesHelpDestination('note-body', { trackId: 'other', clipId: 'other' }, requested)).toBe(false)
    expect(matchesHelpDestination('note-resize', requested, requested)).toBe(true)
  })
})
