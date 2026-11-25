import type { FeedbackItem } from './feedbackTypes'

const VIEWED_PREFIX = 'inbox-viewed:'
export const FEEDBACK_READ_BATCH = 200

/** Local acknowledgement affects this account/device's badge, not server readAt. */
export function feedbackUnreadCount(items: readonly FeedbackItem[], actorId: string, viewed: ReadonlySet<string>): number {
  return items.filter(item => !item.readAt && item.authorId !== actorId && !viewed.has(item.id)).length
}

/** Keep local viewing independent of successful receipt delivery. */
export function visibleFeedbackIds(items: readonly FeedbackItem[], actorId: string, threadId: string, open: boolean, visible: boolean): string[] {
  if (!open || !visible || !threadId) return []
  return [...new Set(items.filter(item => item.threadId === threadId && !item.readAt && item.authorId !== actorId).map(item => item.id))].sort()
}

export function restoredFeedbackViews(rows: readonly { key: string; value: unknown }[]): Set<string> {
  return new Set(rows.filter(row => row.value === true && row.key.startsWith(VIEWED_PREFIX) && row.key.length > VIEWED_PREFIX.length).map(row => row.key.slice(VIEWED_PREFIX.length)))
}

/** Caller supplies its actor-scoped AccountStudioStore; never use shared storage. */
export async function rememberFeedbackViews(store: { put(key: string, value: unknown): Promise<void> }, ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map(id => store.put(VIEWED_PREFIX + id, true)))
}
