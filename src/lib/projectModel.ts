import {
  sortMelodyEvents,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type MelodyNoteEvent,
} from './melodyEvents'

export type ProjectChannelId = 'channel-chords' | 'channel-melody'
export type ProjectLaneId = 'lane-chords' | 'lane-melody'

export interface ProjectPatternNote {
  id: string
  channelId: ProjectChannelId
  pitch: number
  startTick: number
  durationTicks: number
  velocity: number
  source: MelodyNoteEvent['source']
  originNoteId?: string
  timingInferred?: boolean
}

export interface ProjectPatternControllerEvent {
  id: string
  channelId: ProjectChannelId
  controller: 64
  startTick: number
  value: number
  source: 'midi' | 'derived'
  originControllerEventId?: string
  termination?: 'observed' | 'record-stop'
}

export interface ProjectPattern {
  id: string
  channelId: ProjectChannelId
  name: string
  lengthTicks: number
  notes: ProjectPatternNote[]
  controllerEvents?: ProjectPatternControllerEvent[]
  originPatternId?: string
  timingBasis?: 'authored' | 'legacy-full-bar-assignment'
}

export interface PlaylistClip {
  id: string
  patternId: string
  laneId: ProjectLaneId
  startTick: number
  lengthTicks: number
  offsetTick: number
  originClipId?: string
}

export interface ProjectChannel {
  id: ProjectChannelId
  instrumentDestination: 'piano'
  mixerDestination: 'mixer-chords' | 'mixer-melody'
  gain: number
  muted: boolean
  reverbSend: number
}

export interface ProjectLane {
  id: ProjectLaneId
  channelId: ProjectChannelId
  name: string
  order: number
}

export interface ProjectContent {
  schemaVersion: 3
  ticksPerBeat: 480
  bpm: 90
  meter: '4/4'
  lengthTicks: number
  channels: Record<ProjectChannelId, ProjectChannel>
  lanes: Record<ProjectLaneId, ProjectLane>
  patterns: Record<string, ProjectPattern>
  clips: PlaylistClip[]
}

export interface ProjectCommand {
  id: string
  label: string
  createdAt: string
  before: ProjectContent
  after: ProjectContent
}

export interface ProjectCommandHistory {
  past: ProjectCommand[]
  future: ProjectCommand[]
  nextCommandId: number
}

export interface ProjectProjection {
  chords: string[]
  melodyEvents: MelodyNoteEvent[]
  chordLevel: number
  melodyLevel: number
  reverb: number
}

interface LegacyProjectShape extends ProjectProjection {
  content?: ProjectContent
}

const chordPitches: Record<string, number[]> = {
  Am: [57, 60, 64],
  F: [53, 57, 60],
  C: [60, 64, 67],
  G: [55, 59, 62],
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9._:?-]{1,80}$/.test(value)

function collisionFreeId(requested: string, used: Set<string>): string {
  const base = requested.replace(/[^a-zA-Z0-9._:?-]/g, (character) => `-${character.codePointAt(0)?.toString(16)}-`).slice(0, 72) || 'item'
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base.slice(0, 68)}-${suffix++}`
  used.add(candidate)
  return candidate
}

export function cloneProjectContent(content: ProjectContent): ProjectContent {
  return {
    ...content,
    channels: {
      'channel-chords': { ...content.channels['channel-chords'] },
      'channel-melody': { ...content.channels['channel-melody'] },
    },
    lanes: {
      'lane-chords': { ...content.lanes['lane-chords'] },
      'lane-melody': { ...content.lanes['lane-melody'] },
    },
    patterns: Object.fromEntries(Object.entries(content.patterns).map(([id, pattern]) => [
      id,
      { ...pattern, notes: pattern.notes.map((note) => ({ ...note })), controllerEvents: pattern.controllerEvents?.map((event) => ({ ...event })) },
    ])),
    clips: content.clips.map((clip) => ({ ...clip })),
  }
}

export function projectContentFingerprint(content: ProjectContent): string {
  const serialized = JSON.stringify(content)
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createProjectContent(project?: Partial<ProjectProjection>): ProjectContent {
  const channels: ProjectContent['channels'] = {
    'channel-chords': {
      id: 'channel-chords',
      instrumentDestination: 'piano',
      mixerDestination: 'mixer-chords',
      gain: clamp(project?.chordLevel ?? 72, 0, 100),
      muted: false,
      reverbSend: clamp(project?.reverb ?? 12, 0, 40),
    },
    'channel-melody': {
      id: 'channel-melody',
      instrumentDestination: 'piano',
      mixerDestination: 'mixer-melody',
      gain: clamp(project?.melodyLevel ?? 78, 0, 100),
      muted: false,
      reverbSend: clamp(project?.reverb ?? 12, 0, 40),
    },
  }
  const content: ProjectContent = {
    schemaVersion: 3,
    ticksPerBeat: TICKS_PER_BEAT,
    bpm: 90,
    meter: '4/4',
    lengthTicks: TICKS_PER_BAR * 8,
    channels,
    lanes: {
      'lane-chords': { id: 'lane-chords', channelId: 'channel-chords', name: 'Chords', order: 0 },
      'lane-melody': { id: 'lane-melody', channelId: 'channel-melody', name: 'Melody', order: 1 },
    },
    patterns: {},
    clips: [],
  }
  return projectContentFromProjection({
    chords: project?.chords ?? [],
    melodyEvents: project?.melodyEvents ?? [],
    chordLevel: channels['channel-chords'].gain,
    melodyLevel: channels['channel-melody'].gain,
    reverb: channels['channel-melody'].reverbSend,
  }, content)
}

export function projectContentFromProjection(
  projection: ProjectProjection,
  base?: ProjectContent,
  options: { shareSecondMelodyClip?: boolean } = {},
): ProjectContent {
  const content = base ? cloneProjectContent(base) : createEmptyContent(projection)
  content.channels['channel-chords'].gain = clamp(projection.chordLevel, 0, 100)
  content.channels['channel-melody'].gain = clamp(projection.melodyLevel, 0, 100)
  content.channels['channel-chords'].reverbSend = clamp(projection.reverb, 0, 40)
  content.channels['channel-melody'].reverbSend = clamp(projection.reverb, 0, 40)
  content.patterns = {}
  content.clips = []

  projection.chords.slice(0, 8).forEach((chord, bar) => {
    if (!chordPitches[chord]) return
    const patternId = `chord-${chord.toLowerCase()}`
    if (!content.patterns[patternId]) {
      content.patterns[patternId] = {
        id: patternId,
        channelId: 'channel-chords',
        name: chord,
        lengthTicks: TICKS_PER_BAR,
        notes: chordPitches[chord].map((pitch, index) => ({
          id: `${patternId}-note-${index + 1}`,
          channelId: 'channel-chords',
          pitch,
          startTick: 0,
          durationTicks: TICKS_PER_BAR,
          velocity: 72,
          source: 'legacy',
        })),
        timingBasis: 'legacy-full-bar-assignment',
      }
    }
    content.clips.push({
      id: `clip-chord-${bar + 1}`,
      patternId,
      laneId: 'lane-chords',
      startTick: bar * TICKS_PER_BAR,
      lengthTicks: TICKS_PER_BAR,
      offsetTick: 0,
    })
  })

  const first = projection.melodyEvents.filter((event) => event.startTick < TICKS_PER_BAR * 4)
  const second = projection.melodyEvents.filter((event) => event.startTick >= TICKS_PER_BAR * 4)
  const melodyAliases = new Map<string, string>()
  if (first.length) {
    content.patterns['pattern-melody-a'] = melodyPattern('pattern-melody-a', 'Melody A', first, 0, melodyAliases)
    content.clips.push({
      id: 'clip-melody-a', patternId: 'pattern-melody-a', laneId: 'lane-melody',
      startTick: 0, lengthTicks: TICKS_PER_BAR * 4, offsetTick: 0,
    })
  }
  if (second.length) {
    if (options.shareSecondMelodyClip && first.length) {
      content.clips.push({
        id: 'clip-melody-b', patternId: 'pattern-melody-a', laneId: 'lane-melody',
        startTick: TICKS_PER_BAR * 4, lengthTicks: TICKS_PER_BAR * 4, offsetTick: 0,
        originClipId: 'clip-melody-a',
      })
    } else {
      content.patterns['pattern-melody-b'] = melodyPattern('pattern-melody-b', 'Melody A′', second, TICKS_PER_BAR * 4, melodyAliases)
      content.patterns['pattern-melody-b'].originPatternId = first.length ? 'pattern-melody-a' : undefined
      content.clips.push({
        id: 'clip-melody-b', patternId: 'pattern-melody-b', laneId: 'lane-melody',
        startTick: TICKS_PER_BAR * 4, lengthTicks: TICKS_PER_BAR * 4, offsetTick: 0,
        originClipId: first.length ? 'clip-melody-a' : undefined,
      })
    }
  }
  return content
}

function createEmptyContent(projection: ProjectProjection): ProjectContent {
  return {
    schemaVersion: 3,
    ticksPerBeat: TICKS_PER_BEAT,
    bpm: 90,
    meter: '4/4',
    lengthTicks: TICKS_PER_BAR * 8,
    channels: {
      'channel-chords': { id: 'channel-chords', instrumentDestination: 'piano', mixerDestination: 'mixer-chords', gain: clamp(projection.chordLevel, 0, 100), muted: false, reverbSend: clamp(projection.reverb, 0, 40) },
      'channel-melody': { id: 'channel-melody', instrumentDestination: 'piano', mixerDestination: 'mixer-melody', gain: clamp(projection.melodyLevel, 0, 100), muted: false, reverbSend: clamp(projection.reverb, 0, 40) },
    },
    lanes: {
      'lane-chords': { id: 'lane-chords', channelId: 'channel-chords', name: 'Chords', order: 0 },
      'lane-melody': { id: 'lane-melody', channelId: 'channel-melody', name: 'Melody', order: 1 },
    },
    patterns: {}, clips: [],
  }
}

function melodyPattern(id: string, name: string, events: readonly MelodyNoteEvent[], offset: number, aliases = new Map<string, string>()): ProjectPattern {
  const used = new Set<string>()
  const originAliases = new Map(aliases)
  const allocated = events.map((event) => {
    const raw = event.id.replace(/^clip-melody-[ab]@/, '')
    const next = collisionFreeId(raw, used)
    aliases.set(event.id, next)
    aliases.set(raw, next)
    return next
  })
  return {
    id,
    channelId: 'channel-melody',
    name,
    lengthTicks: TICKS_PER_BAR * 4,
    notes: events.map((event, index) => ({
      id: allocated[index],
      channelId: 'channel-melody',
      pitch: event.pitch,
      startTick: event.startTick - offset,
      durationTicks: event.durationTicks,
      velocity: event.velocity,
      source: event.source,
      ...(event.originId ? { originNoteId: originAliases.get(event.originId) ?? originAliases.get(event.originId.split('@').at(-1) ?? '') ?? collisionFreeId(event.originId, new Set()) } : {}),
      ...(event.timingInferred ? { timingInferred: true } : {}),
    })),
  }
}

export function projectProjectionFromContent(content: ProjectContent): ProjectProjection {
  const chords: string[] = []
  content.clips
    .filter((clip) => content.patterns[clip.patternId]?.notes.some((note) => note.channelId === 'channel-chords'))
    .forEach((clip) => {
      const bar = Math.floor(clip.startTick / TICKS_PER_BAR)
      const pattern = content.patterns[clip.patternId]
      const pitches = pattern?.notes
        .filter((note) => note.channelId === 'channel-chords' && note.startTick === clip.offsetTick)
        .map((note) => note.pitch)
        .sort((a, b) => a - b)
      const chord = Object.entries(chordPitches).find(([, expected]) =>
        expected.length === pitches?.length && expected.every((pitch, index) => pitch === pitches[index]))?.[0]
      if (bar >= 0 && bar < 8 && chord) chords[bar] = chord
    })
  const melodyEvents: MelodyNoteEvent[] = []
  content.clips
    .filter((clip) => content.patterns[clip.patternId]?.notes.some((note) => note.channelId === 'channel-melody'))
    .forEach((clip) => {
      const pattern = content.patterns[clip.patternId]
      if (!pattern) return
      pattern.notes.filter((note) => note.channelId === 'channel-melody').forEach((note) => {
        const visibleStart = Math.max(note.startTick, clip.offsetTick)
        const visibleEnd = Math.min(note.startTick + note.durationTicks, clip.offsetTick + clip.lengthTicks)
        if (visibleEnd <= visibleStart) return
        const absoluteStart = clip.startTick + visibleStart - clip.offsetTick
        const isSecond = clip.startTick >= TICKS_PER_BAR * 4
        melodyEvents.push({
          id: `${clip.id}@${note.id}`,
          pitch: note.pitch,
          startTick: absoluteStart,
          durationTicks: visibleEnd - visibleStart,
          velocity: note.velocity,
          trackId: 'melody',
          patternId: isSecond ? 'melody-b' : 'melody-a',
          source: isSecond && clip.patternId === 'pattern-melody-a' ? 'duplicate' : note.source,
          ...(isSecond ? { originId: `clip-melody-a@${note.originNoteId ?? note.id}` } : {}),
          ...(note.timingInferred ? { timingInferred: true } : {}),
        })
      })
    })
  return {
    chords,
    melodyEvents: sortMelodyEvents(melodyEvents),
    chordLevel: content.channels['channel-chords'].gain,
    melodyLevel: content.channels['channel-melody'].gain,
    reverb: content.channels['channel-melody'].reverbSend,
  }
}

export function ensureCanonicalProject<T extends LegacyProjectShape>(project: T): T & { content: ProjectContent } {
  if (Object.hasOwn(project, 'content') && !isValidProjectContent(project.content)) {
    throw new Error('Invalid canonical project content')
  }
  const content = project.content ? cloneProjectContent(project.content) : createProjectContent(project)
  return { ...project, ...projectProjectionFromContent(content), content }
}

export function appendProjectCommand(
  history: ProjectCommandHistory,
  label: string,
  before: ProjectContent,
  after: ProjectContent,
  now: string,
): ProjectCommandHistory {
  const command: ProjectCommand = {
    id: `command-${history.nextCommandId}`,
    label,
    createdAt: now,
    before: cloneProjectContent(before),
    after: cloneProjectContent(after),
  }
  return { past: [...history.past, command].slice(-100), future: [], nextCommandId: history.nextCommandId + 1 }
}

export function isValidProjectContent(value: unknown): value is ProjectContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const content = value as Partial<ProjectContent>
  if (content.schemaVersion !== 3 || content.ticksPerBeat !== 480 || content.bpm !== 90 || content.meter !== '4/4' || typeof content.lengthTicks !== 'number' || ![TICKS_PER_BAR * 2, TICKS_PER_BAR * 8].includes(content.lengthTicks)) return false
  if (!isPlainRecord(content.channels) || !isPlainRecord(content.lanes) || !isPlainRecord(content.patterns) || !Array.isArray(content.clips) || content.clips.length > 256) return false
  const channelEntries = Object.entries(content.channels)
  if (channelEntries.length !== 2) return false
  if (!channelEntries.every(([key, channel]) => isPlainRecord(channel) && key === channel.id &&
    ['channel-chords', 'channel-melody'].includes(key) && channel.instrumentDestination === 'piano' &&
    channel.mixerDestination === (key === 'channel-chords' ? 'mixer-chords' : 'mixer-melody') &&
    isFiniteNumber(channel.gain, 0, 100) && typeof channel.muted === 'boolean' && isFiniteNumber(channel.reverbSend, 0, 40))) return false
  const laneEntries = Object.entries(content.lanes)
  if (laneEntries.length !== 2 || !laneEntries.every(([key, lane]) => isPlainRecord(lane) && ['lane-chords', 'lane-melody'].includes(key) && key === lane.id && validId(lane.id) &&
    ['channel-chords', 'channel-melody'].includes(String(lane.channelId)) && typeof lane.name === 'string' &&
    Number.isInteger(lane.order) && Number(lane.order) >= 0 && Number(lane.order) < 32)) return false
  const patterns = content.patterns as Record<string, ProjectPattern>
  if (Object.keys(patterns).length > 256 || !Object.entries(patterns).every(([key, pattern]) => Boolean(
    isPlainRecord(pattern) && validId(pattern.id) && key === pattern.id &&
    ['channel-chords', 'channel-melody'].includes(pattern.channelId) && typeof pattern.name === 'string' && pattern.name.length <= 120 &&
    Number.isInteger(pattern.lengthTicks) && pattern.lengthTicks > 0 &&
    Array.isArray(pattern.notes) && pattern.notes.length <= 512 && new Set(pattern.notes.map((note) => isPlainRecord(note) ? note.id : undefined)).size === pattern.notes.length && pattern.notes.every((note) =>
      Boolean(isPlainRecord(note) && validId(note.id) && ['channel-chords', 'channel-melody'].includes(String(note.channelId)) &&
        Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127 &&
        Number.isInteger(note.startTick) && note.startTick >= 0 && note.startTick < pattern.lengthTicks &&
        Number.isInteger(note.durationTicks) && note.durationTicks > 0 && note.startTick + note.durationTicks <= pattern.lengthTicks &&
        Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127 &&
        ['draw', 'screen', 'computer', 'midi', 'duplicate', 'legacy'].includes(String(note.source)) &&
        (note.originNoteId === undefined || validId(note.originNoteId)) &&
        (note.timingInferred === undefined || typeof note.timingInferred === 'boolean')),
    ) && (pattern.controllerEvents === undefined || (Array.isArray(pattern.controllerEvents) && pattern.controllerEvents.length <= 1024 && new Set(pattern.controllerEvents.map((event) => isPlainRecord(event) ? event.id : undefined)).size === pattern.controllerEvents.length && pattern.controllerEvents.every((event) => Boolean(
      isPlainRecord(event) && validId(event.id) && ['channel-chords', 'channel-melody'].includes(String(event.channelId)) && event.controller === 64 &&
      Number.isInteger(event.startTick) && Number(event.startTick) >= 0 && (Number(event.startTick) < pattern.lengthTicks || (Number(event.startTick) === pattern.lengthTicks && Number(event.value) < 64 && event.termination === 'record-stop')) &&
      Number.isInteger(event.value) && Number(event.value) >= 0 && Number(event.value) <= 127 && ['midi', 'derived'].includes(String(event.source)) &&
      (event.originControllerEventId === undefined || validId(event.originControllerEventId)) &&
      (event.termination === undefined || ['observed', 'record-stop'].includes(String(event.termination))),
    )))),
  ))) return false
  if (new Set(content.clips.map((clip) => isPlainRecord(clip) ? clip.id : undefined)).size !== content.clips.length) return false
  const lanes = content.lanes as Record<string, ProjectLane>
  return content.clips.every((clip) => Boolean(
    isPlainRecord(clip) && validId(clip.id) && typeof clip.patternId === 'string' && patterns[clip.patternId] &&
    typeof clip.laneId === 'string' && ['lane-chords', 'lane-melody'].includes(clip.laneId) && lanes[clip.laneId] &&
    Number.isInteger(clip.startTick) && clip.startTick >= 0 &&
    Number.isInteger(clip.lengthTicks) && clip.lengthTicks > 0 && clip.startTick + clip.lengthTicks <= content.lengthTicks! &&
    Number.isInteger(clip.offsetTick) && clip.offsetTick >= 0 && clip.offsetTick < patterns[clip.patternId].lengthTicks,
  ))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFiniteNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function isValidCommandHistory(value: unknown, current?: ProjectContent): value is ProjectCommandHistory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const history = value as Partial<ProjectCommandHistory>
  if (!Array.isArray(history.past) || !Array.isArray(history.future) || history.past.length > 100 || history.future.length > 100 || !Number.isInteger(history.nextCommandId) || history.nextCommandId! < 1) return false
  const commands = [...history.past, ...history.future]
  if (new Set(commands.map((command) => isPlainRecord(command) ? command.id : undefined)).size !== commands.length) return false
  if (!commands.every((command) => Boolean(
    command && typeof command.id === 'string' && typeof command.label === 'string' &&
    typeof command.createdAt === 'string' && isValidProjectContent(command.before) && isValidProjectContent(command.after),
  ))) return false
  const connected = (commandsToCheck: ProjectCommand[]) => commandsToCheck.every((command, index) =>
    index === 0 || JSON.stringify(commandsToCheck[index - 1].after) === JSON.stringify(command.before))
  if (!connected(history.past) || !connected(history.future)) return false
  if (current && history.past.length && JSON.stringify(history.past.at(-1)?.after) !== JSON.stringify(current)) return false
  if (current && history.future.length && JSON.stringify(history.future[0].before) !== JSON.stringify(current)) return false
  return true
}

export const emptyProjectHistory = (): ProjectCommandHistory => ({ past: [], future: [], nextCommandId: 1 })

export type ProjectGraphEdit =
  | { type: 'set-chord'; bar: number; chord: string }
  | { type: 'add-note'; event: MelodyNoteEvent }
  | { type: 'remove-note'; instanceId: string }
  | { type: 'set-note-pitch'; instanceId: string; pitch: number }
  | { type: 'set-note-timing'; instanceId: string; startTick: number; durationTicks: number }
  | { type: 'set-note-velocity'; instanceId: string; velocity: number }
  | { type: 'duplicate-melody' }
  | { type: 'make-unique'; clipId: string }
  | { type: 'move-clip'; clipId: string; startTick: number; laneId?: ProjectLaneId }
  | { type: 'resize-clip'; clipId: string; lengthTicks: number; offsetTick?: number }
  | { type: 'duplicate-clip'; sourceClipId: string; newClipId: string; startTick: number; laneId?: ProjectLaneId }
  | { type: 'set-mix'; key: 'chordLevel' | 'melodyLevel' | 'reverb'; value: number }
  | { type: 'reset-session'; session: 5 | 6 | 7 | 8 }

export function applyProjectGraphEdit(current: ProjectContent, edit: ProjectGraphEdit): ProjectContent {
  const content = cloneProjectContent(current)
  if (edit.type === 'set-chord') {
    const notes = chordPitches[edit.chord]
    if (!notes || edit.bar < 0 || edit.bar > 7) return content
    const patternId = `chord-${edit.chord.toLowerCase()}`
    if (!content.patterns[patternId]) {
      content.patterns[patternId] = {
        id: patternId, channelId: 'channel-chords', name: edit.chord, lengthTicks: TICKS_PER_BAR,
        notes: notes.map((pitch, index) => ({ id: `${patternId}-note-${index + 1}`, channelId: 'channel-chords', pitch, startTick: 0, durationTicks: TICKS_PER_BAR, velocity: 72, source: 'draw' })), timingBasis: 'authored',
      }
    }
    const existing = content.clips.find((clip) => clip.id === `clip-chord-${edit.bar + 1}`)
    if (existing) existing.patternId = patternId
    else content.clips.push({ id: `clip-chord-${edit.bar + 1}`, patternId, laneId: 'lane-chords', startTick: edit.bar * TICKS_PER_BAR, lengthTicks: TICKS_PER_BAR, offsetTick: 0 })
    return content
  }
  if (edit.type === 'duplicate-melody') {
    const first = content.clips.find((clip) => clip.id === 'clip-melody-a')
    if (!first) return content
    content.clips = content.clips.filter((clip) => clip.id !== 'clip-melody-b')
    content.clips.push({ id: 'clip-melody-b', patternId: first.patternId, laneId: 'lane-melody', startTick: TICKS_PER_BAR * 4, lengthTicks: TICKS_PER_BAR * 4, offsetTick: 0, originClipId: first.id })
    return content
  }
  if (edit.type === 'make-unique') {
    const clip = content.clips.find((candidate) => candidate.id === edit.clipId)
    if (clip) makeUniquePatternForClip(content, clip)
    return content
  }
  if (edit.type === 'move-clip') {
    const clip = content.clips.find((candidate) => candidate.id === edit.clipId)
    const laneId = edit.laneId ?? clip?.laneId
    if (!clip || !Number.isInteger(edit.startTick) || edit.startTick < 0 || edit.startTick + clip.lengthTicks > content.lengthTicks || !laneId || !content.lanes[laneId]) return content
    clip.startTick = edit.startTick
    clip.laneId = laneId
    return content
  }
  if (edit.type === 'resize-clip') {
    const clip = content.clips.find((candidate) => candidate.id === edit.clipId)
    const pattern = clip ? content.patterns[clip.patternId] : undefined
    if (!clip || !pattern) return content
    const offsetTick = edit.offsetTick ?? clip.offsetTick
    if (!Number.isInteger(edit.lengthTicks) || edit.lengthTicks <= 0 || clip.startTick + edit.lengthTicks > content.lengthTicks ||
      !Number.isInteger(offsetTick) || offsetTick < 0 || offsetTick >= pattern.lengthTicks) return content
    clip.lengthTicks = edit.lengthTicks
    clip.offsetTick = offsetTick
    return content
  }
  if (edit.type === 'duplicate-clip') {
    const source = content.clips.find((candidate) => candidate.id === edit.sourceClipId)
    const laneId = edit.laneId ?? source?.laneId
    if (!source || !validId(edit.newClipId) || content.clips.some((clip) => clip.id === edit.newClipId) || !Number.isInteger(edit.startTick) || edit.startTick < 0 ||
      edit.startTick + source.lengthTicks > content.lengthTicks || !laneId || !content.lanes[laneId]) return content
    content.clips.push({ ...source, id: edit.newClipId, startTick: edit.startTick, laneId, originClipId: source.id })
    return content
  }
  if (edit.type === 'set-mix') {
    if (edit.key === 'chordLevel') content.channels['channel-chords'].gain = clamp(edit.value, 0, 100)
    if (edit.key === 'melodyLevel') content.channels['channel-melody'].gain = clamp(edit.value, 0, 100)
    if (edit.key === 'reverb') {
      content.channels['channel-chords'].reverbSend = clamp(edit.value, 0, 40)
      content.channels['channel-melody'].reverbSend = clamp(edit.value, 0, 40)
    }
    return content
  }
  if (edit.type === 'reset-session') {
    if (edit.session === 5) return createProjectContent()
    if (edit.session === 6) {
      removeChannelNotes(content, 'channel-melody', () => true)
    } else if (edit.session === 7) {
      removeChannelNotes(content, 'channel-melody', (_note, clip) => clip.startTick >= TICKS_PER_BAR * 4)
      Object.values(content.patterns).forEach((pattern) => pattern.notes.forEach((note) => {
        if (note.channelId === 'channel-melody') note.velocity = 72
      }))
    } else {
      Object.values(content.patterns).forEach((pattern) => pattern.notes.forEach((note) => {
        if (note.channelId === 'channel-melody') note.velocity = 72
      }))
    }
    content.channels['channel-chords'].gain = 72
    content.channels['channel-melody'].gain = 78
    content.channels['channel-chords'].reverbSend = 12
    content.channels['channel-melody'].reverbSend = 12
    return content
  }
  if (edit.type === 'add-note') {
    const isSecond = edit.event.startTick >= TICKS_PER_BAR * 4
    let clip = content.clips.find((candidate) => candidate.id === (isSecond ? 'clip-melody-b' : 'clip-melody-a'))
    if (!clip) {
      const patternId = isSecond ? 'pattern-melody-b' : 'pattern-melody-a'
      content.patterns[patternId] = { id: patternId, channelId: 'channel-melody', name: isSecond ? 'Melody A′' : 'Melody A', lengthTicks: TICKS_PER_BAR * 4, notes: [] }
      clip = { id: isSecond ? 'clip-melody-b' : 'clip-melody-a', patternId, laneId: 'lane-melody', startTick: isSecond ? TICKS_PER_BAR * 4 : 0, lengthTicks: TICKS_PER_BAR * 4, offsetTick: 0 }
      content.clips.push(clip)
    }
    const pattern = content.patterns[clip.patternId]
    const used = new Set(pattern.notes.map((note) => note.id))
    const noteId = collisionFreeId(edit.event.id.replace(/^clip-melody-[ab]@/, ''), used)
    pattern.notes.push({ id: noteId, channelId: 'channel-melody', pitch: edit.event.pitch, startTick: edit.event.startTick - clip.startTick + clip.offsetTick, durationTicks: edit.event.durationTicks, velocity: edit.event.velocity, source: edit.event.source, ...(edit.event.originId ? { originNoteId: edit.event.originId.split('@').at(-1) } : {}), ...(edit.event.timingInferred ? { timingInferred: true } : {}) })
    return content
  }
  const address = resolveInstance(content, edit.instanceId)
  if (!address) return content
  const pattern = content.patterns[address.clip.patternId]
  const note = pattern.notes.find((candidate) => candidate.id === address.note.id)
  if (!note) return content
  if (edit.type === 'remove-note') pattern.notes = pattern.notes.filter((candidate) => candidate.id !== note.id)
  if (edit.type === 'set-note-pitch') note.pitch = edit.pitch
  if (edit.type === 'set-note-velocity') note.velocity = edit.velocity
  if (edit.type === 'set-note-timing') {
    note.startTick = edit.startTick - address.clip.startTick + address.clip.offsetTick
    note.durationTicks = edit.durationTicks
    note.timingInferred = undefined
  }
  return content
}

function removeChannelNotes(
  content: ProjectContent,
  channelId: ProjectChannelId,
  remove: (note: ProjectPatternNote, clip: PlaylistClip) => boolean,
): void {
  for (const clip of [...content.clips]) {
    const pattern = content.patterns[clip.patternId]
    if (!pattern) continue
    const removable = pattern.notes.filter((note) => note.channelId === channelId && remove(note, clip))
    if (!removable.length) continue
    if (content.clips.filter((candidate) => candidate.patternId === clip.patternId).length > 1) makeUniquePatternForClip(content, clip)
    const target = content.patterns[clip.patternId]
    const ids = new Set(removable.map((note) => note.id))
    target.notes = target.notes.filter((note) => !ids.has(note.id) && !ids.has(note.originNoteId ?? ''))
  }
  const usedPatterns = new Set(content.clips.map((clip) => clip.patternId))
  Object.keys(content.patterns).forEach((id) => {
    if (!usedPatterns.has(id)) delete content.patterns[id]
  })
  content.clips = content.clips.filter((clip) => content.patterns[clip.patternId]?.notes.length)
}

function resolveInstance(content: ProjectContent, instanceId: string): { clip: PlaylistClip; note: ProjectPatternNote } | undefined {
  const separator = instanceId.indexOf('@')
  if (separator > 0) {
    const clip = content.clips.find((candidate) => candidate.id === instanceId.slice(0, separator))
    const note = clip ? content.patterns[clip.patternId]?.notes.find((candidate) => candidate.id === instanceId.slice(separator + 1)) : undefined
    if (clip && note) return { clip, note }
  }
  for (const clip of content.clips) {
    const note = content.patterns[clip.patternId]?.notes.find((candidate) => candidate.id === instanceId)
    if (note) return { clip, note }
  }
  return undefined
}

function makeUniquePatternForClip(content: ProjectContent, clip: PlaylistClip): ProjectPattern {
  const pattern = content.patterns[clip.patternId]
  if (content.clips.filter((candidate) => candidate.patternId === clip.patternId).length <= 1) return pattern
  const patternId = collisionFreeId(`pattern-${clip.id}-unique`, new Set(Object.keys(content.patterns)))
  const used = new Set<string>()
  const notes = pattern.notes.map((note, index) => ({
    ...note,
    id: collisionFreeId(`${clip.id}-note-${index + 1}`, used),
    originNoteId: note.originNoteId ?? note.id,
  }))
  const controllerEvents = pattern.controllerEvents?.map((event, index) => ({
    ...event,
    id: collisionFreeId(`${clip.id}-cc-${index + 1}`, used),
    originControllerEventId: event.originControllerEventId ?? event.id,
  }))
  const unique: ProjectPattern = { ...pattern, id: patternId, name: `${pattern.name} (unique)`, notes, controllerEvents, originPatternId: pattern.originPatternId ?? pattern.id }
  content.patterns[patternId] = unique
  clip.patternId = patternId
  return unique
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}
