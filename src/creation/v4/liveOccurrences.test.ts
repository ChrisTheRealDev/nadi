import { describe, expect, it } from 'vitest'
import { LiveOccurrences } from './liveOccurrences'

describe('live occurrence ownership', () => {
  it('releases repeated notes FIFO and holds separate instances through pedal-up', () => {
    const live = new LiveOccurrences(), scope = { source: 'midi' as const, deviceId: 'keyboard-a', channel: 1 }
    live.controller(scope, 64, 127)
    const first = live.noteOn(scope, 60)
    expect(live.noteOff(scope, 60)).toBeNull()
    const second = live.noteOn(scope, 60)
    expect(second).not.toBe(first)
    expect(live.noteOff(scope, 60)).toBeNull()
    expect(live.controller(scope, 64, 0)).toEqual([first, second])
  })

  it('isolates devices and channels and scopes panic', () => {
    const live = new LiveOccurrences()
    const a = { source: 'midi' as const, deviceId: 'a', channel: 0 }, b = { source: 'midi' as const, deviceId: 'b', channel: 0 }
    const first = live.noteOn(a, 60), second = live.noteOn(b, 60)
    expect(live.controller(a, 123, 0)).toEqual([first])
    expect(live.noteOff(b, 60)).toBe(second)
    expect(live.allNotesOff()).toEqual([])
  })

  it('removes a failed async occurrence without stealing the next matching note-off', () => {
    const live = new LiveOccurrences(), scope = { source: 'midi' as const, deviceId: 'a', channel: 0 }
    const failed = live.noteOn(scope, 60), audible = live.noteOn(scope, 60)
    live.cancel(failed)
    expect(live.noteOff(scope, 60)).toBe(audible)
    expect(live.noteOff(scope, 60)).toBeNull()
  })
})
