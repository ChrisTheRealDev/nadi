export type PianoAssetSet = 'salamander-browser-3layer-v1' | 'tone-synth-fallback-v1'
export type PianoVelocityLayer = 'v5' | 'v9' | 'v13'
export type PianoAssetStatus = 'idle' | 'loading' | 'ready' | 'fallback'

export interface LoadedPianoSample {
  rootMidi: number
  layer: PianoVelocityLayer
  buffer: AudioBuffer
  url: string
}

const ROOTS = [48, 54, 60, 66, 72, 78, 84] as const
const LAYERS = ['v5', 'v9', 'v13'] as const
const ROOT_NAMES: Record<(typeof ROOTS)[number], string> = {
  48: 'C3', 54: 'Fs3', 60: 'C4', 66: 'Fs4', 72: 'C5', 78: 'Fs5', 84: 'C6',
}

const SHA_BY_FILE: Record<string, string> = {
  'C3v5.flac': '739ff6e06c830e0a252708bcca21d143babeb0cf1480ce4ebc58fa8ea67719ef',
  'C3v9.flac': '94b8e18eb2c6cbf28a6497ca6c8e8b08b5ad93528e1799f53903a7b7501cdf05',
  'C3v13.flac': '9ac83c8ca65ed68f5eb87029581741c25e0249674e20e792e778393e602e7b03',
  'Fs3v5.flac': 'aa64b3c1bcbaff4bc6e0246038ffc7fa8bb047dc9d5bdf6f66746f7d03a487eb',
  'Fs3v9.flac': '60550b92468f54d6d6ab7dec3c45b5611b38d6500db88e59b543dc996b8856b6',
  'Fs3v13.flac': '9d375514e85b2007cb5c8c69e1e6b5c6c490864289bc6596b292195968e281d5',
  'C4v5.flac': '2c0c641a32b4d0958c9b1e3a4049dad2c1aea01aa74844d5061ab59033ddc171',
  'C4v9.flac': '512e6c8d114fa700113ffc8b42f71101574499bec2477354295ecceddabf9979',
  'C4v13.flac': 'dfdcdedf982a04e45c6dbd088130aa713b94c59727d75d8a688e7ddabc44ecbd',
  'Fs4v5.flac': 'bcb9fed0973442b2ec681d06a3690676608e2b225e0a17a95cb8782ff0b0f0ff',
  'Fs4v9.flac': 'b3feb5668f614d845dab1ea7d7877c7b6ff45498a1f50476cee90f88d2aaf41d',
  'Fs4v13.flac': 'a313111332287aa1a09a1a89a7d7e92da7a4672a3ef72e5d082531e560f2a805',
  'C5v5.flac': '89bc53b493aee1cacddd60d17057f811e10297b5a67203d302979102592ad25a',
  'C5v9.flac': '72adc6b756ed07454a98ff2c4e54082f7477e07147b8eb4c906d210cc3f68c72',
  'C5v13.flac': 'f0a418b6aa64d15b63d565cfcdab99604f5615539935ac4daeed3a52780db11c',
  'Fs5v5.flac': '2213a775a32eab348bf539be74c4ef9f8e89537315e60b51156c41208bc01754',
  'Fs5v9.flac': '06f95a6014fc9f9a3fec9f786fccdd3d636e27986c76a0294390981df88ac25f',
  'Fs5v13.flac': 'b673dd8e61549962ba3eff1a0cfe0dbfb08bc90797d284302456b1edc1ccff91',
  'C6v5.flac': '2b9646f3956b7e9d50baf573fb5b45b64fee2e5ff6ec56bd9aa40cde914066bf',
  'C6v9.flac': '5804f0e48b9879fa77d719a63bf6be517f6e29e8397828f97a5191080141e160',
  'C6v13.flac': '15dd61cabba1265fb437260cc08f6c738664532df3957a4e5a927e617ce25eec',
}

export const SALAMANDER_MANIFEST_FINGERPRINT = 'sha256-1b3c343e578998caa3ac98d9978c50fb4b0671d18dd7488a20950a8be3885353'

export const SALAMANDER_SAMPLE_MANIFEST = ROOTS.flatMap((rootMidi) => LAYERS.map((layer) => ({
  rootMidi,
  layer,
  url: `/audio/salamander/${ROOT_NAMES[rootMidi]}${layer}.flac`,
  expectedSha256: SHA_BY_FILE[`${ROOT_NAMES[rootMidi]}${layer}.flac`],
})))

export class PianoSampleBank {
  private samples?: Map<string, LoadedPianoSample>
  private loadFlight?: Promise<boolean>
  private loadGeneration = 0
  private currentStatus: PianoAssetStatus = 'idle'

  get assetSet(): PianoAssetSet {
    return this.samples ? 'salamander-browser-3layer-v1' : 'tone-synth-fallback-v1'
  }

  get status(): PianoAssetStatus {
    return this.currentStatus
  }

  prepare(context: BaseAudioContext, options: { timeoutMs?: number; retry?: boolean } = {}): Promise<boolean> {
    if (this.samples) return Promise.resolve(true)
    if (this.loadFlight) return this.loadFlight
    if (this.currentStatus === 'fallback' && !options.retry) return Promise.resolve(false)
    const generation = ++this.loadGeneration
    const controller = new AbortController()
    const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? 25_000))
    this.currentStatus = 'loading'
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
    const loading = this.loadAll(context, controller.signal, generation)
    const timed = new Promise<boolean>((resolve) => {
      timeout = globalThis.setTimeout(() => {
        if (generation === this.loadGeneration) this.loadGeneration += 1
        controller.abort()
        resolve(false)
      }, timeoutMs)
    })
    const flight = Promise.race([loading, timed]).then((ready) => {
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
      this.currentStatus = ready ? 'ready' : 'fallback'
      return ready
    }).finally(() => {
      if (this.loadFlight === flight) this.loadFlight = undefined
    })
    this.loadFlight = flight
    return flight
  }

  select(note: number, normalizedVelocity: number): LoadedPianoSample | undefined {
    if (!this.samples || !Number.isInteger(note) || note < 0 || note > 127 || !Number.isFinite(normalizedVelocity)) return undefined
    const rootMidi = nearestRoot(note)
    const layer = velocityLayer(Math.round(Math.max(0, Math.min(1, normalizedVelocity)) * 127))
    return this.samples.get(sampleKey(rootMidi, layer))
  }

  private async loadAll(context: BaseAudioContext, signal: AbortSignal, generation: number): Promise<boolean> {
    try {
      const decoded = await Promise.all(SALAMANDER_SAMPLE_MANIFEST.map(async (entry) => {
        const response = await fetch(entry.url, { cache: 'force-cache', credentials: 'same-origin', signal })
        if (!response.ok) throw new Error(`Piano asset ${entry.url} returned ${response.status}.`)
        const encoded = await response.arrayBuffer()
        if (await sha256(encoded) !== entry.expectedSha256) throw new Error(`Piano asset ${entry.url} failed its integrity check.`)
        const buffer = await context.decodeAudioData(encoded)
        if (!buffer || buffer.length < 1 || buffer.numberOfChannels < 1) throw new Error(`Piano asset ${entry.url} did not decode.`)
        return { ...entry, buffer }
      }))
      if (generation !== this.loadGeneration || signal.aborted) return false
      this.samples = new Map(decoded.map((sample) => [sampleKey(sample.rootMidi, sample.layer), sample]))
      return true
    } catch {
      if (generation === this.loadGeneration) this.samples = undefined
      return false
    }
  }
}

export function velocityLayer(velocity: number): PianoVelocityLayer {
  if (!Number.isFinite(velocity)) return 'v9'
  if (velocity <= 56) return 'v5'
  if (velocity <= 88) return 'v9'
  return 'v13'
}

export function nearestRoot(note: number): (typeof ROOTS)[number] {
  return ROOTS.reduce((closest, root) => Math.abs(note - root) < Math.abs(note - closest) ? root : closest, ROOTS[0])
}

const sampleKey = (rootMidi: number, layer: PianoVelocityLayer) => `${rootMidi}:${layer}`

async function sha256(value: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable for piano asset verification.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
