import { validateIdeaOriginal, type MidiOriginal } from '../ideas'
import { unpackStudioProjectWithRecovery } from './archive'
import { assertStudioProject, decodeStudioProject, makeStudioId, MAX_PROJECT_BYTES, type StudioProject } from './model'

export type RecoveryContent = { kind: 'project'; project: StudioProject; preUpgradeRaw?: unknown } | { kind: 'original'; original: MidiOriginal }

/** Format sniffing only; callers explicitly choose restoration and never overwrite on decode. */
export function decodeRecovery(input: Uint8Array | string): RecoveryContent {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw new TypeError('Recovery file is empty or too large.')
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { kind: 'project', ...unpackStudioProjectWithRecovery(bytes) }
  if (bytes.byteLength > MAX_PROJECT_BYTES) throw new TypeError('Recovery JSON exceeds the project size limit.')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new TypeError('Choose a valid .nadi project, project recovery JSON or MIDI-original JSON file.') }
  if (validateIdeaOriginal(value) && value.kind === 'midi') return { kind: 'original', original: structuredClone(value) }
  try {
    const project = decodeStudioProject(value)
    const isOld = value !== null && typeof value === 'object' && 'version' in value && value.version !== 5 && value.version !== 6
    return { kind: 'project', project, ...(isOld ? { preUpgradeRaw: structuredClone(value) } : {}) }
  }
  catch { throw new TypeError('This recovery file is invalid, unsupported or exceeds project limits. Nothing was imported.') }
}

/** Explicit continuation workflow only. The source project and all originals remain unchanged. */
export function createCleanContinuation(project: StudioProject): StudioProject {
  assertStudioProject(project)
  const next = { ...structuredClone(project), id: makeStudioId(), revision: 0, name: `${project.name.slice(0, 106)} (continued)`, ideas: [] }
  assertStudioProject(next)
  return next
}
