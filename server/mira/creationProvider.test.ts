import { describe, expect, it, vi } from 'vitest'
import type { CreationMiraRequest } from '../../src/creation/mira/contracts'
import { loadCreationMiraConfig } from './creationConfig'
import { createCreationProvider } from './creationProvider'
import { authoredResponse } from '../../src/creation/mira/registry'
const dto: CreationMiraRequest = { version: 1, question: 'Change a note', workspace: { projectId: 'do-not-transmit-project', revision: 23, selectedBar: 5, editor: 'piano', selectedNote: false, hasPianoNotes: true, hasDrumHits: false, visibleDrumRows: [], mutedInstruments: [], saved: true } }
const config = loadCreationMiraConfig({ OPENAI_API_KEY: 'not-a-real-key-but-at-least-20-characters' })
const output = (payload: unknown) => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(payload) }] }], usage: { input_tokens: 20, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } })
describe('creation Structured Outputs provider', () => {
  it('sends strict schema, no tools and no identifiers or complete project', async () => {
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body))
      expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true); expect(body.text.format.type).toBe('json_schema')
      expect(body).not.toHaveProperty('tools')
      const userText = body.input[0].content[0].text
      expect(userText).not.toContain(dto.workspace.projectId)
      expect(userText).not.toContain('revision'); expect(userText).not.toContain('selectedBar'); expect(userText).not.toContain('notes')
      return output({ topic: 'note', stepIds: ['note-select', 'note-change'] })
    })
    const result = await createCreationProvider(config, fetcher as typeof fetch).createResponse(dto, new AbortController().signal)
    expect(result.selection?.topic).toBe('note'); expect(result.usage?.inputTokens).toBe(20)
  })
  it('rejects schema-valid but context-invalid instructions', async () => {
    const fetcher = vi.fn(async () => output({ topic: 'note', stepIds: ['note-change'] }))
    expect((await createCreationProvider(config, fetcher).createResponse(dto, new AbortController().signal)).selection).toBeNull()
  })
  it('supports audited beginner selections with an exact workspace-specific map and no actions', async () => {
    for (const question of ["I don't know where to start", 'What is a tick?', 'I want to change this sound']) {
      const request = { ...dto, question }
      const selection = authoredResponse(request).selection
      const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
        const body = JSON.parse(String(options?.body))
        expect(body.instructions).toContain('sound-choice to clarify')
        expect(body.instructions).toContain('"start":["start-play"]')
        expect(body.instructions).toContain('"tick":["term-tick"]')
        expect(body.text.format.schema.additionalProperties).toBe(false)
        expect(body).not.toHaveProperty('tools')
        return output(selection)
      })
      expect((await createCreationProvider(config, fetcher).createResponse(request, new AbortController().signal)).selection).toEqual(selection)
    }
  })
  it('rejects unsafe extra payloads and reordered new help sequences', async () => {
    for (const selection of [
      { topic: 'sound-choice', stepIds: ['sound-clarify'], edit: { instrument: 'guitar' } },
      { topic: 'start', stepIds: ['start-play'], play: [60, 64, 67] },
      { topic: 'tick', stepIds: ['term-tick', 'note-change'] },
      { topic: null, stepIds: ['sound-test'] },
    ]) {
      const fetcher = vi.fn(async () => output(selection))
      expect((await createCreationProvider(config, fetcher).createResponse(dto, new AbortController().signal)).selection).toBeNull()
    }
  })
  it('fails closed on refusals and incomplete responses', async () => {
    for (const raw of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }))
      expect((await createCreationProvider(config, fetcher).createResponse(dto, new AbortController().signal)).selection).toBeNull()
    }
  })
})
