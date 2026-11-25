import { describe, expect, it, vi } from 'vitest'
import { deliverFeedback, feedbackReply } from './feedbackOutbox'
import { groupFeedback, parseFeedback, type FeedbackItem } from './feedbackTypes'

describe('durable feedback delivery', () => {
  it('supports an account-level question without requiring an assignment', () => {
    expect(feedbackReply('new-question', 'Can I ask about phrasing?', null, 'id')).toMatchObject({ kind: 'question', shared: false, payload: { mutationId: 'id', message: 'Can I ask about phrasing?' } })
    expect(feedbackReply('new-question', 'Question', null, 'id').payload).not.toHaveProperty('goalId')
  })
  it('persists before delivery and retries with the same mutation identifier', async () => {
    const calls: string[] = [], saved = feedbackReply('comment:thread', 'Hello', 'snapshot', 'mutation')
    const store = { put: vi.fn(async () => { calls.push('persist') }), removeRecord: vi.fn(async () => { calls.push('remove') }) }
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => { calls.push('send'); return { saved: true } })
    await expect(deliverFeedback(store, saved, send)).rejects.toThrow('offline')
    expect(store.removeRecord).not.toHaveBeenCalled()
    await expect(deliverFeedback(store, saved, send)).resolves.toMatchObject({ cleaned: true })
    expect(send.mock.calls[0][0].payload.mutationId).toBe(send.mock.calls[1][0].payload.mutationId)
    expect(calls).toEqual(['persist', 'persist', 'send', 'remove'])
  })
  it.each([{}, { saved: false }, null])('retains pending shared updates without a valid acknowledgement', async receipt => {
    const store = { put: vi.fn().mockResolvedValue(undefined), removeRecord: vi.fn() }
    await expect(deliverFeedback(store, feedbackReply('comment:t', 'message', null, 'id'), async () => receipt)).rejects.toThrow('acknowledgement')
    expect(store.removeRecord).not.toHaveBeenCalled()
  })
  it('distinguishes confirmed server delivery from local cleanup failure', async () => {
    const store = { put: vi.fn().mockResolvedValue(undefined), removeRecord: vi.fn().mockRejectedValue(new Error('disk')) }
    await expect(deliverFeedback(store, feedbackReply('comment:t', 'message', null, 'id'), async () => ({ saved: true }))).resolves.toEqual({ receipt: { saved: true }, cleaned: false })
  })
  it.each([['comment:t', 'reply', 'threadId'], ['question:q', 'question-reply', 'questionId'], ['checkpoint:c', 'checkpoint-reply', 'checkpointId']])('routes %s to its own authorized discussion endpoint', (thread, kind, field) => {
    const pending = feedbackReply(thread, 'message', 'revision', 'same-id')
    expect(pending.kind).toBe(kind); expect(pending.payload[field]).toBe(thread.split(':')[1]); expect(pending.payload.mutationId).toBe('same-id')
  })
})
describe('inbox data', () => {
  const item: FeedbackItem = { id: 'comment:1', threadId: 'comment:t', learnerId: 'l', authorId: 'a', authorName: 'Tutor', kind: 'comment', message: 'Original', preview: 'Original', createdAt: '2026-09-27T01:00:00Z', readAt: null, projectId: 'p', snapshotId: 's', goalId: null, checkpointId: null }
  it('groups replies without discarding original revision or unread state', () => {
    const reply = { ...item, id: 'reply:2', message: 'Reply', createdAt: '2026-09-27T02:00:00Z' }
    const groups = groupFeedback(parseFeedback({ items: [reply, item] }))
    expect(groups).toEqual([[item, reply]]); expect(groups[0][0].snapshotId).toBe('s'); expect(groups[0][0].readAt).toBeNull()
  })
  it('rejects malformed data rather than presenting a successful empty inbox', () => { expect(() => parseFeedback({ items: [{ id: 'broken' }] })).toThrow() })
})
