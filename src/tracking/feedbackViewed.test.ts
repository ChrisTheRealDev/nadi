import { describe, expect, it, vi } from 'vitest'
import type { FeedbackItem } from './feedbackTypes'
import { FEEDBACK_READ_BATCH, feedbackUnreadCount, rememberFeedbackViews, restoredFeedbackViews, visibleFeedbackIds } from './feedbackViewed'

const message = (id: string, patch: Partial<FeedbackItem> = {}): FeedbackItem => ({ id, threadId: 'comment:opened', learnerId: 'learner', authorId: 'tutor', authorName: 'Tutor', kind: 'comment', message: 'Discuss this passage', preview: 'Discuss this passage', createdAt: '2026-09-27T00:00:00.000Z', readAt: null, projectId: 'project', snapshotId: 'revision', goalId: null, checkpointId: null, ...patch })

describe('account-local feedback viewing and server receipt scope', () => {
  it('counts incoming unseen messages, retaining a new reply in an already viewed thread', () => {
    const items = [message('seen'), message('new-reply'), message('mine', { authorId: 'learner' }), message('server-read', { readAt: '2026-09-27T01:00:00Z' }), message('other', { threadId: 'comment:other' })]
    expect(feedbackUnreadCount(items, 'learner', new Set(['seen']))).toBe(2)
    expect(feedbackUnreadCount(items.filter(item => item.threadId === 'comment:opened'), 'learner', new Set(['seen']))).toBe(1)
  })

  it('only acknowledges incoming unread messages in an actually visible open discussion', () => {
    const items = [message('a'), message('a'), message('b|literal'), message('other', { threadId: 'comment:other' }), message('mine', { authorId: 'learner' }), message('read', { readAt: 'already' })]
    expect(visibleFeedbackIds(items, 'learner', 'comment:opened', true, true)).toEqual(['a', 'b|literal'])
    expect(visibleFeedbackIds(items, 'learner', 'comment:opened', false, true)).toEqual([])
    expect(visibleFeedbackIds(items, 'learner', 'comment:opened', true, false)).toEqual([])
    expect(visibleFeedbackIds(items, 'learner', '', true, true)).toEqual([])
  })

  it('remembers every opened message locally even when more than one server batch is needed', async () => {
    const items = Array.from({ length: 205 }, (_, index) => message(`id-${index}`)), before = structuredClone(items)
    const ids = visibleFeedbackIds(items, 'learner', 'comment:opened', true, true)
    const local = new Map<string, unknown>(), put = vi.fn(async (key: string, value: unknown) => { local.set(key, value) })
    await rememberFeedbackViews({ put }, ids)
    const restored = restoredFeedbackViews([...local].map(([key, value]) => ({ key, value })))
    expect(put).toHaveBeenCalledTimes(205)
    expect(feedbackUnreadCount(items, 'learner', restored)).toBe(0)
    expect(ids.slice(0, FEEDBACK_READ_BATCH)).toHaveLength(200)
    // A failed server receipt must still retry these original IDs despite the hidden badge.
    expect(visibleFeedbackIds(items, 'learner', 'comment:opened', true, true)).toEqual(ids)
    expect(items).toEqual(before)
    expect(restoredFeedbackViews([]).size).toBe(0) // another account's store has no views
  })

  it('reports durable storage failure instead of pretending local viewing was saved', async () => {
    await expect(rememberFeedbackViews({ put: async () => { throw new Error('quota exceeded') } }, ['one'])).rejects.toThrow('quota exceeded')
    expect(restoredFeedbackViews([{ key: 'inbox-viewed:yes', value: true }, { key: 'inbox-viewed:no', value: false }, { key: 'inbox-draft:other', value: true }, { key: 'inbox-viewed:', value: true }])).toEqual(new Set(['yes']))
  })
})
