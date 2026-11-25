import { afterEach, describe, expect, it, vi } from 'vitest'
const hooks = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => undefined | (() => void)) => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) },
}))
import { useMidi } from './useMidi'

afterEach(() => { hooks.cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); vi.unstubAllGlobals() })
function MidiHarness(callbacks: Parameters<typeof useMidi>[0], options: Parameters<typeof useMidi>[1]) { return useMidi(callbacks, options) }
async function setup(pinnedDeviceId?: string | null) {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const input = (id: string) => ({ id, name: id, state: 'connected' as 'connected' | 'disconnected', connection: 'open' as const, onmidimessage: null as null | ((event: { data: Uint8Array; timeStamp: number }) => void) })
  const a = input('a'), b = input('b')
  const access = { inputs: new Map([['a', a], ['b', b]]), onstatechange: null as null | ((event: { port: typeof a }) => void) }
  vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue(access), permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } })
  const callbacks = { onNoteOn: vi.fn(), onNoteOff: vi.fn(), onAllNotesOff: vi.fn(), onControlChange: vi.fn(), onInputDisconnected: vi.fn() }
  const result = MidiHarness(callbacks, { pinnedDeviceId })
  await vi.advanceTimersByTimeAsync(0)
  return { a, b, access, callbacks, result }
}
describe('MIDI source safety', () => {
  it('B12: all-notes-off reports the exact device/channel instead of global panic', async () => {
    const { a, callbacks } = await setup()
    a.onmidimessage?.({ data: new Uint8Array([0xb3, 123, 0]), timeStamp: 123.4 })
    expect(callbacks.onAllNotesOff).toHaveBeenCalledExactlyOnceWith({ channel: 3, atMs: 123.4, inputId: 'a' })
    expect(callbacks.onControlChange).toHaveBeenCalledWith(123, 0, { channel: 3, atMs: 123.4, inputId: 'a' })
  })
  it('pinned input disconnect reports stop and never switches to another keyboard', async () => {
    const { a, b, access, callbacks, result } = await setup('a')
    result.selectDevice('b'); expect(b.onmidimessage).toBeNull()
    a.state = 'disconnected'; access.onstatechange?.({ port: a })
    expect(callbacks.onInputDisconnected).toHaveBeenCalledExactlyOnceWith('a'); expect(b.onmidimessage).toBeNull(); expect(a.onmidimessage).toBeNull()
  })
  it('disconnecting an unused keyboard does not panic the active input', async () => {
    const { b, access, callbacks } = await setup('a')
    b.state = 'disconnected'; access.onstatechange?.({ port: b })
    expect(callbacks.onAllNotesOff).not.toHaveBeenCalled(); expect(callbacks.onInputDisconnected).not.toHaveBeenCalled()
  })
  it('screen-only pinned takes cannot accidentally acquire a MIDI device', async () => {
    const { a, b, result } = await setup(null)
    result.selectDevice('b'); expect(a.onmidimessage).toBeNull(); expect(b.onmidimessage).toBeNull()
  })
  it('never auto-requests MIDI access before permission is confirmed granted, so a later click can still show the real prompt', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const requestMIDIAccess = vi.fn()
    vi.stubGlobal('navigator', { requestMIDIAccess, permissions: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) } })
    MidiHarness({ onNoteOn: vi.fn(), onNoteOff: vi.fn(), onAllNotesOff: vi.fn() }, {})
    await vi.advanceTimersByTimeAsync(2400)
    expect(requestMIDIAccess).not.toHaveBeenCalled()
  })
})
