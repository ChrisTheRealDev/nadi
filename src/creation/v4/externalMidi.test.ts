import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalMidi } from './externalMidi'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function fixture() {
  vi.useFakeTimers()
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const midi = new ExternalMidi()
  const output = { send: vi.fn() }
  midi.setRoute(output, 'song', 'piano', 3)
  return { clock, midi, output }
}

describe('external MIDI note stream', () => {
  it('shares an overlapping pitch and lets adjacent notes retrigger in timestamp order', () => {
    const { clock, midi, output } = fixture()
    midi.schedule(60, 90, 1025, 1050)
    midi.schedule(60, 80, 1040, 1100)
    midi.schedule(60, 70, 1100, 1125)
    clock.mockReturnValue(1080); midi.flush(1100)
    expect(output.send.mock.calls).toEqual([[[0x92, 60, 90], 1025]])
    clock.mockReturnValue(1200); midi.flush(1201)
    expect(output.send.mock.calls).toEqual([
      [[0x92, 60, 90], 1025], [[0x82, 60, 0], 1100],
      [[0x92, 60, 70], 1100], [[0x82, 60, 0], 1125],
    ])
  })

  it('keeps the pitch sounding when a held key overlaps a queued release', () => {
    const { clock, midi, output } = fixture()
    midi.schedule(60, 90, 1000, 1100)
    midi.flush(1200)
    clock.mockReturnValue(1040)
    expect(midi.noteOn('screen', 60, 70)).toBe(true)
    expect(output.send).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(1140)
    midi.noteOff('screen')
    expect(output.send).toHaveBeenLastCalledWith([0x82, 60, 0], 1140)
  })

  it('clears queued attacks and releases sounding pitches when changing a route', () => {
    const { clock, midi, output } = fixture()
    midi.schedule(60, 90, 1010, 1200)
    midi.schedule(62, 90, 1090, 1200)
    midi.flush(1150)
    clock.mockReturnValue(1030)
    midi.flush(1150)
    const newOutput = { send: vi.fn() }
    midi.setRoute(newOutput, 'song', 'cello', 16)
    expect(output.send.mock.calls).toEqual([[[0x92, 60, 90], 1010], [[0x82, 60, 0], undefined]])
    expect(midi.trackFor('another song')).toBeUndefined()
    midi.noteOn('key', 55, 100)
    midi.stop()
    expect(newOutput.send.mock.calls).toEqual([[[0x9f, 55, 100], 1030], [[0x8f, 55, 0], undefined]])
  })

  it('disables the route if the port fails and never throws into the studio', () => {
    const { midi, output } = fixture()
    output.send.mockImplementation(() => { throw new Error('Port unavailable') })
    expect(midi.noteOn('key', 60, 90)).toBe(false)
    expect(midi.trackFor('song')).toBeUndefined()
    expect(midi.noteOn('another-key', 60, 90)).toBe(false)
    expect(output.send).toHaveBeenCalledOnce()
  })

  it('delivers due notes through a cancellable timer and falls back after a delayed send failure', () => {
    const { clock, midi, output } = fixture()
    const fallback = vi.fn()
    midi.schedule(60, 90, 1010, 1020)
    midi.schedule(62, 90, 1050, 1070, fallback)
    midi.flush(1200)
    expect(output.send).not.toHaveBeenCalled()
    clock.mockReturnValue(1010); vi.advanceTimersByTime(10)
    expect(output.send).toHaveBeenLastCalledWith([0x92, 60, 90], 1010)
    clock.mockReturnValue(1020); vi.advanceTimersByTime(10)
    expect(output.send).toHaveBeenLastCalledWith([0x82, 60, 0], 1020)
    output.send.mockImplementationOnce(() => { throw new Error('Port unavailable') })
    clock.mockReturnValue(1050); vi.advanceTimersByTime(30)
    expect(fallback).toHaveBeenCalledOnce()
    expect(midi.trackFor('song')).toBeUndefined()
  })
})
