import { describe, expect, it } from 'vitest'
import { packProject, unpackProject } from './archive'
import { createDefaultMix, createProject } from './model'
import { createAudioIdea, createMidiIdea, createTextIdea } from './ideas'

// Build an independently encoded, canonical v1 ZIP fixture (not via packProject).
function legacyArchive(project: unknown): Uint8Array {
  const encoder = new TextEncoder()
  const entries = [
    ['manifest.json', { format: 'nadi-archive', version: 1, project: 'project.json', assets: [] }],
    ['project.json', project],
  ] as const
  const crc32 = (data: Uint8Array) => {
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const [path, value] of entries) {
    const name = encoder.encode(path), data = encoder.encode(JSON.stringify(value)), crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length), view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true)
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true)
    local.set(name, 30); local.set(data, 30 + name.length); locals.push(local)
    const central = new Uint8Array(46 + name.length), directory = new DataView(central.buffer)
    directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true); directory.setUint16(8, 0x0800, true)
    directory.setUint32(16, crc, true); directory.setUint32(20, data.length, true); directory.setUint32(24, data.length, true)
    directory.setUint16(28, name.length, true); directory.setUint32(42, offset, true); central.set(name, 46); centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0)
  const output = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const entry of [...locals, ...centrals]) { output.set(entry, cursor); cursor += entry.length }
  const end = new DataView(output.buffer, cursor)
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 2, true); end.setUint16(10, 2, true)
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return output
}

function findAscii(bytes: Uint8Array, value: string): number {
  const needle = new TextEncoder().encode(value)
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let inner = 0; inner < needle.length; inner += 1) if (bytes[index + inner] !== needle[inner]) continue outer
    return index
  }
  return -1
}

describe('.nadi archive', () => {
  it('opens a real manifest-v1/project-v1 archive with unchanged notes and unity mixer defaults', () => {
    const project = createProject(); project.revision = 19
    project.notes = [{ id: 'recorded', instrument: 'piano', pitch: 127, startTick: 91, durationTicks: 7501, velocity: 101 }]
    const { mix: _mix, ideas: _ideas, ...base } = project
    expect(_mix).toEqual(createDefaultMix())
    expect(_ideas).toEqual([])
    const legacy = { ...base, version: 1 }
    expect(unpackProject(legacyArchive(legacy))).toEqual({ ...project, mix: createDefaultMix() })
    expect(() => unpackProject(legacyArchive({ ...legacy, mix: createDefaultMix() }))).toThrow()
    expect(() => unpackProject(legacyArchive({ ...legacy, version: 3 }))).toThrow()
  })
  it('round trips the strict project through a store-only ZIP package', () => {
    const project = createProject()
    project.name = 'First beat'
    project.notes.push({ id: 'kick-1', instrument: 'kick', pitch: 36, startTick: 0, durationTicks: 120, velocity: 110 })
    project.mix.kick = { level: 39, muted: true }

    const archive = packProject(project)

    expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(findAscii(archive, 'manifest.json')).toBeGreaterThan(0)
    expect(findAscii(archive, 'project.json')).toBeGreaterThan(0)
    expect(unpackProject(archive)).toEqual(project)
  })

  it('packages exact original text, audio bytes and expressive MIDI with the project', () => {
    const project = createProject()
    project.ideas = [createTextIdea('  rain\n\tthen silence  '), createAudioIdea('AAH+/w==', 'audio/webm;codecs=opus', 4, 1000), createMidiIdea([
      { type: 'pitch-bend', value: 9300, atMs: 1.25, order: 0, channel: 2, source: 'midi' },
    ], 1000)]
    expect(unpackProject(packProject(project))).toEqual(project)
  })

  it('rejects truncation, arbitrary JSON, and unsupported ZIP compression', () => {
    const archive = packProject(createProject())
    expect(() => unpackProject(archive.subarray(0, archive.length - 1))).toThrow()
    expect(() => unpackProject(new TextEncoder().encode(JSON.stringify(createProject())))).toThrow()

    const compressed = archive.slice()
    new DataView(compressed.buffer).setUint16(8, 8, true)
    expect(() => unpackProject(compressed)).toThrow(/unsupported|invalid/i)
  })

  it('rejects CRC tampering and unsupported manifest content', () => {
    const archive = packProject(createProject())
    const projectJson = findAscii(archive, '{"format":"nadi-creation"')
    expect(projectJson).toBeGreaterThan(0)
    const tampered = archive.slice()
    tampered[projectJson + 2] ^= 1
    expect(() => unpackProject(tampered)).toThrow(/CRC/i)

    const wrongVersion = createProject()
    const valid = packProject(wrongVersion)
    const marker = findAscii(valid, '"version":1')
    expect(marker).toBeGreaterThan(0)
    const changed = valid.slice()
    changed[marker + '"version":'.length] = '2'.charCodeAt(0)
    expect(() => unpackProject(changed)).toThrow()
  })
})
