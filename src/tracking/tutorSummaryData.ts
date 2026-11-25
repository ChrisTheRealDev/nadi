import type { StudioProject } from '../creation/v4/model'
import { analyzePlayability } from '../creation/v4/playability'

export const EVIDENCE_IDS = ['notes', 'parts', 'unplaced-parts', 'added-notes', 'removed-notes', 'rhythm-changes', 'pitch-changes', 'tempo', 'captures', 'playability', 'complete-exchanges', 'pending-exchanges', 'failed-exchanges'] as const
export type EvidenceId = typeof EVIDENCE_IDS[number]
export interface TutorFact { id: EvidenceId; values: number[] }
export interface TutorEvidence { version: 1; revision: number; previousRevision: number | null; facts: TutorFact[] }
export const TEACHING_ACTIONS = ['listen-and-compare', 'ask-about-choice', 'review-with-performer', 'ask-what-help-is-needed'] as const
export type TeachingAction = typeof TEACHING_ACTIONS[number]
export interface TutorClaim { evidenceId: EvidenceId; action: TeachingAction }
export interface TutorInterpretation { claims: TutorClaim[] }
export interface TutorSummaryRequest { requestId: string; evidence: TutorEvidence }
export interface ExchangeCounts { complete: number; pending: number; failed: number }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const whole = (v: unknown, max = 1_000_000) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max

/** Only numbers and authored enum identifiers leave the browser. No user text is a model input. */
export function buildTutorEvidence(current: StudioProject, previous?: StudioProject, counts?: ExchangeCounts): TutorEvidence {
  const notes = current.patterns.flatMap(p => p.notes), before = previous?.patterns.flatMap(p => p.notes) ?? []
  const old = new Map(before.map(n => [n.id, n])), present = new Set(notes.map(n => n.id))
  const facts: TutorFact[] = [
    { id: 'notes', values: [notes.length] }, { id: 'parts', values: [current.tracks.length] },
    { id: 'unplaced-parts', values: [current.patterns.filter(p => !current.clips.some(c => c.patternId === p.id)).length] },
    { id: 'captures', values: [current.ideas.length] },
    { id: 'playability', values: [analyzePlayability(current).findings.filter(f => f.severity !== 'information').length] },
  ]
  if (previous) facts.push(
    { id: 'added-notes', values: [notes.filter(n => !old.has(n.id)).length] },
    { id: 'removed-notes', values: [before.filter(n => !present.has(n.id)).length] },
    { id: 'rhythm-changes', values: [notes.filter(n => { const p = old.get(n.id); return p && (n.startTick !== p.startTick || n.durationTicks !== p.durationTicks) }).length] },
    { id: 'pitch-changes', values: [notes.filter(n => { const p = old.get(n.id); return p && n.pitch !== p.pitch }).length] },
    { id: 'tempo', values: [previous.bpm, current.bpm] },
  )
  if (counts) facts.push({ id: 'complete-exchanges', values: [counts.complete] }, { id: 'pending-exchanges', values: [counts.pending] }, { id: 'failed-exchanges', values: [counts.failed] })
  return { version: 1, revision: current.revision, previousRevision: previous?.revision ?? null, facts }
}
export function parseTutorEvidence(value: unknown): TutorEvidence | null {
  if (!record(value) || !exact(value, ['version', 'revision', 'previousRevision', 'facts']) || value.version !== 1 || !whole(value.revision, Number.MAX_SAFE_INTEGER) || value.previousRevision !== null && !whole(value.previousRevision, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > EVIDENCE_IDS.length) return null
  const seen = new Set<string>()
  for (const fact of value.facts) {
    if (!record(fact) || !exact(fact, ['id', 'values']) || !EVIDENCE_IDS.includes(fact.id as EvidenceId) || seen.has(String(fact.id)) || !Array.isArray(fact.values)) return null
    seen.add(String(fact.id))
    if (fact.id === 'tempo') { if (fact.values.length !== 2 || fact.values.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 30 || n > 300)) return null }
    else if (fact.values.length !== 1 || !whole(fact.values[0])) return null
  }
  if (value.previousRevision === null && value.facts.some(f => ['added-notes', 'removed-notes', 'rhythm-changes', 'pitch-changes', 'tempo'].includes(f.id))) return null
  return value as unknown as TutorEvidence
}
export function parseTutorSummaryRequest(value: unknown): TutorSummaryRequest | null {
  return record(value) && exact(value, ['requestId', 'evidence']) && typeof value.requestId === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value.requestId) && parseTutorEvidence(value.evidence) ? value as unknown as TutorSummaryRequest : null
}
export function allowedTeachingActions(id: EvidenceId): readonly TeachingAction[] {
  if (id === 'playability') return ['review-with-performer', 'ask-about-choice']
  if (id.endsWith('exchanges') || id === 'unplaced-parts' || id === 'captures') return ['ask-what-help-is-needed', 'ask-about-choice']
  return ['listen-and-compare', 'ask-about-choice']
}
/** Model prose is deliberately not accepted. Each displayed observation comes from verified local facts. */
export function parseTutorInterpretation(value: unknown, evidence: TutorEvidence): TutorInterpretation | null {
  if (!record(value) || !exact(value, ['claims']) || !Array.isArray(value.claims) || value.claims.length < 1 || value.claims.length > 4) return null
  const used = new Set<string>()
  for (const claim of value.claims) {
    if (!record(claim) || !exact(claim, ['evidenceId', 'action']) || !evidence.facts.some(f => f.id === claim.evidenceId) || used.has(String(claim.evidenceId)) || !allowedTeachingActions(claim.evidenceId as EvidenceId).includes(claim.action as TeachingAction)) return null
    used.add(String(claim.evidenceId))
  }
  return value as unknown as TutorInterpretation
}
export function tutorFactText(fact: TutorFact): string {
  const n = fact.values[0]
  const descriptions: Record<Exclude<EvidenceId, 'tempo'>, string> = {
    notes: `${n} stored notes, including unplaced parts.`, parts: `${n} instrument tracks.`, 'unplaced-parts': `${n} patterns are not placed in the arrangement.`,
    'added-notes': `${n} note identities were added since the comparison revision.`, 'removed-notes': `${n} note identities were removed since the comparison revision.`,
    'rhythm-changes': `${n} retained notes changed timing or duration.`, 'pitch-changes': `${n} retained notes changed sounding pitch.`, captures: `${n} finalized Idea Pad captures; their contents are not analyzed here.`,
    playability: `${n} grouped range or conventional single-player overlap findings need review.`,
    'complete-exchanges': `${n} completed Mira exchanges are recorded; their text is not included.`, 'pending-exchanges': `${n} Mira exchanges have no finalized response yet.`, 'failed-exchanges': `${n} Mira exchanges are marked failed.`,
  }
  return fact.id === 'tempo' ? n === fact.values[1] ? `Tempo remains ${n} BPM.` : `Tempo changed from ${n} to ${fact.values[1]} BPM.` : descriptions[fact.id]
}
export const TEACHING_ACTION_TEXT: Record<TeachingAction, string> = {
  'listen-and-compare': 'Listen to this revision and, when available, its predecessor before deciding what feedback will help.',
  'ask-about-choice': 'Ask the student to explain the musical choice and what they want to try next.',
  'review-with-performer': 'Review the highlighted passage with the student and intended performer before choosing an alternative.',
  'ask-what-help-is-needed': 'Ask the student whether they need help; the recorded count alone does not establish difficulty or understanding.',
}
