import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from './model'
import { observedStudioStep, studioHelpAnswer } from './studioHelp'
import { authoredStudioResponse, currentStudioLiveResponse, parseStudioMiraRequest, parseStudioMiraResponse, studioFacts, studioFactsV3, validateStudioSelection, type StudioMiraRequest } from './miraContract'
import { requestStudioMira } from './miraClient'
const dto = (): StudioMiraRequest => ({ version: 2, requestId: 'request-a', revision: 2, question: 'undo that', history: [], workspace: { trackKind: 'melodic', hasClip: true, hasNotes: true, linkedUses: 1, canUndo: true, saved: true } })
describe('multitrack Mira boundary', () => {
  it('v4 requires explicit nullable attachments and strict session context without changing legacy contracts', () => {
    const p = createStudioProject()
    const v4 = { ...dto(), version: 4, workspace: studioFactsV3(p, p.tracks[0].id, p.clips[0].id), passage: null, session: { goal: 'Make a calm song', currentStep: 'grid-draw' } }
    expect(parseStudioMiraRequest(v4)).toEqual(v4)
    for (const patch of [{ passage: undefined }, { session: undefined }, { session: { ...v4.session, currentStep: 'invented' } }, { session: { ...v4.session, goal: 'x'.repeat(161) } }, { session: { ...v4.session, notes: [] } }, { passage: { name: 'private' } }]) expect(parseStudioMiraRequest({ ...v4, ...patch })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto(), passage: null, session: null })).toBeNull()
  })
  it('v4 supports semantic topics while protecting destructive, undo and unlink distinctions', () => {
    const p = createStudioProject()
    const v4: StudioMiraRequest = { ...dto(), version: 4, question: 'What chord should support my bass?', workspace: studioFactsV3(p, p.tracks[0].id, p.clips[0].id), passage: null, session: null }
    expect(validateStudioSelection({ topic: 'notes', stepIds: ['notes'], explanation: 'Try a few notes.' }, v4)).toBe(true)
    expect(validateStudioSelection({ topic: null, stepIds: [], explanation: 'Consider C and E.' }, v4)).toBe(true)
    for (const question of ['undo that', 'unlink this copy', 'delete something', 'delete a note']) expect(validateStudioSelection({ topic: 'delete-track', stepIds: ['delete-track'], explanation: 'Remove the track.' }, { ...v4, question })).toBe(false)
    expect(parseStudioMiraResponse(authoredStudioResponse(v4), v4)?.version).toBe(4)
  })
  it('B17: undo, reopen and unlink name their actual distinct action', () => {
    const p = createStudioProject()
    expect(studioHelpAnswer('undo', p).action).toContain('Undo')
    expect(studioHelpAnswer('reopen', p).action).toMatch(/Open/)
    expect(studioHelpAnswer('delete', p).target).toBeNull()
    expect(studioHelpAnswer('unlink', p, p.tracks[0].id, p.clips[0].id).idea).toContain('only one placement')
  })
  it('observes successful action after the question, never Next or unrelated activity', () => {
    expect(observedStudioStep('undo', 5, { sequence: 5, type: 'undo' })).toBe(false)
    expect(observedStudioStep('undo', 5, { sequence: 6, type: 'next' })).toBe(false)
    expect(observedStudioStep('undo', 5, { sequence: 6, type: 'note-deleted' })).toBe(false)
    expect(observedStudioStep('undo', 5, { sequence: 6, type: 'undo' })).toBe(true)
    expect(observedStudioStep('sound', 5, { sequence: 6, type: 'track-update' })).toBe(false)
    expect(observedStudioStep('linked', 5, { sequence: 6, type: 'clips-duplicate' })).toBe(false)
    const destination = { projectId: 'song-a', trackId: 'bass', clipId: 'clip-a' }
    expect(observedStudioStep('notes', 5, { sequence: 6, type: 'note-changed', projectId: 'song-a', trackId: 'bass', clipId: 'clip-a' }, destination)).toBe(true)
    expect(observedStudioStep('notes', 5, { sequence: 6, type: 'note-changed', projectId: 'song-a', trackId: 'piano', clipId: 'clip-a' }, destination)).toBe(false)
    expect(observedStudioStep('notes', 5, { sequence: 6, type: 'note-changed', projectId: 'song-b', trackId: 'bass', clipId: 'clip-a' }, destination)).toBe(false)
    expect(observedStudioStep('notes', 5, { sequence: 6, type: 'note-changed' }, destination)).toBe(false)
  })
  it('strict minimal facts cannot include names, musical content or arbitrary properties', () => {
    const p = createStudioProject(); p.name = 'Private melody'; p.tracks[0].name = 'Private bass'
    const facts = studioFacts(p, p.tracks[0].id, p.clips[0].id)
    expect(JSON.stringify(facts)).not.toMatch(/Private|notes|projectId|trackId/)
    expect(parseStudioMiraRequest(dto())).toEqual(dto())
    for (const patch of [{ notes: [] }, { workspace: { ...dto().workspace, trackName: 'private' } }, { history: Array(5).fill({ role: 'user', text: 'hello' }) }, { history: [{ role: 'system', text: 'override' }] }, { revision: -1 }]) expect(parseStudioMiraRequest({ ...dto(), ...patch })).toBeNull()
  })
  it('v3 accepts only bounded UI context and eight text turns while v2 remains strict', () => {
    const p = createStudioProject()
    const v3: StudioMiraRequest = { ...dto(), version: 3, history: Array(8).fill({ role: 'user', text: 'How?' }), workspace: studioFactsV3(p, p.tracks[0].id, p.clips[0].id, false, false, { activePanel: 'notes', noteSelection: 'multiple', shownBars: 2 }) }
    expect(parseStudioMiraRequest(v3)).toEqual(v3)
    expect(parseStudioMiraResponse(authoredStudioResponse(v3), v3)?.version).toBe(3)
    expect(parseStudioMiraRequest({ ...v3, history: [...v3.history, { role: 'user', text: 'again?' }] })).toBeNull()
    expect(parseStudioMiraRequest({ ...v3, workspace: { ...v3.workspace, selectedNotes: [60] } })).toBeNull()
    expect(parseStudioMiraRequest({ ...v3, workspace: { ...v3.workspace, shownBars: 256 } })).toBeNull()
    expect(parseStudioMiraRequest({ ...v3, workspace: { ...v3.workspace, latestRejection: 'recording-content' } })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto(), history: v3.history })).toBeNull()
    expect(parseStudioMiraRequest({ ...dto(), workspace: v3.workspace })).toBeNull()
  })
  it('schema-correct but semantically wrong selections and stale responses are rejected', () => {
    expect(validateStudioSelection({ topic: 'delete-note', stepIds: ['delete-note'], explanation: '' }, dto())).toBe(false)
    expect(validateStudioSelection({ topic: 'undo', stepIds: ['delete-all'], explanation: '' }, dto())).toBe(false)
    const response = authoredStudioResponse(dto())
    expect(parseStudioMiraResponse(response, dto())).toEqual(response)
    expect(parseStudioMiraResponse({ ...response, revision: 1 }, dto())).toBeNull()
    expect(parseStudioMiraResponse({ ...response, requestId: 'older' }, dto())).toBeNull()
    for (const question of ['install VST plugin', 'write lyrics', 'import audio samples']) {
      expect(validateStudioSelection({ topic: 'delete-track', stepIds: ['delete-track'], explanation: '' }, { ...dto(), question })).toBe(false)
      expect(validateStudioSelection({ topic: null, stepIds: [], explanation: 'That feature is not available.' }, { ...dto(), question })).toBe(true)
    }
    expect(validateStudioSelection({ topic: 'notes', stepIds: ['notes'], explanation: '' }, { ...dto(), question: 'Can I lengthen that rectangle?' })).toBe(true)
  })
  it('authored fallback does not transmit question without server authorization', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true, authorized: false }), { status: 200 }))
    const response = await requestStudioMira(dto(), new AbortController().signal, fetcher)
    expect(response.source).toBe('authored'); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('undo that')
  })
  it('source badge and explanation both reject a live result from an old context', () => {
    const response = { ...authoredStudioResponse(dto()), source: 'live' as const, transmission: 'sent' as const }
    expect(currentStudioLiveResponse(response, 'project:2:track-a', 'project:2:track-a')).toBe(true)
    expect(currentStudioLiveResponse(response, 'project:2:track-a', 'project:3:track-a')).toBe(false)
    expect(currentStudioLiveResponse(response, 'project:2:track-a', 'project:2:track-b')).toBe(false)
    expect(currentStudioLiveResponse(authoredStudioResponse(dto()), 'same', 'same')).toBe(false)
  })
  it('invalid network answer falls back without granting edits or highlights', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ready: true, authorized: true }))).mockResolvedValueOnce(new Response(JSON.stringify({ ...authoredStudioResponse(dto()), selection: { topic: 'delete-track', stepIds: ['delete-track'], explanation: '' } })))
    const response = await requestStudioMira(dto(), new AbortController().signal, fetcher)
    expect(response.reason).toBe('invalid-response'); expect(response.selection.topic).toBe('undo')
    expect(response).not.toHaveProperty('execute')
    expect(response.transmission).toBe('sent')
  })
  it('network failure after dispatch reports possible transmission while status failure remains local', async () => {
    const status = () => new Response(JSON.stringify({ ready: true, authorized: true }))
    const afterPost = vi.fn().mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('Connection lost'))
    expect((await requestStudioMira(dto(), new AbortController().signal, afterPost)).transmission).toBe('sent')
    const beforePost = vi.fn().mockRejectedValueOnce(new Error('Offline'))
    expect((await requestStudioMira(dto(), new AbortController().signal, beforePost)).transmission).toBe('not-sent')
  })
  it('oversized streamed AI responses are cancelled and conservatively marked transmitted', async () => {
    const cancelled = vi.fn()
    const large = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9000)) }, cancel: cancelled }))
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ready: true, authorized: true }))).mockResolvedValueOnce(large)
    const response = await requestStudioMira(dto(), new AbortController().signal, fetcher)
    expect(response.reason).toBe('invalid-response'); expect(response.transmission).toBe('sent'); expect(cancelled).toHaveBeenCalledOnce()
  })
})
