import type { TrackingGoal } from './client'
import type { FeedbackItem } from './feedbackTypes'

export type ReviewState = 'awaiting-review' | 'changes-requested' | 'reviewed'
export const REVIEW_LABELS: Record<ReviewState, string> = {
  'awaiting-review': 'Awaiting tutor review',
  'changes-requested': 'Changes requested',
  reviewed: 'Reviewed by tutor',
}

/** Compare calendar dates in the viewer's local day; do not shift due dates through UTC. */
export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function attentionReasons(goals: (Pick<TrackingGoal, 'status' | 'due_date'> & { review?: { status: ReviewState } | null })[], openQuestions: number, now = new Date()): string[] {
  const reasons: string[] = []
  const awaiting = goals.filter(goal => goal.review?.status === 'awaiting-review').length
  const overdue = goals.filter(goal => goal.due_date && goal.due_date < localDateKey(now) && goal.status !== 'student-complete' && goal.review?.status !== 'reviewed').length
  const soon = new Date(now); soon.setDate(soon.getDate() + 3)
  const approaching = goals.filter(goal => goal.due_date && goal.due_date >= localDateKey(now) && goal.due_date <= localDateKey(soon) && goal.status !== 'student-complete' && goal.review?.status !== 'reviewed').length
  if (approaching) reasons.push(`${approaching} ${approaching === 1 ? 'deadline is' : 'deadlines are'} due within 3 days`)
  if (awaiting) reasons.push(`${awaiting} ${awaiting === 1 ? 'submission awaits' : 'submissions await'} review`)
  if (openQuestions) reasons.push(`${openQuestions} unanswered ${openQuestions === 1 ? 'question' : 'questions'}`)
  if (overdue) reasons.push(`${overdue} ${overdue === 1 ? 'deadline has' : 'deadlines have'} passed`)
  return reasons
}

export function orderedStepIds<T extends { id: string; position: number }>(steps: T[], id: string, direction: -1 | 1): string[] {
  const ordered = [...steps].sort((a, b) => a.position - b.position).map(step => step.id)
  const from = ordered.indexOf(id), to = from + direction
  if (from < 0 || to < 0 || to >= ordered.length) return ordered
  ;[ordered[from], ordered[to]] = [ordered[to], ordered[from]]
  return ordered
}

export function goalOrder<T extends Pick<TrackingGoal, 'status' | 'due_date' | 'created_at'>>(goals: T[]): T[] {
  return [...goals].sort((a, b) => Number(a.status === 'student-complete') - Number(b.status === 'student-complete') || (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.created_at.localeCompare(a.created_at))
}

/** Count explicit question threads whose latest received message is from the learner. */
export function unansweredQuestions(items: FeedbackItem[], learnerId: string): number {
  const latest = new Map<string, FeedbackItem>()
  for (const item of items) {
    if (item.learnerId !== learnerId || !['question', 'question-reply'].includes(item.kind)) continue
    const previous = latest.get(item.threadId)
    if (!previous || item.createdAt > previous.createdAt || item.createdAt === previous.createdAt && item.id > previous.id) latest.set(item.threadId, item)
  }
  return [...latest.values()].filter(item => item.authorId === learnerId).length
}
