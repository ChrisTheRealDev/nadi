import type { EmotiveProject } from './courseProgress'
import { buildProjectPlayback } from './projectAudio'
import { projectContentFingerprint, isValidProjectContent } from './projectModel'
import { PianoSampleBank, SALAMANDER_MANIFEST_FINGERPRINT } from './pianoSampleBank'
import { createDeterministicImpulse } from './toneTransport'

const SAMPLE_RATE = 48_000
const MASTER_GAIN = 0.22
const RELEASE_SECONDS = 1
const IMPULSE_SECONDS = 1.2

export interface FrozenWavExport {
  bytes: Uint8Array
  mimeType: 'audio/wav'
  filename: string
  projectId: string
  projectRevision: number
  projectContentFingerprint: string
  assetManifestFingerprint: string
  sequenceStartTick: number
  sequenceEndTick: number
  sampleRate: number
  peakKind: 'sample-peak'
  peakScope: 'full-render-master'
  samplePeak: number
  samplePeakDbfs: number
  clippedSampleCount: number
}

export async function renderProjectToWav(project: EmotiveProject, startBar = 0, endBar = project.bars): Promise<FrozenWavExport> {
  const frozen = JSON.parse(JSON.stringify(project)) as EmotiveProject
  if (!/^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(frozen.id) || !Number.isInteger(frozen.revision) || !isValidProjectContent(frozen.content)) throw new Error('The frozen project snapshot is invalid.')
  const playback = buildProjectPlayback(frozen, startBar, endBar)
  if (playback.tailSeconds !== RELEASE_SECONDS + IMPULSE_SECONDS) throw new Error('The live and offline render tails do not match.')
  const length = Math.ceil((playback.duration + playback.tailSeconds) * SAMPLE_RATE)
  const context = new OfflineAudioContext(2, length, SAMPLE_RATE)
  const samples = new PianoSampleBank()
  if (!(await samples.prepare(context))) throw new Error('The verified local piano assets could not be decoded; WAV export was not created from a different instrument.')

  const master = context.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(context.destination)
  const reverb = context.createConvolver()
  reverb.buffer = createDeterministicImpulse(context, IMPULSE_SECONDS)
  reverb.connect(master)
  const buses = new Map<string, { input: GainNode; send: GainNode }>()
  Object.entries(frozen.content.channels).forEach(([channelId, channel]) => {
    const input = context.createGain()
    const send = context.createGain()
    input.gain.value = channel.muted ? 0 : channel.gain / 100
    send.gain.value = channel.reverbSend / 100
    input.connect(master)
    input.connect(send)
    send.connect(reverb)
    buses.set(channelId, { input, send })
  })

  playback.notes.forEach((note) => {
    const sample = samples.select(note.note, note.velocity ?? 0.78)
    const bus = buses.get(note.channelId ?? '')
    if (!sample || !bus) throw new Error('The frozen render plan references an unavailable piano voice or channel.')
    const source = context.createBufferSource()
    const voice = context.createGain()
    const velocity = Math.max(0, Math.min(1, note.velocity ?? 0.78))
    source.buffer = sample.buffer
    source.playbackRate.value = 2 ** ((note.note - sample.rootMidi) / 12)
    voice.gain.setValueAtTime(velocity, note.at)
    voice.gain.setValueAtTime(velocity, note.at + note.duration)
    voice.gain.linearRampToValueAtTime(0, note.at + note.duration + RELEASE_SECONDS)
    source.connect(voice)
    voice.connect(bus.input)
    source.start(note.at)
    source.stop(Math.min(playback.duration + playback.tailSeconds, note.at + note.duration + RELEASE_SECONDS))
  })

  const rendered = await context.startRendering()
  const samplePeak = measureSamplePeak(rendered)
  const clippedSampleCount = countClippedSamples(rendered)
  return {
    bytes: encodePcm16Wave(rendered),
    mimeType: 'audio/wav',
    filename: `nadi-${frozen.id}-r${frozen.revision}.wav`,
    projectId: frozen.id,
    projectRevision: frozen.revision,
    projectContentFingerprint: projectContentFingerprint(frozen.content),
    assetManifestFingerprint: SALAMANDER_MANIFEST_FINGERPRINT,
    sequenceStartTick: playback.startTick,
    sequenceEndTick: playback.endTick,
    sampleRate: rendered.sampleRate,
    peakKind: 'sample-peak',
    peakScope: 'full-render-master',
    samplePeak,
    samplePeakDbfs: samplePeak > 0 ? 20 * Math.log10(samplePeak) : -120,
    clippedSampleCount,
  }
}

export function measureSamplePeak(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData'>): number {
  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]))
  }
  return peak
}

export function countClippedSamples(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData'>): number {
  let clipped = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index += 1) if (Math.abs(samples[index]) > 1) clipped += 1
  }
  return clipped
}

export function encodePcm16Wave(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>): Uint8Array {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels))
  const dataSize = buffer.length * channels * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  writeText(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(bytes, 8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeText(bytes, 36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame] ?? 0))
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return bytes
}

function writeText(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index)
}
