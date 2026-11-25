import { describe, expect, it } from 'vitest'
import { createProjectContent, projectContentFingerprint } from '../projectModel'
import type { MiraProposal } from './contracts'
import { revalidateMiraPreviewForApply, validateMiraProposal, type MiraProposalContext } from './proposalValidator'

function context(): MiraProposalContext {
  const content = createProjectContent({
    chords: ['Am'],
    melodyEvents: [{ id: 'note-1', pitch: 60, startTick: 0, durationTicks: 480, velocity: 72, trackId: 'melody', patternId: 'melody-a', source: 'draw' }],
    chordLevel: 72,
    melodyLevel: 78,
    reverb: 12,
  })
  return {
    projectId: 'project-AbCd1234',
    revision: 4,
    contentFingerprint: projectContentFingerprint(content),
    content,
    selectedArtifactIds: ['clip-melody-a@note-1'],
    learnerOwnedArtifactIds: ['clip-melody-a@note-1'],
  }
}

const proposal: MiraProposal = {
  kind: 'set-note-velocity',
  targetIds: ['clip-melody-a@note-1'],
  value: 54,
  range: null,
}

describe('Mira proposal validation', () => {
  it('creates a disposable preview and a distinct learner apply command', () => {
    const current = context()
    const reference = { projectId: current.projectId, revision: current.revision, contentFingerprint: current.contentFingerprint }
    const validated = validateMiraProposal(proposal, reference, current)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.preview.disposable).toBe(true)
    expect(validated.preview.applyRequiresFreshValidation).toBe(true)
    expect(current.content.patterns['pattern-melody-a'].notes[0].velocity).toBe(72)
    expect(validated.preview.previewContent.patterns['pattern-melody-a'].notes[0].velocity).toBe(54)
    expect(revalidateMiraPreviewForApply(validated.preview, current)).toEqual({
      ok: true,
      command: { type: 'set-note-velocity', instanceId: 'clip-melody-a@note-1', velocity: 54 },
    })
  })

  it('discards stale revisions, projects, and fingerprints rather than rebasing', () => {
    const current = context()
    const reference = { projectId: current.projectId, revision: current.revision, contentFingerprint: current.contentFingerprint }
    const validated = validateMiraProposal(proposal, reference, current)
    if (!validated.ok) throw new Error('expected valid preview')
    expect(revalidateMiraPreviewForApply(validated.preview, { ...current, revision: 5 })).toEqual({ ok: false, reason: 'stale-revision' })
    expect(validateMiraProposal(proposal, { ...reference, projectId: 'project-ZyXw9876' }, current)).toEqual({ ok: false, reason: 'stale-project' })
    expect(validateMiraProposal(proposal, { ...reference, contentFingerprint: 'fnv1a32-deadbeef' }, current)).toEqual({ ok: false, reason: 'stale-fingerprint' })
  })

  it('requires every target to be selected, learner-owned, and present', () => {
    const current = context()
    const reference = { projectId: current.projectId, revision: current.revision, contentFingerprint: current.contentFingerprint }
    expect(validateMiraProposal(proposal, reference, { ...current, selectedArtifactIds: [] })).toEqual({ ok: false, reason: 'target-not-selected' })
    expect(validateMiraProposal(proposal, reference, { ...current, learnerOwnedArtifactIds: [] })).toEqual({ ok: false, reason: 'target-not-owned' })
    const missing = { ...proposal, targetIds: ['clip-melody-a@note-404'] }
    expect(validateMiraProposal(missing, reference, { ...current, selectedArtifactIds: missing.targetIds, learnerOwnedArtifactIds: missing.targetIds })).toEqual({ ok: false, reason: 'target-missing' })
    const prototypeTarget = { ...proposal, targetIds: ['__proto__'] }
    expect(validateMiraProposal(prototypeTarget, reference, { ...current, selectedArtifactIds: prototypeTarget.targetIds, learnerOwnedArtifactIds: prototypeTarget.targetIds })).toEqual({ ok: false, reason: 'target-missing' })
  })

  it('rejects shared-pattern edits unless every affected instance is learner-owned', () => {
    const current = context()
    current.content.clips.push({
      id: 'clip-melody-b',
      patternId: 'pattern-melody-a',
      laneId: 'lane-melody',
      startTick: 7_680,
      lengthTicks: 1_920,
      offsetTick: 0,
      originClipId: 'clip-melody-a',
    })
    current.contentFingerprint = projectContentFingerprint(current.content)
    const reference = { projectId: current.projectId, revision: current.revision, contentFingerprint: current.contentFingerprint }
    expect(validateMiraProposal(proposal, reference, current)).toEqual({ ok: false, reason: 'shared-pattern-not-owned' })
    current.learnerOwnedArtifactIds = ['clip-melody-a@note-1', 'clip-melody-b@note-1']
    const validated = validateMiraProposal(proposal, reference, current)
    expect(validated.ok).toBe(true)
    if (validated.ok) expect(validated.preview.affectedArtifactIds).toEqual(['clip-melody-a@note-1', 'clip-melody-b@note-1'])
  })

  it('never exposes awards, saves, note creation, code, or hidden arrangement changes', () => {
    const current = context()
    const reference = { projectId: current.projectId, revision: current.revision, contentFingerprint: current.contentFingerprint }
    expect(validateMiraProposal({ ...proposal, kind: 'focus', value: null }, reference, current).ok).toBe(true)
    expect(validateMiraProposal({ ...proposal, value: 999 }, reference, current)).toEqual({ ok: false, reason: 'invalid-value' })
    expect(JSON.stringify(validateMiraProposal(proposal, reference, current))).not.toMatch(/checkpoint|mastery|independent|save|add-note|code/i)
  })
})
