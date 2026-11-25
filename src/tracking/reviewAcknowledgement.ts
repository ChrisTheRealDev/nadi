/** Matches nadi_music_command's distinct comment and reply/resolve contracts. */
export function isReviewAcknowledgement(kind: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const receipt = value as Record<string, unknown>
  if (kind === 'comment') return typeof receipt.threadId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.threadId)
  return (kind === 'reply' || kind === 'resolve') && receipt.saved === true
}
