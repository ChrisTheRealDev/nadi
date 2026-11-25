export interface FeedbackPending { key: string; threadId: string; kind: string; shared: boolean; payload: Record<string, unknown> }
export interface FeedbackStorage { put(key: string, value: unknown): Promise<void>; removeRecord(key: string): Promise<void> }
export async function deliverFeedback(store: FeedbackStorage, pending: FeedbackPending, send: (pending: FeedbackPending) => Promise<unknown>) {
  // Keep the durable command, transmitted identity and cleanup key consistent
  // even if the caller changes its draft while storage or delivery is awaiting.
  pending = structuredClone(pending)
  await store.put(pending.key, pending)
  const receipt = await send(pending)
  if (pending.shared && (!receipt || typeof receipt !== 'object' || !('saved' in receipt) || receipt.saved !== true)) throw new Error('Feedback acknowledgement was not confirmed.')
  try { await store.removeRecord(pending.key); return { receipt, cleaned: true } }
  catch { return { receipt, cleaned: false } }
}
export function feedbackReply(threadId: string, message: string, snapshotId: string | null, mutationId: string): FeedbackPending {
  if (threadId === 'new-question') return { key: `inbox-command:${mutationId}`, threadId, kind: 'question', shared: false, payload: { mutationId, message } }
  const shared = threadId.startsWith('comment:')
  const kind = shared ? 'reply' : threadId.startsWith('question:') ? 'question-reply' : 'checkpoint-reply'
  const idField = shared ? 'threadId' : kind === 'question-reply' ? 'questionId' : 'checkpointId'
  return { key: `inbox-command:${mutationId}`, threadId, kind, shared, payload: { mutationId, message, [idField]: threadId.slice(threadId.indexOf(':') + 1), ...(shared ? { revisionId: snapshotId } : {}) } }
}
