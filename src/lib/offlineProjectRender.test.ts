import { describe, expect, it } from 'vitest'
import { countClippedSamples, encodePcm16Wave, measureSamplePeak } from './offlineProjectRender'

function buffer(channels: number[][], sampleRate = 48_000) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
  }
}

describe('offline WAV render utilities', () => {
  it('measures the actual maximum absolute PCM sample rather than RMS', () => {
    expect(measureSamplePeak(buffer([[0.1, -0.82, 0.2], [0.4, -0.3, 0.1]]))).toBeCloseTo(0.82)
    expect(countClippedSamples(buffer([[0.1, -1.01], [1.2, 0.1]]))).toBe(2)
  })

  it('encodes a stereo PCM16 RIFF/WAVE with the expected sample count', () => {
    const wav = encodePcm16Wave(buffer([[0, 1], [0, -1]]))
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(wav.byteLength).toBe(44 + 2 * 2 * 2)
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(48_000)
  })
})
