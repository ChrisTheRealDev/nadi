import { decodeProject, MAX_PROJECT_BYTES, validateProject, type CreationProject } from './model'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
const MAX_ENTRY_BYTES = MAX_PROJECT_BYTES
const EXPECTED_PATHS = ['manifest.json', 'project.json'] as const

const manifest = {
  format: 'nadi-archive',
  version: 1,
  project: 'project.json',
  assets: [],
} as const

interface ZipEntry {
  path: string
  data: Uint8Array
  crc: number
  localOffset: number
}

export function packProject(project: CreationProject): Uint8Array {
  if (!validateProject(project)) throw new TypeError('Cannot archive an invalid creation project.')
  const entries = [
    makeEntry('manifest.json', encoder.encode(JSON.stringify(manifest))),
    makeEntry('project.json', encoder.encode(JSON.stringify(project))),
  ]
  const localSize = entries.reduce((total, entry) => total + 30 + encoder.encode(entry.path).length + entry.data.length, 0)
  const centralSize = entries.reduce((total, entry) => total + 46 + encoder.encode(entry.path).length, 0)
  if (localSize + centralSize + 22 > MAX_ARCHIVE_BYTES) throw new TypeError('The project exceeds the .nadi archive size limit.')
  const output = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(output.buffer)
  let offset = 0

  for (const entry of entries) {
    entry.localOffset = offset
    const name = encoder.encode(entry.path)
    write32(view, offset, 0x04034b50)
    write16(view, offset + 4, 20)
    write16(view, offset + 6, 0x0800)
    write16(view, offset + 8, 0)
    write16(view, offset + 10, 0)
    write16(view, offset + 12, 0x0021)
    write32(view, offset + 14, entry.crc)
    write32(view, offset + 18, entry.data.length)
    write32(view, offset + 22, entry.data.length)
    write16(view, offset + 26, name.length)
    write16(view, offset + 28, 0)
    output.set(name, offset + 30)
    output.set(entry.data, offset + 30 + name.length)
    offset += 30 + name.length + entry.data.length
  }

  const centralOffset = offset
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    write32(view, offset, 0x02014b50)
    write16(view, offset + 4, 20)
    write16(view, offset + 6, 20)
    write16(view, offset + 8, 0x0800)
    write16(view, offset + 10, 0)
    write16(view, offset + 12, 0)
    write16(view, offset + 14, 0x0021)
    write32(view, offset + 16, entry.crc)
    write32(view, offset + 20, entry.data.length)
    write32(view, offset + 24, entry.data.length)
    write16(view, offset + 28, name.length)
    write16(view, offset + 30, 0)
    write16(view, offset + 32, 0)
    write16(view, offset + 34, 0)
    write16(view, offset + 36, 0)
    write32(view, offset + 38, 0)
    write32(view, offset + 42, entry.localOffset)
    output.set(name, offset + 46)
    offset += 46 + name.length
  }

  write32(view, offset, 0x06054b50)
  write16(view, offset + 4, 0)
  write16(view, offset + 6, 0)
  write16(view, offset + 8, entries.length)
  write16(view, offset + 10, entries.length)
  write32(view, offset + 12, centralSize)
  write32(view, offset + 16, centralOffset)
  write16(view, offset + 20, 0)
  return output
}

export function unpackProject(bytes: Uint8Array): CreationProject {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || bytes.byteLength > MAX_ARCHIVE_BYTES) throw new TypeError('Invalid or oversized .nadi archive.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.byteLength - 22
  if (read32(view, eocd) !== 0x06054b50 || read16(view, eocd + 4) !== 0 || read16(view, eocd + 6) !== 0 || read16(view, eocd + 20) !== 0) {
    throw new TypeError('The .nadi ZIP footer is invalid.')
  }
  const diskEntries = read16(view, eocd + 8)
  const totalEntries = read16(view, eocd + 10)
  const centralSize = read32(view, eocd + 12)
  const centralOffset = read32(view, eocd + 16)
  if (diskEntries !== 2 || totalEntries !== 2 || centralOffset + centralSize !== eocd) throw new TypeError('The .nadi archive must contain exactly two entries.')

  const entries = new Map<string, Uint8Array>()
  let cursor = centralOffset
  let expectedLocalOffset = 0
  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(bytes, cursor, 46)
    if (read32(view, cursor) !== 0x02014b50) throw new TypeError('The .nadi central directory is invalid.')
    const flags = read16(view, cursor + 8)
    const method = read16(view, cursor + 10)
    const crc = read32(view, cursor + 16)
    const compressedSize = read32(view, cursor + 20)
    const size = read32(view, cursor + 24)
    const nameLength = read16(view, cursor + 28)
    const extraLength = read16(view, cursor + 30)
    const commentLength = read16(view, cursor + 32)
    const disk = read16(view, cursor + 34)
    const localOffset = read32(view, cursor + 42)
    if (flags !== 0x0800 || method !== 0 || disk !== 0 || extraLength !== 0 || commentLength !== 0 || compressedSize !== size || size > MAX_ENTRY_BYTES) {
      throw new TypeError('The .nadi archive uses unsupported ZIP features.')
    }
    requireRange(bytes, cursor + 46, nameLength)
    const path = decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (!EXPECTED_PATHS.includes(path as typeof EXPECTED_PATHS[number]) || entries.has(path) || path.includes('/') || path.includes('\\') || path.includes('..')) {
      throw new TypeError('The .nadi archive contains an unexpected path.')
    }
    if (localOffset !== expectedLocalOffset) throw new TypeError('The .nadi local entries are not canonical.')
    requireRange(bytes, localOffset, 30)
    if (read32(view, localOffset) !== 0x04034b50 || read16(view, localOffset + 6) !== flags || read16(view, localOffset + 8) !== method) throw new TypeError('A .nadi local entry is invalid.')
    const localCrc = read32(view, localOffset + 14)
    const localCompressedSize = read32(view, localOffset + 18)
    const localSize = read32(view, localOffset + 22)
    const localNameLength = read16(view, localOffset + 26)
    const localExtraLength = read16(view, localOffset + 28)
    requireRange(bytes, localOffset + 30, localNameLength + localExtraLength + size)
    const localPath = decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
    if (localPath !== path || localExtraLength !== 0 || localCrc !== crc || localCompressedSize !== size || localSize !== size) throw new TypeError('A .nadi local entry disagrees with its directory.')
    const dataStart = localOffset + 30 + localNameLength
    const data = bytes.subarray(dataStart, dataStart + size)
    if (crc32(data) !== crc) throw new TypeError(`CRC mismatch for ${path}.`)
    entries.set(path, data)
    expectedLocalOffset = dataStart + size
    cursor += 46 + nameLength
  }
  if (cursor !== eocd || expectedLocalOffset !== centralOffset) throw new TypeError('The .nadi archive layout is invalid.')

  const parsedManifest = parseJson(entries.get('manifest.json')!, 'manifest')
  if (!isRecord(parsedManifest) || !onlyKeys(parsedManifest, ['format', 'version', 'project', 'assets']) || parsedManifest.format !== 'nadi-archive' || parsedManifest.version !== 1 || parsedManifest.project !== 'project.json' || !Array.isArray(parsedManifest.assets) || parsedManifest.assets.length !== 0) {
    throw new TypeError('The .nadi manifest is invalid or unsupported.')
  }
  const project = parseJson(entries.get('project.json')!, 'project')
  return decodeProject(project)
}

function makeEntry(path: string, data: Uint8Array): ZipEntry {
  if (data.length > MAX_ENTRY_BYTES) throw new TypeError('The creation is too large to archive.')
  return { path, data, crc: crc32(data), localOffset: 0 }
}

function parseJson(data: Uint8Array, label: string): unknown {
  try { return JSON.parse(decode(data)) }
  catch { throw new TypeError(`The .nadi ${label} is not valid UTF-8 JSON.`) }
}

function decode(data: Uint8Array): string {
  try { return decoder.decode(data) }
  catch { throw new TypeError('The .nadi archive contains invalid UTF-8.') }
}

function requireRange(bytes: Uint8Array, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) throw new TypeError('The .nadi archive is truncated.')
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function write16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true) }
function write32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true) }
function read16(view: DataView, offset: number): number { return view.getUint16(offset, true) }
function read32(view: DataView, offset: number): number { return view.getUint32(offset, true) }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}
