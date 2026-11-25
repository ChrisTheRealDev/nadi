import { describe, expect, it } from 'vitest'
import { createInitialCourseProgress } from './courseProgress'
import { TICKS_PER_BAR } from './melodyEvents'
import { applyProjectGraphEdit } from './projectModel'
import { createFrozenProjectJson, createFrozenProjectMidi } from './projectExport'
import { createInitialFirstSoundProgress } from './firstSound'
import { createInitialProgress, defaultSettings } from './progress'

const snapshot = () => {
  const now = '2026-09-05T00:00:00.000Z'
  return {
    session1: createInitialFirstSoundProgress(now), session3: createInitialProgress(now), course: createInitialCourseProgress(now), settings: defaultSettings,
    connections: { audioConfirmed: false, delay: 'unchecked' as const }, rawTakes: [], evidence: { current: [], historical: [] },
  }
}

describe('frozen project exports', () => {
  it('includes the complete snapshot and pinned render identity in JSON', () => {
    const state = snapshot()
    const exported = createFrozenProjectJson(state, '2026-09-05T01:02:03.000Z')
    const parsed = JSON.parse(new TextDecoder().decode(exported.bytes))
    expect(parsed.format).toBe('nadi-frozen-project-v1')
    expect(parsed.project).toEqual({ id: state.course.project.id, revision: 0, contentFingerprint: exported.projectContentFingerprint })
    expect(parsed.snapshot.course.history).toEqual(state.course.history)
    expect(parsed.snapshot.rawTakes).toEqual([])
    expect(parsed.snapshot.evidence).toEqual(state.evidence)
    state.course.project.revision = 99
    expect(parsed.project.revision).toBe(0)
  })

  it('writes 480 PPQ MIDI with leading rests, exact note velocity, CC64, and project-length endings', () => {
    const state = snapshot()
    let content = state.course.project.content
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'late-note', pitch: 69, startTick: 480, durationTicks: 960, velocity: 91, trackId: 'melody', patternId: 'melody-a', source: 'midi' } })
    content = applyProjectGraphEdit(content, { type: 'add-note', event: { id: 'next-note', pitch: 72, startTick: 1440, durationTicks: 480, velocity: 73, trackId: 'melody', patternId: 'melody-a', source: 'midi' } })
    const pattern = content.patterns[content.clips.find((clip) => clip.id === 'clip-melody-a')!.patternId]
    pattern.controllerEvents = [
      { id: 'pedal-down', channelId: 'channel-melody', controller: 64, startTick: 240, value: 127, source: 'midi', termination: 'observed' },
      { id: 'pedal-up', channelId: 'channel-melody', controller: 64, startTick: 1440, value: 0, source: 'midi', termination: 'observed' },
    ]
    const exported = createFrozenProjectMidi(content, state.course.project.id, 7)
    expect(new TextDecoder().decode(exported.bytes.slice(0, 4))).toBe('MThd')
    expect(new DataView(exported.bytes.buffer).getUint16(12, false)).toBe(480)
    expect([...exported.bytes]).toContain(91)
    expect(findSequence(exported.bytes, [0xb1, 64, 127])).toBeGreaterThan(0)
    expect(findSequence(exported.bytes, [0x91, 69, 91])).toBeGreaterThan(0)
    expect(findSequence(exported.bytes, [0x81, 0x70, 0xb1, 64, 127, 0x81, 0x70, 0x91, 69, 91])).toBeGreaterThan(0)
    expect(findSequence(exported.bytes, [0x87, 0x40, 0x81, 69, 0, 0, 0xb1, 64, 0, 0, 0x91, 72, 73])).toBeGreaterThan(0)
    expect(content.lengthTicks).toBe(TICKS_PER_BAR * 8)
  })
})

function findSequence(bytes: Uint8Array, sequence: number[]): number {
  for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    if (sequence.every((value, offset) => bytes[index + offset] === value)) return index
  }
  return -1
}
