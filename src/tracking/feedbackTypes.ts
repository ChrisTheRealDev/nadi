export interface FeedbackItem {
  id: string; threadId: string; learnerId: string; authorId: string; authorName: string
  kind: 'comment' | 'reply' | 'checkpoint-feedback' | 'question' | 'question-reply'
  message: string; preview: string; createdAt: string; readAt: string | null
  projectId: string | null; snapshotId: string | null; goalId: string | null; checkpointId: string | null
  anchor?: { trackId?: string | null; measures?: string | null }
}
export type FeedbackTarget = Pick<FeedbackItem, 'learnerId' | 'projectId' | 'snapshotId' | 'threadId'>
export function parseFeedback(value: unknown): FeedbackItem[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new Error('Feedback response could not be read.')
  return value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Feedback response could not be read.')
    const row = item as Record<string, unknown>
    for (const field of ['id', 'threadId', 'learnerId', 'authorId', 'authorName', 'kind', 'message', 'preview', 'createdAt']) if (typeof row[field] !== 'string') throw new Error('Feedback response could not be read.')
    for (const field of ['readAt', 'projectId', 'snapshotId', 'goalId', 'checkpointId']) if (row[field] !== null && typeof row[field] !== 'string') throw new Error('Feedback response could not be read.')
    return row as unknown as FeedbackItem
  })
}
export function groupFeedback(items: FeedbackItem[]) {
  const groups = new Map<string, FeedbackItem[]>()
  for (const item of items) groups.set(item.threadId, [...(groups.get(item.threadId) ?? []), item])
  return [...groups.values()].map(rows => rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))).sort((a, b) => b[b.length - 1].createdAt.localeCompare(a[a.length - 1].createdAt))
}
