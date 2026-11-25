import { afterEach, describe, expect, it, vi } from 'vitest'
import { nearestRoot, PianoSampleBank, SALAMANDER_MANIFEST_FINGERPRINT, SALAMANDER_SAMPLE_MANIFEST, velocityLayer } from './pianoSampleBank'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('reduced Salamander browser mapping', () => {
  it('contains seven roots and three distinct recorded velocity layers', () => {
    expect(SALAMANDER_SAMPLE_MANIFEST).toHaveLength(21)
    expect(new Set(SALAMANDER_SAMPLE_MANIFEST.map((entry) => entry.rootMidi)).size).toBe(7)
    expect(new Set(SALAMANDER_SAMPLE_MANIFEST.map((entry) => entry.layer))).toEqual(new Set(['v5', 'v9', 'v13']))
    expect(new Set(SALAMANDER_SAMPLE_MANIFEST.map((entry) => entry.url)).size).toBe(21)
    expect(SALAMANDER_SAMPLE_MANIFEST.every((entry) => /^[a-f0-9]{64}$/.test(entry.expectedSha256))).toBe(true)
    expect(SALAMANDER_MANIFEST_FINGERPRINT).toMatch(/^sha256-[a-f0-9]{64}$/)
  })

  it('chooses a real timbral layer separately from mixer gain', () => {
    expect(velocityLayer(44)).toBe('v5')
    expect(velocityLayer(72)).toBe('v9')
    expect(velocityLayer(104)).toBe('v13')
    expect(nearestRoot(69)).toBe(66)
  })

  it('bounds a hung load and requires an explicit retry after fallback', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const bank = new PianoSampleBank()
    const context = {} as BaseAudioContext
    const first = bank.prepare(context, { timeoutMs: 1_000 })
    expect(bank.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(first).resolves.toBe(false)
    expect(bank.status).toBe('fallback')
    await expect(bank.prepare(context)).resolves.toBe(false)
    const retry = bank.prepare(context, { retry: true, timeoutMs: 1_000 })
    expect(bank.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(retry).resolves.toBe(false)
  })
})
