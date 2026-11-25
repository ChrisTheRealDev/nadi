import {
  applyProjectGraphEdit,
  cloneProjectContent,
  isValidProjectContent,
  projectContentFingerprint,
  type ProjectContent,
  type ProjectGraphEdit,
} from '../projectModel'
import type { MiraProposal } from './contracts'

export interface MiraProposalContext {
  projectId: string
  revision: number
  contentFingerprint: string
  content: ProjectContent
  selectedArtifactIds: readonly string[]
  learnerOwnedArtifactIds: readonly string[]
}

export interface MiraProjectReference {
  projectId: string
  revision: number
  contentFingerprint: string
}

export interface MiraViewAction {
  kind: 'focus' | 'audition'
  targetIds: string[]
  range: { startTick: number; endTick: number } | null
}

export interface MiraProposalPreview {
  disposable: true
  applyRequiresFreshValidation: true
  reference: MiraProjectReference
  proposal: MiraProposal
  affectedArtifactIds: string[]
  previewContent: ProjectContent
  command: ProjectGraphEdit | null
  viewAction: MiraViewAction | null
}

export type MiraProposalValidation =
  | { ok: true; preview: MiraProposalPreview }
  | { ok: false; reason: 'stale-project' | 'stale-revision' | 'stale-fingerprint' | 'target-not-selected' | 'target-not-owned' | 'target-missing' | 'shared-pattern-not-owned' | 'invalid-range' | 'invalid-value' | 'unsupported-transform' }

export type MiraProposalRejection = Extract<MiraProposalValidation, { ok: false }>['reason']

export type MiraApplyValidation =
  | { ok: true; command: ProjectGraphEdit }
  | { ok: false; reason: MiraProposalRejection | 'view-only' }

export function validateMiraProposal(
  proposal: MiraProposal,
  reference: MiraProjectReference,
  current: MiraProposalContext,
): MiraProposalValidation {
  const freshness = validateFreshness(reference, current)
  if (freshness) return { ok: false, reason: freshness }
  const selected = new Set(current.selectedArtifactIds)
  const owned = new Set(current.learnerOwnedArtifactIds)
  for (const targetId of proposal.targetIds) {
    if (!selected.has(targetId)) return { ok: false, reason: 'target-not-selected' }
    if (!owned.has(targetId)) return { ok: false, reason: 'target-not-owned' }
    if (!artifactExists(current.content, targetId)) return { ok: false, reason: 'target-missing' }
  }
  const affectedArtifactIds = affectedArtifacts(proposal, current.content)
  if (affectedArtifactIds.some((id) => !owned.has(id))) return { ok: false, reason: 'shared-pattern-not-owned' }
  const conversion = proposalToAction(proposal, current.content)
  if (!conversion.ok) return conversion
  const previewContent = cloneProjectContent(current.content)
  if (conversion.command) {
    const transformed = applyProjectGraphEdit(previewContent, conversion.command)
    if (!isValidProjectContent(transformed) || JSON.stringify(transformed) === JSON.stringify(current.content)) {
      return { ok: false, reason: 'invalid-value' }
    }
    return {
      ok: true,
      preview: {
        disposable: true,
        applyRequiresFreshValidation: true,
        reference: { ...reference },
        proposal: cloneProposal(proposal),
        affectedArtifactIds,
        previewContent: transformed,
        command: conversion.command,
        viewAction: null,
      },
    }
  }
  return {
    ok: true,
    preview: {
      disposable: true,
      applyRequiresFreshValidation: true,
      reference: { ...reference },
      proposal: cloneProposal(proposal),
      affectedArtifactIds,
      previewContent,
      command: null,
      viewAction: conversion.viewAction,
    },
  }
}

export function revalidateMiraPreviewForApply(
  preview: MiraProposalPreview,
  current: MiraProposalContext,
): MiraApplyValidation {
  if (!preview.command) return { ok: false, reason: 'view-only' }
  const revalidated = validateMiraProposal(preview.proposal, preview.reference, current)
  if (!revalidated.ok) return revalidated
  if (!revalidated.preview.command) return { ok: false, reason: 'view-only' }
  return { ok: true, command: revalidated.preview.command }
}

function validateFreshness(reference: MiraProjectReference, current: MiraProposalContext): 'stale-project' | 'stale-revision' | 'stale-fingerprint' | undefined {
  if (reference.projectId !== current.projectId) return 'stale-project'
  if (reference.revision !== current.revision) return 'stale-revision'
  if (reference.contentFingerprint !== current.contentFingerprint ||
      reference.contentFingerprint !== projectContentFingerprint(current.content)) return 'stale-fingerprint'
  return undefined
}

function proposalToAction(
  proposal: MiraProposal,
  content: ProjectContent,
): { ok: true; command: ProjectGraphEdit | null; viewAction: MiraViewAction | null } | { ok: false; reason: 'invalid-range' | 'invalid-value' | 'unsupported-transform' } {
  if (proposal.kind === 'focus' || proposal.kind === 'audition') {
    if (proposal.value !== null) return { ok: false, reason: 'invalid-value' }
    if (proposal.kind === 'focus' && proposal.range !== null) return { ok: false, reason: 'invalid-range' }
    if (proposal.range && (proposal.range.startTick < 0 || proposal.range.endTick > content.lengthTicks || proposal.range.endTick <= proposal.range.startTick)) {
      return { ok: false, reason: 'invalid-range' }
    }
    return { ok: true, command: null, viewAction: { kind: proposal.kind, targetIds: [...proposal.targetIds], range: proposal.range ? { ...proposal.range } : null } }
  }
  if (proposal.kind === 'set-channel-reverb') {
    const expected = new Set(['channel-chords', 'channel-melody'])
    if (proposal.targetIds.length !== 2 || proposal.targetIds.some((id) => !expected.delete(id)) || expected.size ||
        !integerBetween(proposal.value, 0, 40) || proposal.range !== null) return { ok: false, reason: 'invalid-value' }
    return { ok: true, command: { type: 'set-mix', key: 'reverb', value: proposal.value }, viewAction: null }
  }
  if (proposal.targetIds.length !== 1) return { ok: false, reason: 'unsupported-transform' }
  const targetId = proposal.targetIds[0]
  if (proposal.kind === 'set-note-pitch') {
    if (!integerBetween(proposal.value, 0, 127) || proposal.range !== null) return { ok: false, reason: 'invalid-value' }
    return { ok: true, command: { type: 'set-note-pitch', instanceId: targetId, pitch: proposal.value }, viewAction: null }
  }
  if (proposal.kind === 'set-note-velocity') {
    if (!integerBetween(proposal.value, 1, 127) || proposal.range !== null) return { ok: false, reason: 'invalid-value' }
    return { ok: true, command: { type: 'set-note-velocity', instanceId: targetId, velocity: proposal.value }, viewAction: null }
  }
  if (proposal.kind === 'set-note-timing') {
    if (proposal.value !== null || !proposal.range) return { ok: false, reason: 'invalid-range' }
    return {
      ok: true,
      command: { type: 'set-note-timing', instanceId: targetId, startTick: proposal.range.startTick, durationTicks: proposal.range.endTick - proposal.range.startTick },
      viewAction: null,
    }
  }
  if (proposal.kind === 'set-channel-gain') {
    if (!integerBetween(proposal.value, 0, 100) || proposal.range !== null) return { ok: false, reason: 'invalid-value' }
    if (targetId === 'channel-chords') return { ok: true, command: { type: 'set-mix', key: 'chordLevel', value: proposal.value }, viewAction: null }
    if (targetId === 'channel-melody') return { ok: true, command: { type: 'set-mix', key: 'melodyLevel', value: proposal.value }, viewAction: null }
  }
  return { ok: false, reason: 'unsupported-transform' }
}

function artifactExists(content: ProjectContent, id: string): boolean {
  if (Object.hasOwn(content.channels, id) || Object.hasOwn(content.lanes, id) || Object.hasOwn(content.patterns, id) || content.clips.some((clip) => clip.id === id)) return true
  const separator = id.indexOf('@')
  if (separator < 1) return false
  const clip = content.clips.find((candidate) => candidate.id === id.slice(0, separator))
  return Boolean(clip && content.patterns[clip.patternId]?.notes.some((note) => note.id === id.slice(separator + 1)))
}

function affectedArtifacts(proposal: MiraProposal, content: ProjectContent): string[] {
  if (!['set-note-pitch', 'set-note-velocity', 'set-note-timing'].includes(proposal.kind)) return [...proposal.targetIds]
  const targetId = proposal.targetIds[0]
  const separator = targetId.indexOf('@')
  if (separator < 1) return [...proposal.targetIds]
  const targetClip = content.clips.find((clip) => clip.id === targetId.slice(0, separator))
  if (!targetClip) return [...proposal.targetIds]
  const noteId = targetId.slice(separator + 1)
  return content.clips
    .filter((clip) => clip.patternId === targetClip.patternId)
    .map((clip) => `${clip.id}@${noteId}`)
    .sort()
}

function integerBetween(value: number | null, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function cloneProposal(proposal: MiraProposal): MiraProposal {
  return { ...proposal, targetIds: [...proposal.targetIds], range: proposal.range ? { ...proposal.range } : null }
}
