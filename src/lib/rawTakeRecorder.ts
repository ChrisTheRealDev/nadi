import type { RawTake, RawTakeEvent } from './projectPersistence'

export type RawPerformanceEvent = RawTakeEvent
export type RawTakeTimingOrigin = RawTake['timingOrigin']

const MAX_EVENTS = 10_000
type InputSource = 'midi' | 'screen' | 'computer'

export class RawTakeRecorder {
  private active?: {
    id: string
    scope: string
    openedAt: string
    startMs: number
    timingOrigin: RawTakeTimingOrigin
    events: RawPerformanceEvent[]
    held: Map<string, Array<{ note: number; channel: number; source: InputSource; inputId?: string; voiceId: string }>>
    sustainChannels: Map<string, { channel: number; inputId?: string }>
    droppedEventCount: number
    nextOrder: number
  }

  get recording(): boolean {
    return Boolean(this.active)
  }

  start(id: string, scope: string, atMs: number, openedAt = new Date().toISOString(), timingOrigin: RawTakeTimingOrigin = { kind: 'free', countInBars: 0 }): boolean {
    if (this.active || !safeId(id) || !safeScope(scope) || !Number.isFinite(atMs) || !validTimingOrigin(timingOrigin)) return false
    this.active = { id, scope, openedAt, startMs: atMs, timingOrigin: { ...timingOrigin }, events: [], held: new Map(), sustainChannels: new Map(), droppedEventCount: 0, nextOrder: 0 }
    return true
  }

  noteOn(note: number, velocity: number, channel: number, source: InputSource, atMs: number, inputId?: string): void {
    const relative = this.relative(atMs)
    if (relative === undefined || !integerInRange(note, 0, 127) || !integerInRange(velocity, 1, 127) || !integerInRange(channel, 0, 15) || !validInputId(inputId)) return
    const voiceId = `voice-${this.nextVoiceNumber()}`
    const key = heldKey(note, channel, source, inputId)
    if (this.push({ type: 'note-on', order: this.nextOrder(), atMs: relative, channel, note, velocity, source, voiceId, ...(inputId ? { inputId } : {}) })) {
      this.active?.held.set(key, [...(this.active.held.get(key) ?? []), { note, channel, source, inputId, voiceId }])
    }
  }

  noteOff(note: number, releaseVelocity: number, channel: number, source: InputSource, atMs: number, inputId?: string): void {
    const relative = this.relative(atMs)
    if (relative === undefined || !integerInRange(note, 0, 127) || !integerInRange(releaseVelocity, 0, 127) || !integerInRange(channel, 0, 15) || !validInputId(inputId)) return
    const key = heldKey(note, channel, source, inputId)
    const queue = this.active?.held.get(key) ?? []
    const matched = queue.shift()
    if (queue.length) this.active?.held.set(key, queue)
    else this.active?.held.delete(key)
    this.push({ type: 'note-off', order: this.nextOrder(), atMs: relative, channel, note, releaseVelocity, source, ...(matched ? { voiceId: matched.voiceId } : {}), ...(inputId ? { inputId } : {}), termination: 'observed' })
  }

  sustain(value: number, channel: number, atMs: number, inputId?: string): void {
    const relative = this.relative(atMs)
    if (relative === undefined || !integerInRange(value, 0, 127) || !integerInRange(channel, 0, 15) || !validInputId(inputId)) return
    const key = `${inputId ?? 'default'}:${channel}`
    const retained = this.push({ type: 'cc64', order: this.nextOrder(), atMs: relative, channel, value, source: 'midi', ...(inputId ? { inputId } : {}) })
    if (value < 64) this.active?.sustainChannels.delete(key)
    else if (retained) this.active?.sustainChannels.set(key, { channel, inputId })
  }

  stop(atMs: number, closedAt = new Date().toISOString(), endReason: RawTake['endReason'] = 'user-stop'): RawTake | undefined {
    const active = this.active
    if (!active || !Number.isFinite(atMs) || atMs < active.startMs) return undefined
    const durationMs = atMs - active.startMs
    active.held.forEach((voices) => voices.forEach(({ note, channel, source, inputId, voiceId }) => {
      this.push({ type: 'note-off', order: this.nextOrder(), atMs: durationMs, channel, note, releaseVelocity: 0, source, voiceId, ...(inputId ? { inputId } : {}), termination: 'record-stop' })
    }))
    active.sustainChannels.forEach(({ channel, inputId }) => {
      this.push({ type: 'cc64', order: this.nextOrder(), atMs: durationMs, channel, value: 0, source: 'midi', ...(inputId ? { inputId } : {}), termination: 'record-stop' })
    })
    this.active = undefined
    return {
      id: active.id,
      scope: active.scope,
      openedAt: active.openedAt,
      closedAt,
      durationMs,
      endReason,
      truncated: active.droppedEventCount > 0,
      droppedEventCount: active.droppedEventCount,
      timingOrigin: { ...active.timingOrigin },
      events: active.events.map((event) => ({ ...event })),
    }
  }

  cancel(): void {
    this.active = undefined
  }

  private relative(atMs: number): number | undefined {
    if (!Number.isFinite(atMs) || !this.active || atMs < this.active.startMs) return undefined
    return atMs - this.active.startMs
  }

  private push(event: RawPerformanceEvent): boolean {
    if (!this.active) return false
    if (this.active.events.length >= MAX_EVENTS) {
      this.active.droppedEventCount += 1
      return false
    }
    this.active.events.push(event)
    return true
  }

  private nextOrder(): number {
    if (!this.active) return 0
    const order = this.active.nextOrder
    this.active.nextOrder += 1
    return order
  }

  private nextVoiceNumber(): number {
    return this.active ? this.active.nextOrder + 1 : 1
  }
}

const safeId = (value: string) => /^[A-Za-z0-9._:-]{1,96}$/.test(value)
const safeScope = (value: string) => value.length > 0 && value.length <= 120
const integerInRange = (value: number, minimum: number, maximum: number) => Number.isInteger(value) && value >= minimum && value <= maximum
const heldKey = (note: number, channel: number, source: InputSource, inputId?: string) => `${source}:${inputId ?? 'default'}:${channel}:${note}`
const validInputId = (value?: string) => value === undefined || /^[A-Za-z0-9._:-]{1,128}$/.test(value)

function validTimingOrigin(origin: RawTakeTimingOrigin): boolean {
  if (!Number.isInteger(origin.countInBars) || origin.countInBars < 0 || origin.countInBars > 8) return false
  if (origin.kind === 'free') return origin.startTick === undefined && origin.bpm === undefined && origin.meter === undefined && origin.audioEpoch === undefined
  return Number.isInteger(origin.startTick) && Number(origin.startTick) >= 0 && Number(origin.startTick) <= 15_360 &&
    typeof origin.bpm === 'number' && Number.isFinite(origin.bpm) && origin.bpm >= 30 && origin.bpm <= 300 && origin.meter === '4/4' &&
    Number.isInteger(origin.audioEpoch) && Number(origin.audioEpoch) >= 0
}
