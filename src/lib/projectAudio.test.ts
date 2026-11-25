import { describe, expect, it } from 'vitest'
import { createInitialCourseProgress, expectedChords } from './courseProgress'
import { TICKS_PER_BAR, TICKS_PER_BEAT, type MelodyNoteEvent } from './melodyEvents'
import { buildProjectPlayback } from './projectAudio'
import { createProjectContent } from './projectModel'

function event(id: string, pitch: number, startTick: number, durationTicks = TICKS_PER_BEAT, velocity = 72): MelodyNoteEvent {
  return { id, pitch, startTick, durationTicks, velocity, trackId: 'melody', patternId: startTick < 4 * TICKS_PER_BAR ? 'melody-a' : 'melody-b', source: 'draw' }
}

describe('project playback scheduling', () => {
  it('plays only the requested bars and keeps their timing relative to the section', () => {
    const project = createInitialCourseProgress('t0').project
    project.chords = [...expectedChords]
    project.melodyEvents = [
      event('note-1', 77, TICKS_PER_BAR),
      event('note-2', 72, TICKS_PER_BAR * 2 + TICKS_PER_BEAT),
    ]
    project.content = createProjectContent(project)
    const playback = buildProjectPlayback(project, 1, 3)
    const barSeconds = (60 / 90) * 4

    expect(playback.duration).toBeCloseTo(barSeconds * 2)
    expect(playback.notes.some((note) => note.at === 0)).toBe(true)
    expect(Math.max(...playback.notes.map((note) => note.at))).toBeLessThan(barSeconds * 2)
  })

  it('uses learner-authored melody notes rather than a one-note preview', () => {
    const project = createInitialCourseProgress('t0').project
    project.chords = [...expectedChords]
    project.melodyEvents = [
      event('note-1', 69, 0),
      event('note-2', 72, TICKS_PER_BEAT),
      event('note-3', 76, TICKS_PER_BEAT * 2),
      event('note-4', 77, TICKS_PER_BAR),
    ]
    project.content = createProjectContent(project)
    const playback = buildProjectPlayback(project, 0, 4)
    const melodyNotes = playback.notes.filter((note) => note.note >= 69)
    expect(melodyNotes.map((note) => note.note)).toEqual(expect.arrayContaining([69, 72, 76, 77]))
  })

  it('converts exact event ticks, duration, and velocity into playback seconds', () => {
    const project = createInitialCourseProgress('t0').project
    project.melodyEvents = [event('note-1', 74, TICKS_PER_BEAT / 2, TICKS_PER_BEAT * 2, 96)]
    project.content = createProjectContent(project)
    const playback = buildProjectPlayback(project, 0, 1)
    const note = playback.notes.find((scheduled) => scheduled.note === 74)
    expect(note?.at).toBeCloseTo((60 / 90) / 2)
    expect(note?.duration).toBeCloseTo((60 / 90) * 2)
    expect(note?.velocity).toBeCloseTo(96 / 127)
    expect(note?.channelGain).toBeCloseTo(project.melodyLevel / 100)
    expect(note?.channelMuted).toBe(false)
    expect(note?.reverbSend).toBeCloseTo(project.reverb / 100)
  })

  it('derives range and completion tail from canonical content rather than a label', () => {
    const project = createInitialCourseProgress('t0').project
    project.content.lengthTicks = TICKS_PER_BAR * 2
    const playback = buildProjectPlayback(project, 0, 8)
    expect(playback.endTick).toBe(TICKS_PER_BAR * 2)
    expect(playback.duration).toBeCloseTo((60 / 90) * 8)
    expect(playback.tailSeconds).toBeGreaterThan(0)
  })

  it('retains muted-channel events behind a silent bus for live unmute', () => {
    const project = createInitialCourseProgress('t0').project
    project.melodyEvents = [event('note-1', 74, 0)]
    project.content = createProjectContent(project)
    project.content.channels['channel-melody'].muted = true
    const playback = buildProjectPlayback(project, 0, 1)
    expect(playback.notes.find((note) => note.note === 74)?.channelMuted).toBe(true)
  })

  it('keeps the acknowledged 2.2 second tail for dry and muted channels', () => {
    const project = createInitialCourseProgress('t0').project
    project.melodyEvents = [event('note-1', 74, 0)]
    project.content = createProjectContent(project)
    project.content.channels['channel-chords'].reverbSend = 0
    project.content.channels['channel-melody'].reverbSend = 0
    project.content.channels['channel-melody'].muted = true
    const playback = buildProjectPlayback(project, 0, 1)
    expect(playback.tailSeconds).toBe(2.2)
    expect(playback.notes.every((note) => note.reverbSend === 0)).toBe(true)
  })
})
