import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ACOUSTIC_SAMPLES } from './sounds'

// Node-only asset verification is separate from the browser TypeScript program.
it('ships oboe bytes at fragment-free public URLs with exact manifest hashes', () => {
  for (const entry of ACOUSTIC_SAMPLES.filter(sample => sample.soundId === 'oboe')) {
    expect(entry.url).not.toMatch(/#|%23/i)
    const bytes = readFileSync(new URL(`../../../public${entry.url}`, import.meta.url))
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
  }
})
