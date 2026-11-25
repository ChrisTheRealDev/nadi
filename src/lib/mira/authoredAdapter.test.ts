import { describe, expect, it, vi } from 'vitest'
import { AUTHORED_MIRA_HELP, authoredMiraResponse, clearMiraResponseForReport } from './authoredAdapter'
import { createMiraBrowserAdapter } from './browserTransport'
import { parseMiraResponse, type MiraRequestDto, type MiraSupportLevel } from './contracts'

const request: MiraRequestDto = {
  version: 1,
  question: 'What should I try?',
  lessonId: 'session-6',
  objectiveId: 'phrase-revision',
  intention: 'Make the phrase feel gentle.',
  facts: [{ key: 'noteCount', value: 4 }],
  attempt: { summary: 'I changed one rhythm.', support: 'example' },
  project: { id: 'project-AbCd1234', revision: 2, contentFingerprint: 'fnv1a32-1234abcd', selectedArtifactIds: [] },
}

describe('Mira authored/browser adapters', () => {
  it('keeps child and unknown routes fully local even when fetch exists', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    const adapter = createMiraBrowserAdapter({ route: 'child-or-unknown-local', fetch: fetchSpy, requestId: () => 'local-request' })
    const response = await adapter.ask(request)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(response.source).toBe('authored')
    expect(response.privacy.transmission).toBe('not-sent')
    expect(response.content.proposal).toBeNull()
    expect(response.content.nextStep).toContain('example is support')
    expect(response.content.nextStep).toContain('fresh retry')
  })

  it('uses same-origin credentialed transport without putting capability in JavaScript', async () => {
    const liveResponse = {
      version: 1,
      source: 'live',
      category: 'answer',
      requestId: 'request-live-1',
      liveStatus: 'completed',
      content: { observation: 'One note is selected.', intentionConnection: 'A quieter note may fit.', nextStep: 'Preview it.', question: null, proposal: null },
      report: { available: true, label: 'Hide this and show your supervisor', instruction: 'This hides the response on this screen. Please show this to your supervisor; nothing is sent automatically.' },
      privacy: { transmission: 'sent', notice: 'Online AI processed the bounded request. Standard provider abuse-monitoring retention may apply; store:false is not Zero Data Retention.' },
      budget: { reservedMicrousd: 1000, remainingMicrousd: 9000 },
    }
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(liveResponse)))
    const adapter = createMiraBrowserAdapter({ route: 'supervised-teen-pilot', fetch: fetchSpy })
    expect(await adapter.ask(request)).toEqual(liveResponse)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/mira')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).not.toHaveProperty('authorization')
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('capability')
  })

  it('fails closed to explicit authored help when the network or response schema fails', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret upstream failure'))
    const response = await createMiraBrowserAdapter({ route: 'supervised-teen-pilot', fetch: fetchSpy, requestId: () => 'fallback-1' }).ask(request)
    expect(response).toMatchObject({ source: 'authored', category: 'provider-error', requestId: 'fallback-1' })
    expect(response.privacy.transmission).toBe('unknown')
    expect(JSON.stringify(response)).not.toContain('secret upstream failure')
  })

  it('reporting clears the response and pauses live help without claiming delivery', () => {
    expect(clearMiraResponseForReport()).toEqual({
      visible: false,
      livePaused: true,
      response: null,
      supervisorInstruction: 'Please show this to your supervisor. Nothing was sent automatically.',
    })
  })

  it('bounds a hung live request and falls back with unknown transmission', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = createMiraBrowserAdapter({ route: 'supervised-teen-pilot', fetch: fetchSpy, timeoutMs: 250, requestId: () => 'timeout-1' }).ask(request)
    await vi.advanceTimersByTimeAsync(251)
    await expect(pending).resolves.toMatchObject({ source: 'authored', category: 'provider-error', privacy: { transmission: 'unknown' } })
    vi.useRealTimers()
  })

  it('provides objective-keyed authored help and makes example support require a fresh retry', async () => {
    const adapter = createMiraBrowserAdapter({ route: 'child-or-unknown-local', requestId: () => 'local-help' })
    const scenarios = [
      ['session-1', 'no-sound-signal'],
      ['session-2', 'pulse-downbeat-fresh-bar'],
      ['session-3', 'am-ace-fresh-repair'],
      ['session-4', 'f-c-g-chord-repair'],
      ['session-5', 'clip-shared-unique-repair'],
      ['session-6', 'phrase-space-keep-revise-fresh-answer'],
      ['session-7', 'audible-variation-identify'],
      ['session-8', 'velocity-gain-reverb-peak-mix-repair'],
      ['transfer', 'am-f-two-bar-transfer'],
      ['fl-studio', 'midi-import-route-gain'],
    ]
    for (const [lessonId, objectiveId] of scenarios) {
      const response = await adapter.ask({ ...request, lessonId, objectiveId })
      expect(response.content.observation).not.toContain('only the lesson facts')
      expect(response.content.nextStep).toMatch(/fresh|clear/i)
      expect(response.content.proposal).toBeNull()
    }
    const nudge = await adapter.ask({ ...request, lessonId: 'session-6', objectiveId: 'phrase-space', attempt: { ...request.attempt, support: 'nudge' } })
    const cue = await adapter.ask({ ...request, lessonId: 'session-6', objectiveId: 'phrase-space', attempt: { ...request.attempt, support: 'cue' } })
    expect(nudge.content.nextStep).not.toBe(cue.content.nextStep)
  })

  it('keeps every authored entry and support level inside the shared response contract at maximum DTO bounds', () => {
    const supports: MiraSupportLevel[] = ['none', 'nudge', 'cue', 'example']
    for (const entry of AUTHORED_MIRA_HELP) {
      for (const support of supports) {
        const maximum: MiraRequestDto = {
          ...request,
          lessonId: entry.lesson,
          objectiveId: entry.objectiveTerms[0] ?? 'generic',
          question: 'q'.repeat(500),
          intention: 'i'.repeat(240),
          attempt: { summary: 'a'.repeat(360), support },
          project: { ...request.project, selectedArtifactIds: ['clip-melody-a@note-1'] },
        }
        const response = authoredMiraResponse(maximum, `local-${entry.id}-${support}`)
        expect(response.content.intentionConnection.length).toBeLessThanOrEqual(280)
        expect(response.content.nextStep.length).toBeLessThanOrEqual(280)
        expect(parseMiraResponse(response), `${entry.id}/${support}`).toMatchObject({ ok: true })
      }
    }
  })
})
