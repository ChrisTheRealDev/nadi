import { describe, expect, it, vi } from 'vitest'
import type { MiraRequestDto } from '../../src/lib/mira/contracts'
import { createOpenAIResponsesProvider } from './provider'

const request: MiraRequestDto = {
  version: 1,
  question: 'How can I make this gentler?',
  lessonId: 'session-6',
  objectiveId: 'phrase-revision',
  intention: 'gentle',
  facts: [{ key: 'selectedVelocity', value: 72 }],
  attempt: { summary: 'Changed one note.', support: 'cue' },
  project: { id: 'project-AbCd1234', revision: 3, contentFingerprint: 'fnv1a32-1234abcd', selectedArtifactIds: ['clip-melody-a@note-1'] },
}

const payload = {
  observation: 'The selected note has velocity 72.',
  intentionConnection: 'A quieter preview may fit your gentle intention.',
  nextStep: 'Preview a lower velocity.',
  question: null,
  proposal: { kind: 'set-note-velocity', targetIds: ['clip-melody-a@note-1'], value: 58, range: null },
}

function providerWith(response: unknown, status = 200) {
  const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } }))
  return {
    fetchSpy,
    provider: createOpenAIResponsesProvider({
      apiKey: 'sk-test-never-real-123456789012345',
      model: 'gpt-6-astra',
      maxOutputTokens: 320,
      fetch: fetchSpy,
    }),
  }
}

describe('OpenAI Responses Mira provider', () => {
  it('uses the official bounded stateless strict schema request without tools or old sampling knobs', async () => {
    const { provider, fetchSpy } = providerWith({
      status: 'completed',
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      usage: { input_tokens: 111, output_tokens: 42 },
    })
    await expect(provider.createResponse(request, new AbortController().signal)).resolves.toEqual({
      status: 'completed', payload, usage: { inputTokens: 111, outputTokens: 42 },
    })
    const init = fetchSpy.mock.calls[0][1]
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'gpt-6-astra', reasoning: { effort: 'low' }, store: false, max_output_tokens: 320 })
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.text.format.schema.additionalProperties).toBe(false)
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(String(init?.body)).not.toContain('sk-test-never-real')
  })

  it('finds refusals without assuming output[0] and classifies incomplete/malformed/provider errors', async () => {
    const refusal = providerWith({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }).provider
    await expect(refusal.createResponse(request, new AbortController().signal)).resolves.toEqual({ status: 'refusal' })
    const incomplete = providerWith({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }).provider
    await expect(incomplete.createResponse(request, new AbortController().signal)).resolves.toEqual({ status: 'incomplete' })
    const malformed = providerWith({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }).provider
    await expect(malformed.createResponse(request, new AbortController().signal)).resolves.toEqual({ status: 'malformed' })
    const providerError = providerWith({ error: { message: 'upstream secret detail' } }, 500).provider
    const result = await providerError.createResponse(request, new AbortController().signal)
    expect(result).toEqual({ status: 'error' })
    expect(JSON.stringify(result)).not.toContain('upstream secret detail')
  })
})
