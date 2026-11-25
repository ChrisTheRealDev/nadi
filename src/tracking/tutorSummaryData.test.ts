import { describe, expect, it } from 'vitest'
import { createStudioProject } from '../creation/v4/model'
import { buildTutorEvidence, parseTutorEvidence, parseTutorInterpretation, parseTutorSummaryRequest, tutorFactText } from './tutorSummaryData'

describe('deidentified tutor summary evidence', () => {
  it('does not describe an unchanged tempo as a change', () => {
    expect(tutorFactText({ id: 'tempo', values: [90, 90] })).toBe('Tempo remains 90 BPM.')
    expect(tutorFactText({ id: 'tempo', values: [90, 110] })).toBe('Tempo changed from 90 to 110 BPM.')
  })
  it('includes only authored identifiers and counts, omitting names, music, captures and prompts', () => {
    const p = createStudioProject(); p.name = 'Sensitive learner name'; p.tracks[0].name = 'Private title'
    p.ideas = [{ id: 'private', name: 'Private name', createdAt: '2026-09-26T00:00:00.000Z', attachedTick: null, original: { kind: 'text', text: 'Secret words' } }]
    const evidence = buildTutorEvidence(p, undefined, { complete: 2, pending: 1, failed: 0 })
    expect(parseTutorEvidence(evidence)).toEqual(evidence)
    const json = JSON.stringify(evidence)
    for (const text of ['Sensitive', 'Private', 'Secret', p.id, p.tracks[0].id]) expect(json).not.toContain(text)
    expect(evidence.previousRevision).toBeNull()
  })
  it('compares retained note changes and refuses invented or duplicate evidence references', () => {
    const before = createStudioProject(); before.patterns[0].notes = [{ id: 'n', pitch: 60, startTick: 0, durationTicks: 480, velocity: 90 }]
    const after = structuredClone(before); after.revision = 1; after.patterns[0].notes[0].pitch = 62
    const evidence = buildTutorEvidence(after, before)
    expect(evidence.facts.find(f => f.id === 'pitch-changes')?.values).toEqual([1])
    expect(parseTutorInterpretation({ claims: [{ evidenceId: 'pitch-changes', action: 'ask-about-choice' }] }, evidence)).not.toBeNull()
    expect(parseTutorInterpretation({ claims: [{ evidenceId: 'made-up', action: 'ask-about-choice' }] }, evidence)).toBeNull()
    expect(parseTutorInterpretation({ claims: [{ evidenceId: 'pitch-changes', action: 'review-with-performer' }] }, evidence)).toBeNull()
    expect(parseTutorInterpretation({ claims: [{ evidenceId: 'notes', action: 'ask-about-choice', text: 'Student is lazy' }] }, evidence)).toBeNull()
  })
  it('rejects user text, malformed values and comparison claims without earlier evidence', () => {
    const evidence = buildTutorEvidence(createStudioProject())
    expect(parseTutorSummaryRequest({ requestId: 'ok', evidence, name: 'not allowed' })).toBeNull()
    expect(parseTutorEvidence({ ...evidence, facts: [{ id: 'notes', values: ['9'] }] })).toBeNull()
    expect(parseTutorEvidence({ ...evidence, facts: [{ id: 'added-notes', values: [9] }] })).toBeNull()
    expect(parseTutorEvidence({ ...evidence, facts: [{ id: 'notes', values: [-1] }] })).toBeNull()
    expect(parseTutorInterpretation({ claims: [{ evidenceId: 'notes', action: 'ask-about-choice' }, { evidenceId: 'notes', action: 'listen-and-compare' }] }, evidence)).toBeNull()
  })
})
