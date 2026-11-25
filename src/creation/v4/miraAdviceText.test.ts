import { describe, expect, it } from 'vitest'
import { readableMiraAdvice } from './miraAdviceText'

describe('beginner-facing Mira positions', () => {
  it('renders exact part-local positions, including off-grid timing, without altering lengths', () => {
    expect(readableMiraAdvice('Drag the note that starts at tick 960, keeping its duration unchanged.')).toBe('Drag the note that starts at bar 1, beat 3, keeping its duration unchanged.')
    expect(readableMiraAdvice('At tick 1980; length 720 ticks.')).toBe('at bar 2, beat 1.125; length 720 ticks.')
    expect(readableMiraAdvice('Start at tick 999999999999999999.')).toBe('Start at tick 999999999999999999.')
  })
})
