/** An edit result distinguishes a committed change from a no-op or a refusal. */
export type EditResult =
  | { status: 'accepted' }
  | { status: 'unchanged'; message?: string }
  | { status: 'cancelled'; message?: string }
  | { status: 'rejected'; message: string }

export function normalizeEditResult(result: EditResult | boolean | void): EditResult {
  if (result === undefined || result === true) return { status: 'accepted' }
  if (result === false) return { status: 'rejected', message: 'That edit could not be applied. No music was changed.' }
  return result as EditResult
}
