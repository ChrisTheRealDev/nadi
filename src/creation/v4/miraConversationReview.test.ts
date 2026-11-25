import { describe, expect, it, vi } from 'vitest'
import { requestStudioMira, studioMiraAvailability } from './miraClient'
import { createStudioProject } from './model'
import { addTrack } from './operations'
import { routeStudioQuestion, studioQuestionAnswer } from './studioHelp'
import type { StudioMiraRequest } from './miraContract'

const request = (): StudioMiraRequest => ({ version: 2, requestId: 'review-request', revision: 0, question: 'What is a chord?', history: [], workspace: { trackKind: 'melodic', hasClip: true, hasNotes: false, linkedUses: 1, canUndo: false, saved: true } })
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('conversational Mira readiness boundary', () => {
  it.each([
    [{ ready: true, authorized: true }, 'ready'],
    [{ ready: false, authorized: false }, 'disabled'],
    [{ ready: true, authorized: false }, 'unauthorized'],
    [{ ready: false, authorized: true }, 'disabled'],
    [{ ready: 'true', authorized: true }, 'unavailable'],
    [{ ready: true }, 'unavailable'],
    [null, 'unavailable'],
  ])('reads status without sending a question or a provider request: %j', async (body, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body))
    expect(await studioMiraAvailability(new AbortController().signal, fetcher)).toBe(expected)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('/api/mira/creation/status')
    const options = fetcher.mock.calls[0][1]
    expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
    expect(options?.method).not.toBe('POST'); expect(options?.body).toBeUndefined()
  })

  it('fails closed on bad HTTP, oversized JSON and network cancellation', async () => {
    for (const response of [new Response('', { status: 503 }), json({ ready: true, authorized: true, extra: 'x'.repeat(1100) }), new Response('not json')]) {
      expect(await studioMiraAvailability(new AbortController().signal, vi.fn<typeof fetch>().mockResolvedValue(response))).toBe('unavailable')
    }
    expect(await studioMiraAvailability(new AbortController().signal, vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Stopped', 'AbortError')))).toBe('unavailable')
  })

  it('never POSTs when the server or session is not ready', async () => {
    for (const status of [{ ready: false, authorized: false }, { ready: true, authorized: false }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(status))
      const response = await requestStudioMira(request(), new AbortController().signal, fetcher)
      expect(fetcher).toHaveBeenCalledOnce(); expect(response.source).toBe('authored'); expect(response.transmission).toBe('not-sent')
    }
  })

  it('accepts a real null-topic explanation without inventing a highlight', async () => {
    const dto = request()
    const reply = { version: 2, requestId: dto.requestId, revision: dto.revision, source: 'live', reason: 'validated-selection', transmission: 'sent', selection: { topic: null, stepIds: [], explanation: 'A chord is several notes played together. It can make a melody feel settled or tense.' } }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ready: true, authorized: true })).mockResolvedValueOnce(json(reply))
    expect(await requestStudioMira(dto, new AbortController().signal, fetcher)).toEqual(reply)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(dto)
  })
})

describe('chord-moving authored fallback', () => {
  it('names selection and group movement without pretending to be AI or changing notes', () => {
    const project = createStudioProject(), question = 'How do I move all three notes of my chord together?'
    project.patterns[0].notes = [60, 64, 67].map((pitch, index) => ({ id: `chord-${index}`, pitch, startTick: 73, durationTicks: 481, velocity: 90 }))
    const before = JSON.stringify(project)
    const topic = routeStudioQuestion(question)
    expect(topic).toBe('move-notes')
    const answer = studioQuestionAnswer(question, topic!, project, project.tracks[0].id, project.clips[0].id, { noteSelection: 'multiple' })
    expect(answer.action).toContain('middle'); expect(answer.action).toContain('Select chord'); expect(answer.differently).toContain('right-edge handle'); expect(answer.target).toBe('note-body')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('does not suggest piano chord controls when the destination is missing or percussion', () => {
    const project = addTrack(createStudioProject(), 'kick'), question = 'Move these chord notes together'
    expect(studioQuestionAnswer(question, 'notes', project).target).toBe('pattern-playlist')
    const drums = project.tracks.at(-1)!, clip = project.clips.find(item => item.trackId === drums.id)!
    const answer = studioQuestionAnswer(question, 'notes', project, drums.id, clip.id)
    expect(answer.target).toBe('drum-timeline'); expect(answer.action).not.toContain('Select chord')
  })
})
