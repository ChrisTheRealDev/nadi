import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ORCHESTRA_SAMPLES } from './orchestraSamples'
import { ORCHESTRA_IDS } from './sounds'

const directory = new URL('../../../public/audio/orchestra-v1/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex')

function pcmInfo(bytes) {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
  let format, channels, rate, bits, pcm
  for (let cursor = 12; cursor + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(cursor + 4), kind = bytes.toString('ascii', cursor, cursor + 4)
    expect(cursor + 8 + size).toBeLessThanOrEqual(bytes.length)
    if (kind === 'fmt ') { format = bytes.readUInt16LE(cursor + 8); channels = bytes.readUInt16LE(cursor + 10); rate = bytes.readUInt32LE(cursor + 12); bits = bytes.readUInt16LE(cursor + 22) }
    if (kind === 'data') pcm = bytes.subarray(cursor + 8, cursor + 8 + size)
    cursor += 8 + size + size % 2
  }
  expect(format).toBe(1); expect([16, 24, 32]).toContain(bits); expect(channels).toBeGreaterThan(0)
  expect(rate).toBeGreaterThan(0); expect(pcm?.length).toBeGreaterThan(0)
  const stride = bits / 8
  let peak = 0
  for (let index = 0; index < pcm.length; index += stride) peak = Math.max(peak, Math.abs(pcm.readIntLE(index, stride) / 2 ** (bits - 1)))
  return { channels, rate, bits, peak, duration: pcm.length / stride / channels / rate }
}

describe('shipped orchestra source integrity', () => {
  it('covers eleven instruments with exactly 34 unique pinned files within the download budget', () => {
    expect(manifest.samples).toHaveLength(34); expect(ORCHESTRA_SAMPLES).toHaveLength(34)
    expect(new Set(manifest.samples.map(sample => sample.file)).size).toBe(34)
    expect([...new Set(manifest.samples.map(sample => sample.soundId))].sort()).toEqual([...ORCHESTRA_IDS].sort())
    expect(manifest.totalBytes).toBe(manifest.samples.reduce((sum, sample) => sum + sample.bytes, 0))
    expect(manifest.totalBytes).toBeLessThanOrEqual(70_000_000)
    expect(manifest.license).toBe('CC0-1.0')
  })

  it.each(manifest.samples)('$soundId root $rootMidi retains exact source bytes and usable bounded playback metadata', sample => {
    const bytes = readFileSync(new URL(sample.file, directory))
    const runtime = ORCHESTRA_SAMPLES.find(entry => entry.soundId === sample.soundId && entry.rootMidi === sample.rootMidi)
    expect(bytes.length).toBe(sample.bytes); expect(hash(bytes)).toBe(sample.sha256)
    expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(sample.sourceGitBlob)
    const info = pcmInfo(bytes)
    expect(info).toMatchObject({ channels: sample.channels, rate: sample.rate, bits: sample.bits })
    expect(info.duration).toBeCloseTo(sample.duration, 8)
    expect(sample.rootMidi).toBeGreaterThanOrEqual(0); expect(sample.rootMidi).toBeLessThanOrEqual(127)
    expect(Number.isInteger(sample.rootMidi)).toBe(true)
    expect(Number.isFinite(sample.gain)).toBe(true); expect(sample.gain).toBeGreaterThan(0); expect(sample.gain).toBeLessThanOrEqual(64)
    expect(info.peak * sample.gain).toBeGreaterThan(.01); expect(info.peak * sample.gain).toBeLessThanOrEqual(.350001)
    expect(runtime).toMatchObject({ sha256: sample.sha256, gain: sample.gain, url: `/audio/orchestra-v1/${sample.file}` })
    const mapping = readFileSync(new URL(`source-mappings/${sample.sfzFile}`, directory))
    expect(hash(mapping)).toBe(sample.sfzSha256)
    const sourceName = sample.sourcePath.split('/').at(-1)
    const region = mapping.toString().split('<region>').slice(1).find(text => text.match(/sample=([^\r\n]+)/)?.[1].trim() === sourceName)
    expect(Number(region?.match(/pitch_keycenter=(\d+)/)?.[1])).toBe(sample.rootMidi)
    expect(Number(region?.match(/volume=([-\d.]+)/)?.[1])).toBe(sample.sfzVolumeDb)
    if (['harp', 'timpani'].includes(sample.soundId)) {
      expect(runtime.loopStart).toBeUndefined(); expect(runtime.loopEnd).toBeUndefined()
      expect(runtime.loopCrossfadeSeconds).toBeUndefined()
    } else {
      expect(Number.isFinite(runtime.loopStart)).toBe(true); expect(Number.isFinite(runtime.loopEnd)).toBe(true)
      expect(runtime.loopStart).toBeGreaterThan(0); expect(runtime.loopEnd).toBeGreaterThan(runtime.loopStart)
      expect(runtime.loopEnd).toBeLessThan(info.duration)
      expect(runtime.loopCrossfadeSeconds).toBe(sample.loopCrossfadeSeconds)
      expect(runtime.loopCrossfadeSeconds).toBeGreaterThan(0)
      expect(runtime.loopCrossfadeSeconds).toBeLessThanOrEqual(.05)
      expect(runtime.loopCrossfadeSeconds).toBeLessThan(runtime.loopStart)
      expect(runtime.loopCrossfadeSeconds).toBeLessThan(runtime.loopEnd - runtime.loopStart)
    }
  })
})
