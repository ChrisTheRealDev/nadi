import type { NadiAppSnapshot } from './projectPersistence'
import { isValidProjectContent, projectContentFingerprint, type ProjectChannelId, type ProjectContent } from './projectModel'
import { SALAMANDER_MANIFEST_FINGERPRINT } from './pianoSampleBank'

const MIDI_CHANNEL: Record<ProjectChannelId, number> = { 'channel-chords': 0, 'channel-melody': 1 }

export interface FrozenProjectExport {
  format: 'nadi-frozen-project-v1'
  frozenAt: string
  project: { id: string; revision: number; contentFingerprint: string }
  renderIdentity: {
    bpm: 90
    meter: '4/4'
    ticksPerBeat: 480
    sampleAssetManifestFingerprint: string
    outputSampleRate: 48_000
    masterGain: 0.22
    voiceReleaseSeconds: 1
    reverb: { kind: 'deterministic-convolution'; impulseSeconds: 1.2; preDelaySeconds: 0 }
  }
  snapshot: NadiAppSnapshot
}

export interface FrozenDownload {
  bytes: Uint8Array
  filename: string
  mimeType: string
  projectId: string
  projectRevision: number
  projectContentFingerprint: string
}

export function createFrozenProjectJson(snapshot: NadiAppSnapshot, now = new Date().toISOString()): FrozenDownload {
  const frozen = clone(snapshot)
  const project = frozen.course.project
  if (!validProjectIdentity(project.id, project.revision) || !isValidProjectContent(project.content)) throw new Error('The frozen project snapshot is invalid.')
  const contentFingerprint = projectContentFingerprint(project.content)
  const exported: FrozenProjectExport = {
    format: 'nadi-frozen-project-v1',
    frozenAt: now,
    project: { id: project.id, revision: project.revision, contentFingerprint },
    renderIdentity: {
      bpm: project.content.bpm,
      meter: project.content.meter,
      ticksPerBeat: project.content.ticksPerBeat,
      sampleAssetManifestFingerprint: SALAMANDER_MANIFEST_FINGERPRINT,
      outputSampleRate: 48_000,
      masterGain: 0.22,
      voiceReleaseSeconds: 1,
      reverb: { kind: 'deterministic-convolution', impulseSeconds: 1.2, preDelaySeconds: 0 },
    },
    snapshot: frozen,
  }
  return {
    bytes: new TextEncoder().encode(`${JSON.stringify(exported, null, 2)}\n`),
    filename: `nadi-${project.id}-r${project.revision}.json`,
    mimeType: 'application/json',
    projectId: project.id,
    projectRevision: project.revision,
    projectContentFingerprint: contentFingerprint,
  }
}

export function createFrozenProjectMidi(content: ProjectContent, projectId: string, projectRevision: number): FrozenDownload {
  const frozen = clone(content)
  if (!validProjectIdentity(projectId, projectRevision) || !isValidProjectContent(frozen)) throw new Error('The frozen project snapshot is invalid.')
  const tracks: Uint8Array[] = [tempoTrack(frozen.lengthTicks)]
  tracks.push(channelTrack(frozen, 'channel-chords', 'NADI Chords'))
  tracks.push(channelTrack(frozen, 'channel-melody', 'NADI Melody'))
  const header = chunk('MThd', Uint8Array.of(0, 1, 0, tracks.length, 1, 0xe0))
  return {
    bytes: concat([header, ...tracks]),
    filename: `nadi-${projectId}-r${projectRevision}.mid`,
    mimeType: 'audio/midi',
    projectId,
    projectRevision,
    projectContentFingerprint: projectContentFingerprint(frozen),
  }
}

interface MidiEvent {
  tick: number
  priority: number
  stableOrder: number
  data: number[]
}

function channelTrack(content: ProjectContent, channelId: ProjectChannelId, name: string): Uint8Array {
  const channel = MIDI_CHANNEL[channelId]
  const events: MidiEvent[] = []
  let stableOrder = 0
  for (const clip of content.clips) {
    const pattern = content.patterns[clip.patternId]
    if (!pattern) continue
    const windowStart = clip.offsetTick
    const windowEnd = clip.offsetTick + clip.lengthTicks
    for (const note of pattern.notes) {
      if (note.channelId !== channelId) continue
      const noteStart = Math.max(note.startTick, windowStart)
      const noteEnd = Math.min(note.startTick + note.durationTicks, windowEnd)
      if (noteEnd <= noteStart) continue
      const absoluteStart = clip.startTick + noteStart - windowStart
      const absoluteEnd = clip.startTick + noteEnd - windowStart
      events.push({ tick: absoluteStart, priority: 2, stableOrder: stableOrder++, data: [0x90 | channel, note.pitch, note.velocity] })
      events.push({ tick: absoluteEnd, priority: 0, stableOrder: stableOrder++, data: [0x80 | channel, note.pitch, 0] })
    }
    for (const controller of pattern.controllerEvents ?? []) {
      if (controller.channelId !== channelId || controller.startTick < windowStart || controller.startTick > windowEnd) continue
      const absoluteTick = Math.min(content.lengthTicks, clip.startTick + controller.startTick - windowStart)
      events.push({ tick: absoluteTick, priority: 1, stableOrder: stableOrder++, data: [0xb0 | channel, controller.controller, controller.value] })
    }
  }
  events.sort((left, right) => left.tick - right.tick || left.priority - right.priority || left.stableOrder - right.stableOrder)
  const body: number[] = [...variableLength(0), 0xff, 0x03, name.length, ...new TextEncoder().encode(name)]
  let priorTick = 0
  for (const event of events) {
    body.push(...variableLength(event.tick - priorTick), ...event.data)
    priorTick = event.tick
  }
  body.push(...variableLength(content.lengthTicks - priorTick), 0xff, 0x2f, 0)
  return chunk('MTrk', Uint8Array.from(body))
}

function tempoTrack(lengthTicks: number): Uint8Array {
  const microsecondsPerQuarter = Math.round(60_000_000 / 90)
  const body = Uint8Array.from([
    0, 0xff, 0x51, 3, (microsecondsPerQuarter >> 16) & 0xff, (microsecondsPerQuarter >> 8) & 0xff, microsecondsPerQuarter & 0xff,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    ...variableLength(lengthTicks), 0xff, 0x2f, 0,
  ])
  return chunk('MTrk', body)
}

function variableLength(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new Error('MIDI delta time is outside the supported range.')
  const bytes = [value & 0x7f]
  let remaining = value >>> 7
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  return bytes
}

function chunk(label: 'MThd' | 'MTrk', body: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + body.length)
  output.set(new TextEncoder().encode(label), 0)
  new DataView(output.buffer).setUint32(4, body.length, false)
  output.set(body, 8)
  return output
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const validProjectIdentity = (id: string, revision: number) => /^(?:project|prj)-[A-Za-z0-9_-]{8,72}$/.test(id) && Number.isInteger(revision) && revision >= 0

export const MIDI_EXPORT_LIMITATION = 'MIDI preserves note, timing, velocity, channel, and CC64 events. It does not carry NADI instruments, effects, mixer gain, or audio fidelity.'
