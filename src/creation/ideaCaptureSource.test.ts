import { describe, expect, it } from 'vitest'
import { acceptsIdeaCaptureInput } from './ideaCaptureSource'

describe('Idea Pad capture source ownership', () => {
  it('keeps screen-only mode even when MIDI arrives first', () => {
    expect(acceptsIdeaCaptureInput(null, 'midi', 'keyboard-a')).toBe(false)
    expect(acceptsIdeaCaptureInput(null, 'screen')).toBe(true)
  })
  it('accepts only the selected MIDI device, never screen or another device', () => {
    expect(acceptsIdeaCaptureInput('keyboard-a', 'midi', 'keyboard-a')).toBe(true)
    expect(acceptsIdeaCaptureInput('keyboard-a', 'midi', 'keyboard-b')).toBe(false)
    expect(acceptsIdeaCaptureInput('keyboard-a', 'midi')).toBe(false)
    expect(acceptsIdeaCaptureInput('keyboard-a', 'screen')).toBe(false)
  })
})
