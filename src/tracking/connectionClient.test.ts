import { describe, expect, it, vi } from 'vitest'
import { parsePlannerData, TrackingClient } from './client'

const reply = (value: unknown) => new Response(JSON.stringify(value))
const identity = { profile: { id: 'student', display_name: 'Test learner', role: 'student' }, disclosureAccepted: true, learners: [] }
const planner = { goals: [], projects: [] }
async function signedIn() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ accessToken: 'test-access', refreshToken: 'test-refresh', expiresIn: 3600 })).mockResolvedValueOnce(reply(identity))
  const client = new TrackingClient(fetcher)
  await client.login('fixture@example.test', 'test-only'); await client.workspace()
  return { client, fetcher }
}
describe('feedback and planner account boundaries', () => {
  it('rejects a different actor before transmitting', async () => {
    const { client, fetcher } = await signedIn()
    await expect(client.feedbackRead('another-student')).rejects.toThrow('Account changed')
    await expect(client.plannerCommand('another-student', 'step-add', {})).rejects.toThrow('Account changed')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('reads the account inbox without requiring a manually chosen project', async () => {
    const { client, fetcher } = await signedIn()
    fetcher.mockResolvedValueOnce(reply({ items: [] }))
    await client.feedbackRead('student')
    expect(fetcher.mock.calls[2][0]).toBe('/api/v1/feedback')
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer test-access' })
  })
  it('rejects a late planner response after signout even when transport ignores abort', async () => {
    const { client, fetcher } = await signedIn()
    let finish!: (response: Response) => void
    const started = new Promise<void>(resolve => fetcher.mockImplementationOnce(() => { resolve(); return new Promise(done => { finish = done }) }))
    const pending = client.plannerRead('student', 'student')
    await started; client.signOut(); finish(reply(planner))
    await expect(pending).rejects.toThrow('Session changed')
  })
  it('does not accept an empty response as a confirmed write', async () => {
    const { client, fetcher } = await signedIn()
    fetcher.mockResolvedValueOnce(reply({}))
    await expect(client.feedbackCommand('student', 'question', { mutationId: 'test', message: 'Question' })).rejects.toThrow('could not be read')
  })
  it('keeps mutation identity unchanged when forwarding a retry', async () => {
    const { client, fetcher } = await signedIn()
    fetcher.mockImplementation(async () => reply({ saved: true }))
    const payload = { mutationId: 'stable-id', message: 'Question' }
    await client.feedbackCommand('student', 'question', payload)
    await client.feedbackCommand('student', 'question', payload)
    expect(fetcher.mock.calls[2][1]?.body).toBe(fetcher.mock.calls[3][1]?.body)
  })
})
describe('planner response validation', () => {
  it('keeps heavy musical data out of the planner', () => {
    expect(parsePlannerData({ ...planner, recordings: ['private'], manifest: { notes: [] } })).toEqual(planner)
  })
  it.each([null, {}, { goals: [], projects: null }, { goals: [{ steps: [], reviews: [], review: null }], projects: [] }])('rejects malformed server data', value => {
    expect(() => parsePlannerData(value)).toThrow('could not be read')
  })
})
