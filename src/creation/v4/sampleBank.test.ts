import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcousticSampleBank, crossfadeSampleLoop } from './sampleBank'
import { ACOUSTIC_SAMPLES } from './sounds'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const context = { decodeAudioData: vi.fn(async () => ({ length: 44100, numberOfChannels: 1, duration: 1 })) } as unknown as BaseAudioContext
function fakeAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const index = ACOUSTIC_SAMPLES.findIndex(entry => entry.url === url)
    return { ok: true, arrayBuffer: async () => new Uint8Array([index]).buffer }
  }))
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async (_algorithm: string, bytes: ArrayBuffer) => {
    const hex = ACOUSTIC_SAMPLES[new Uint8Array(bytes)[0]].sha256
    return new Uint8Array(hex.match(/../g)!.map(pair => parseInt(pair, 16))).buffer
  }) } })
}
describe('acoustic sample bank', () => {
  it('rejects an empty acoustic manifest instead of declaring readiness', async () => {
    const removed = ACOUSTIC_SAMPLES.filter(entry => entry.soundId === 'cello')
    const positions = removed.map(entry => ACOUSTIC_SAMPLES.indexOf(entry))
    positions.slice().reverse().forEach(index => ACOUSTIC_SAMPLES.splice(index, 1))
    try {
      const bank = new AcousticSampleBank()
      await expect(bank.prepare(context, 'cello')).rejects.toThrow(/no assets registered/)
      expect(bank.status('cello')).toBe('error')
    } finally { removed.forEach((entry, i) => ACOUSTIC_SAMPLES.splice(positions[i], 0, entry)) }
  })
  it('crossfades only the end neighborhood and makes the wrap naturally adjacent', () => {
    const data = Float32Array.from({ length: 10000 }, (_, i) => Math.sin(i * .02))
    const before = data.slice()
    const buffer = { sampleRate: 1000, length: data.length, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer
    crossfadeSampleLoop(buffer, 2, 8, .02)
    expect(data.slice(0, 7980)).toEqual(before.slice(0, 7980))
    expect(data[7999]).toBe(before[1999])
    expect(data.slice(8000)).toEqual(before.slice(8000))
    expect(() => crossfadeSampleLoop(buffer, .001, 8, .02)).toThrow(/Invalid/)
  })
  it('shares exact oboe buffers with Ancient Reed without duplicate requests', async () => {
    fakeAssets()
    const longContext = { decodeAudioData: vi.fn(async () => ({ length: 882000, numberOfChannels: 2, duration: 20 })) } as unknown as BaseAudioContext
    const bank = new AcousticSampleBank()
    await Promise.all([bank.prepare(longContext, 'ancient-reed'), bank.prepare(longContext, 'oboe')])
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(bank.status('ancient-reed')).toBe('ready')
    expect(bank.select('ancient-reed', 65)).toBe(bank.select('oboe', 65))
    expect(bank.select('oboe', 82).rootMidi).toBe(82)
  })
  it.each(['french-horn', 'trumpet'] as const)('loads %s with measured loop metadata and fails closed on missing assets', async id => {
    fakeAssets()
    const longContext = { decodeAudioData: vi.fn(async () => ({ length: 882000, numberOfChannels: 2, duration: 20 })) } as unknown as BaseAudioContext
    const bank = new AcousticSampleBank()
    await bank.prepare(longContext, id)
    expect(bank.status(id)).toBe('ready')
    expect(bank.select(id, 60)).toMatchObject({ rootMidi: 60, loopStart: expect.any(Number), loopEnd: expect.any(Number) })
    expect(fetch).toHaveBeenCalledTimes(id === 'trumpet' ? 5 : 4)
    const failed = new AcousticSampleBank()
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    await expect(failed.prepare(longContext, id)).rejects.toThrow(/Retry sound/)
    expect(failed.status(id)).toBe('error')
    expect(() => failed.select(id, 60)).toThrow(/Load/)
  })
  it('loads only the chosen preset, verifies hashes, chooses nearest pitch, and caches ready buffers', async () => {
    fakeAssets(); const bank = new AcousticSampleBank()
    expect(bank.status('strings')).toBe('idle'); const loading = bank.prepare(context, 'strings'); expect(bank.status('strings')).toBe('loading')
    await loading; expect(fetch).toHaveBeenCalledTimes(5); expect(bank.status('strings')).toBe('ready'); expect(bank.status('plucked-guitar')).toBe('idle')
    expect(bank.select('strings', 70).rootMidi).toBe(69); await bank.prepare(context, 'strings'); expect(fetch).toHaveBeenCalledTimes(5)
  })
  it('rejects corrupt bytes without a synthesized acoustic substitute, and explicit retry recovers', async () => {
    fakeAssets(); vi.mocked(crypto.subtle.digest).mockResolvedValueOnce(new Uint8Array(32).buffer)
    const bank = new AcousticSampleBank(); await expect(bank.prepare(context, 'strings')).rejects.toThrow(/integrity/)
    expect(bank.status('strings')).toBe('error'); expect(() => bank.select('strings', 60)).toThrow(/Load/)
    await expect(bank.prepare(context, 'strings')).rejects.toThrow(/Retry/)
    await bank.prepare(context, 'strings', true); expect(bank.status('strings')).toBe('ready')
  })
  it('times out stalled fetches and allows a fresh retry without stale completion', async () => {
    vi.useFakeTimers(); fakeAssets(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    const bank = new AcousticSampleBank(), load = bank.prepare(context, 'plucked-guitar'); const failed = expect(load).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(12000); await failed; expect(bank.status('plucked-guitar')).toBe('error')
    fakeAssets(); await bank.prepare(context, 'plucked-guitar', true); expect(bank.status('plucked-guitar')).toBe('ready')
  })
})
