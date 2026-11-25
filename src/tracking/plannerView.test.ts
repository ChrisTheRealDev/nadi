import { describe, expect, it } from 'vitest'
import { attentionReasons, goalOrder, orderedStepIds, unansweredQuestions } from './plannerView'
import type { FeedbackItem } from './feedbackTypes'
const now = new Date(2026, 8, 27, 12)
const goal = { status: 'in-progress', due_date: null as string | null, created_at: '2026-09-01T00:00:00Z' }
const message = (id: string, authorId: string, createdAt: string, threadId = 'q1'): FeedbackItem => ({ id, authorId, learnerId: 'student', threadId, createdAt, kind: authorId === 'student' ? 'question' : 'question-reply', authorName: authorId, message: 'Question', preview: 'Question', readAt: null, projectId: null, snapshotId: null, goalId: null, checkpointId: null })
describe('planner evidence and ordering', () => {
  it('separates deadline signals from review and questions', () => {
    const reasons = attentionReasons([{ ...goal, due_date: '2026-09-26' }, { ...goal, due_date: '2026-09-30', review: { status: 'awaiting-review' } }], 2, now)
    expect(reasons).toEqual(['1 deadline is due within 3 days', '1 submission awaits review', '2 unanswered questions', '1 deadline has passed'])
  })
  it('does not mark completed work overdue, but still shows its awaiting review', () => {
    expect(attentionReasons([{ ...goal, status: 'student-complete', due_date: '2026-09-01', review: { status: 'awaiting-review' } }], 0, now)).toEqual(['1 submission awaits review'])
  })
  it('does not invent attention signals from missing dates or distant deadlines', () => {
    expect(attentionReasons([goal, { ...goal, due_date: '2026-10-01' }], 0, now)).toEqual([])
  })
  it('moves steps using positions without mutating the received array', () => {
    const steps = [{ id: 'b', position: 2 }, { id: 'a', position: 1 }, { id: 'c', position: 3 }]
    expect(orderedStepIds(steps, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(orderedStepIds(steps, 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(steps.map(step => step.id)).toEqual(['b', 'a', 'c'])
  })
  it('places unfinished and nearer-due assignments first without mutating input', () => {
    const goals = [{ ...goal, status: 'student-complete', due_date: '2026-09-01' }, { ...goal, due_date: '2026-09-30' }, { ...goal, due_date: '2026-09-28' }]
    expect(goalOrder(goals)).toEqual([goals[2], goals[1], goals[0]])
    expect(goals[0].status).toBe('student-complete')
  })
  it('considers a received tutor reply answered, and a subsequent student reply awaiting response', () => {
    const question = message('q', 'student', '2026-09-27T10:00:00Z'), reply = message('r', 'tutor', '2026-09-27T10:01:00Z')
    expect(unansweredQuestions([question], 'student')).toBe(1)
    expect(unansweredQuestions([reply, question], 'student')).toBe(0)
    expect(unansweredQuestions([reply, question, message('s', 'student', '2026-09-27T10:02:00Z')], 'student')).toBe(1)
  })
  it('isolates learners and explicit questions; read/unread is not an answer', () => {
    const q = { ...message('q', 'student', '2026-09-27T10:00:00Z'), readAt: '2026-09-27T10:03:00Z' }
    expect(unansweredQuestions([q], 'student')).toBe(1)
    expect(unansweredQuestions([q], 'other')).toBe(0)
    expect(unansweredQuestions([{ ...q, kind: 'comment' }], 'student')).toBe(0)
  })
})
