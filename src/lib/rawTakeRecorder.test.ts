import { describe, expect, it } from 'vitest'
import { RawTakeRecorder } from './rawTakeRecorder'

describe('bounded raw take recording', () => {
  it('captures onset, release, velocity, channel, and CC64 only while explicitly open', () => {
    const recorder = new RawTakeRecorder()
    recorder.noteOn(60, 100, 2, 'midi', 90)
    expect(recorder.start('take-1', 'session-6-bar-1', 100, 'open')).toBe(true)
    recorder.noteOn(60, 100, 2, 'midi', 125)
    recorder.sustain(127, 2, 140)
    recorder.noteOff(60, 32, 2, 'midi', 360)
    const take = recorder.stop(400, 'closed')
    recorder.noteOn(64, 80, 1, 'midi', 450)

    expect(take).toEqual({
      id: 'take-1', scope: 'session-6-bar-1', openedAt: 'open', closedAt: 'closed',
      durationMs: 300, endReason: 'user-stop', truncated: false, droppedEventCount: 0,
      timingOrigin: { kind: 'free', countInBars: 0 },
      events: [
        { type: 'note-on', order: 0, atMs: 25, channel: 2, note: 60, velocity: 100, source: 'midi', voiceId: 'voice-1' },
        { type: 'cc64', order: 1, atMs: 40, channel: 2, value: 127, source: 'midi' },
        { type: 'note-off', order: 2, atMs: 260, channel: 2, note: 60, releaseVelocity: 32, source: 'midi', voiceId: 'voice-1', termination: 'observed' },
        { type: 'cc64', order: 3, atMs: 300, channel: 2, value: 0, source: 'midi', termination: 'record-stop' },
      ],
    })
  })

  it('does not overwrite an active attempt', () => {
    const recorder = new RawTakeRecorder()
    expect(recorder.start('take-1', 'attempt', 0)).toBe(true)
    expect(recorder.start('take-2', 'other', 0)).toBe(false)
  })

  it('rejects malformed and pre-start input and marks held notes as record-stop termination', () => {
    const recorder = new RawTakeRecorder()
    expect(recorder.start('take-3', 'attempt', 100)).toBe(true)
    recorder.noteOn(60, 100, 2, 'screen', 99)
    recorder.noteOn(Number.NaN, 100, 2, 'screen', 110)
    recorder.noteOn(64, 90, 2, 'screen', 120)
    expect(recorder.stop(250, 'closed')?.events).toEqual([
      { type: 'note-on', order: 0, atMs: 20, channel: 2, note: 64, velocity: 90, source: 'screen', voiceId: 'voice-1' },
      { type: 'note-off', order: 1, atMs: 150, channel: 2, note: 64, releaseVelocity: 0, source: 'screen', voiceId: 'voice-1', termination: 'record-stop' },
    ])
  })

  it('pairs repeated same-pitch voices FIFO without collapsing ownership', () => {
    const recorder = new RawTakeRecorder()
    recorder.start('take-4', 'attempt', 0)
    recorder.noteOn(60, 90, 0, 'midi', 10, 'port-1')
    recorder.noteOn(60, 80, 0, 'midi', 20, 'port-1')
    recorder.noteOff(60, 12, 0, 'midi', 30, 'port-1')
    const take = recorder.stop(40)
    expect(take?.events.map((event) => event.type === 'cc64' ? undefined : event.voiceId)).toEqual(['voice-1', 'voice-2', 'voice-1', 'voice-2'])
    expect(take?.events.at(-1)).toEqual(expect.objectContaining({ termination: 'record-stop', inputId: 'port-1' }))
  })

  it('bounds retained events and tracked voices while marking overflow honestly', () => {
    const recorder = new RawTakeRecorder()
    recorder.start('take-cap', 'attempt', 0)
    for (let index = 0; index < 10_001; index += 1) recorder.noteOn(60, 80, 0, 'midi', index + 1, 'port-1')
    const take = recorder.stop(20_000)
    expect(take?.events).toHaveLength(10_000)
    expect(take?.truncated).toBe(true)
    expect(take?.droppedEventCount).toBe(10_001)
  })
})
