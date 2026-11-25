import { describe, expect, it } from 'vitest'
import { compileArrangement, createStudioProject, decodeStudioProject, SOUND_IDS } from './model'
import { packStudioProject, unpackStudioProject } from './archive'
import { duplicateClip } from './operations'
import { StudioHistory } from './history'
import { studioMidi } from './audio'
import { ACOUSTIC_SAMPLES, isAcousticSound, ORCHESTRA_IDS, SOUNDS, soundById } from './sounds'

const programs = { violin: 40, viola: 41, cello: 42, 'double-bass': 43, flute: 73, clarinet: 71, bassoon: 70, trombone: 57, tuba: 58, harp: 46, timpani: 47 }

function midiEvents(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const events: { tick: number; status: number; data: number[] }[] = []
  let cursor = 14
  const variable = () => { let value = 0, byte: number; do { byte = bytes[cursor++]; value = value * 128 + (byte & 127) } while (byte & 128); return value }
  while (cursor < bytes.length) {
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8
    let tick = 0
    while (cursor < end) {
      tick += variable(); const status = bytes[cursor++]
      if (status === 255) { cursor++; const length = variable(); cursor += length; continue }
      const length = (status & 240) === 192 || (status & 240) === 208 ? 1 : 2
      events.push({ tick, status, data: [...bytes.slice(cursor, cursor + length)] }); cursor += length
    }
  }
  return events
}

describe('playable orchestra project contracts', () => {
  it.each(ORCHESTRA_IDS)('preserves exact %s music through JSON, .nadi and MIDI', soundId => {
    const original = createStudioProject()
    original.patterns[0].notes = [{ id: 'off-grid', pitch: 53, startTick: 73, durationTicks: 2033, velocity: 79 }]
    const project = structuredClone(original); project.tracks[0].soundId = soundId
    expect(project.patterns).toEqual(original.patterns)
    expect(decodeStudioProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(unpackStudioProject(packStudioProject(project))).toEqual(project)
    expect(compileArrangement(project)[0]).toMatchObject({ soundId, pitch: 53, startTick: 73, durationTicks: 2033, velocity: 79 })
    expect(soundById(soundId)).toMatchObject({ sampled: true, program: programs[soundId] })
    expect(midiEvents(studioMidi(project))).toEqual(expect.arrayContaining([
      { tick: 0, status: 192, data: [programs[soundId]] },
      { tick: 73, status: 144, data: [53, 79] },
      { tick: 2106, status: 128, data: [53, 0] },
    ]))
  })

  it.each(ORCHESTRA_IDS)('duplicates %s independently and undoes/redoes without losing its original notes', soundId => {
    const project = createStudioProject(); project.tracks[0].soundId = soundId
    project.patterns[0].notes = [{ id: 'source-note', pitch: 48, startTick: 83, durationTicks: 1173, velocity: 64 }]
    const history = new StudioHistory(); history.push(project, { label: 'Duplicate independently' })
    const duplicate = duplicateClip(project, project.clips[0].id, false, 1920)
    expect(duplicate.patterns).toHaveLength(2)
    expect(duplicate.patterns[1].id).not.toBe(duplicate.patterns[0].id)
    expect(duplicate.patterns[1].notes[0].id).not.toBe('source-note')
    duplicate.patterns[1].notes[0].pitch = 55
    expect(duplicate.patterns[0].notes).toEqual(project.patterns[0].notes)
    const undone = history.undo(duplicate)!
    expect(undone.patterns).toEqual(project.patterns); expect(undone.clips).toEqual(project.clips)
    const redone = history.redo(undone)!
    expect(redone.patterns).toEqual(duplicate.patterns); expect(redone.clips).toEqual(duplicate.clips)
    expect(redone.tracks[0].soundId).toBe(soundId)
  })

  it('gives every acoustic choice real assets, with no omitted or duplicate registry IDs', () => {
    expect(new Set(SOUNDS.map(sound => sound.id)).size).toBe(SOUND_IDS.length)
    expect(SOUNDS.map(sound => sound.id).sort()).toEqual([...SOUND_IDS].sort())
    for (const id of SOUND_IDS.filter(isAcousticSound)) {
      expect(ACOUSTIC_SAMPLES.some(sample => sample.soundId === (id === 'ancient-reed' ? 'oboe' : id)), id).toBe(true)
    }
  })
})
