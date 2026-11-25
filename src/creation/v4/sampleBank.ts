import { ACOUSTIC_SAMPLES, isAcousticSound } from './sounds'
import { SOUND_LABELS, type SoundId } from './model'

export type SampleStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface LoadedSample { rootMidi: number; buffer: AudioBuffer; loopStart?: number; loopEnd?: number; gain?: number }

/** Smooth only explicitly versioned new loops, never the shipped WAV or legacy presets.
 * The end neighborhood blends toward the pre-start neighborhood so the wrap has
 * the same adjacent samples as the original at loopStart. */
export function crossfadeSampleLoop(buffer: AudioBuffer, start: number, end: number, seconds: number) {
  const first = Math.round(start * buffer.sampleRate), last = Math.round(end * buffer.sampleRate)
  const count = Math.round(seconds * buffer.sampleRate)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > .05 || count < 2 || first < count || last >= buffer.length || last - first < count * 2) throw new Error('Invalid loop crossfade metadata.')
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < count; i++) {
      const weight = i / (count - 1)
      data[last - count + i] = data[last - count + i] * (1 - weight) + data[first - count + i] * weight
    }
  }
}

/** No synthesis fallback for the acoustic presets. Fail closed and allow explicit retry. */
export class AcousticSampleBank {
  private samples = new Map<SoundId, LoadedSample[]>()
  private states = new Map<SoundId, SampleStatus>()
  private flights = new Map<SoundId, Promise<void>>()
  status(id: SoundId): SampleStatus { return this.states.get(id === 'ancient-reed' ? 'oboe' : id) ?? 'idle' }
  async prepare(context: BaseAudioContext, id: SoundId, retry = false): Promise<void> {
    if (!isAcousticSound(id)) return
    if (id === 'ancient-reed') return this.prepare(context, 'oboe', retry)
    if (this.status(id) === 'ready') return
    if (this.flights.has(id)) return this.flights.get(id)
    if (this.status(id) === 'error' && !retry) throw new Error(`${SOUND_LABELS[id]} samples unavailable. Use Retry sound; editing, saving and MIDI still work.`)
    const entries = ACOUSTIC_SAMPLES.filter(sample => sample.soundId === id)
    if (!entries.length) {
      this.states.set(id, 'error')
      throw new Error(`${SOUND_LABELS[id]} samples unavailable: no assets registered. Use Retry sound; editing, saving and MIDI still work.`)
    }
    this.states.set(id, 'loading')
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Sample loading timed out.')) }, 12000) })
    const loading = Promise.all(entries.map(async entry => {
      const response = await fetch(entry.url, { cache: 'force-cache', credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error(`Sample request failed (${response.status}).`)
      const data = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', data)
      const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      if (hash !== entry.sha256) throw new Error('Sample integrity check failed.')
      const buffer = await context.decodeAudioData(data)
      if (!buffer.length || !buffer.numberOfChannels) throw new Error('Sample could not be decoded.')
      if (entry.loopEnd !== undefined && (entry.loopEnd >= buffer.duration || entry.loopStart === undefined || entry.loopStart < 0 || entry.loopStart >= entry.loopEnd)) throw new Error('Sample sustain-loop metadata is invalid.')
      if (entry.gain !== undefined && (!Number.isFinite(entry.gain) || entry.gain <= 0 || entry.gain > 64)) throw new Error('Sample gain metadata is invalid.')
      if (entry.loopCrossfadeSeconds !== undefined) {
        if (entry.loopStart === undefined || entry.loopEnd === undefined) throw new Error('Crossfade requires a valid loop.')
        crossfadeSampleLoop(buffer, entry.loopStart, entry.loopEnd, entry.loopCrossfadeSeconds)
      }
      return { rootMidi: entry.rootMidi, buffer, loopStart: entry.loopStart, loopEnd: entry.loopEnd, gain: entry.gain }
    }))
    const flight = Promise.race([loading, timedOut]).then(samples => {
      this.samples.set(id, samples); this.states.set(id, 'ready')
    }).catch((error: unknown) => {
      controller.abort(); this.states.set(id, 'error')
      throw new Error(`${SOUND_LABELS[id]} samples unavailable. Use Retry sound. ${error instanceof Error ? error.message : ''}`)
    }).finally(() => { if (timer !== undefined) clearTimeout(timer); this.flights.delete(id) })
    this.flights.set(id, flight)
    return flight
  }
  select(id: SoundId, pitch: number): LoadedSample {
    if (id === 'ancient-reed') return this.select('oboe', pitch)
    const samples = this.samples.get(id)
    if (!samples?.length) throw new Error(`Load ${id} samples before playing.`)
    return samples.reduce((best, sample) => Math.abs(sample.rootMidi - pitch) < Math.abs(best.rootMidi - pitch) ? sample : best)
  }
}
