import { describe, expect, it } from 'vitest'
import { createTextIdea, createMidiIdea } from '../ideas'
import { createProject } from '../model'
import { createStudioProject, decodeStudioProject } from './model'
import { packStudioProject } from './archive'
import { packProject } from '../archive'
import { createCleanContinuation, decodeRecovery } from './recovery'

describe('validated recovery and capacity continuation', () => {
  it('rejects malformed byte streams and nonproject JSON without changing the supplied bytes', () => {
    const cases = [new Uint8Array(), new Uint8Array([0x50, 0x4b]), new Uint8Array([0xc0, 0xaf]),
      ...['null', '[]', '0', '"project"', '{"__proto__":{"polluted":true}}'].map(value => new TextEncoder().encode(value))]
    for (const input of cases) {
      const before = new Uint8Array(input)
      expect(() => decodeRecovery(input)).toThrow()
      expect(input).toEqual(before)
    }
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
  it('rejects an oversized input before decoding and never shares continuation graphs', () => {
    expect(() => decodeRecovery(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow(/too large/)
    const source = createStudioProject(); source.name = 'n'.repeat(120)
    const before = structuredClone(source), first = createCleanContinuation(source), second = createCleanContinuation(source)
    expect(first.id).not.toBe(second.id)
    expect(first.name.length).toBeLessThanOrEqual(120)
    first.tracks[0].expression.push({ tick: 0, value: 0.5 })
    first.clips[0].startTick = 100
    expect(source).toEqual(before)
    expect(second.tracks).toEqual(before.tracks)
    expect(second.clips).toEqual(before.clips)
  })
  it('recognizes .nadi and exact legacy/v4 JSON without choosing an overwrite target', () => {
    const project = createStudioProject(), legacy = createProject()
    expect(decodeRecovery(packStudioProject(project))).toEqual({ kind: 'project', project })
    expect(decodeRecovery(JSON.stringify(project))).toEqual({ kind: 'project', project })
    expect(decodeRecovery(JSON.stringify(legacy))).toEqual({ kind: 'project', project: decodeStudioProject(legacy), preUpgradeRaw: legacy })
  })
  it('restores raw MIDI-original content separately from musical notes', () => {
    const original = createMidiIdea([{ type: 'note-on', pitch: 60, velocity: 80, channel: 0, source: 'midi', atMs: 13.2, order: 0 }], 500).original
    expect(decodeRecovery(JSON.stringify(original))).toEqual({ kind: 'original', original })
    expect(() => decodeRecovery(JSON.stringify({ ...original, extra: true }))).toThrow()
    expect(() => decodeRecovery('{ invalid')).toThrow()
    expect(() => decodeRecovery(new Uint8Array([0xff]))).toThrow()
    expect(() => decodeRecovery(JSON.stringify(createTextIdea('not a MIDI original').original))).toThrow()
  })
  it('retains the exact legacy archive project for the first durable upgrade backup', () => {
    const legacy = createProject()
    legacy.notes = [{ id: 'exact', pitch: 67, instrument: 'piano', startTick: 137, durationTicks: 2111, velocity: 93 }]
    legacy.ideas = [createTextIdea('Retain original')]
    const bytes = packProject(legacy), before = new Uint8Array(bytes)
    expect(decodeRecovery(bytes)).toEqual({ kind: 'project', project: decodeStudioProject(legacy), preUpgradeRaw: legacy })
    expect(bytes).toEqual(before)
  })
  it('roundtrips production settings and all new sound references without musical changes', () => {
    const project = createStudioProject()
    project.tracks[0] = { ...project.tracks[0], soundId: 'ancient-reed', pan: -.33, space: .6, spaceBypass: true, expression: [{ tick: 73, value: .25 }, { tick: 7011, value: .83 }] }
    project.patterns[0].notes = [{ id: 'free-time', pitch: 55, startTick: 73, durationTicks: 7011, velocity: 117 }]
    expect(decodeRecovery(packStudioProject(project))).toEqual({ kind: 'project', project })
    expect(decodeRecovery(JSON.stringify(project))).toEqual({ kind: 'project', project })
  })
  it('creates a clean continuation without touching the retained source or weakening originals', () => {
    const source = createStudioProject(); source.ideas = [createTextIdea('Keep forever')]; source.revision = 8
    const before = structuredClone(source), next = createCleanContinuation(source)
    expect(source).toEqual(before)
    expect(next.id).not.toBe(source.id); expect(next.revision).toBe(0); expect(next.ideas).toEqual([])
    expect(next.patterns).toEqual(source.patterns); expect(next.clips).toEqual(source.clips)
    next.patterns[0].name = 'changed copy'
    expect(source).toEqual(before)
  })
})
