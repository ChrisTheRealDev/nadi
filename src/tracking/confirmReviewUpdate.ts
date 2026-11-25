/** A caller may clear its form only after persistence, delivery and receipt cleanup. */
export async function confirmReviewUpdate(update: () => Promise<void>, onError: (error: unknown) => void): Promise<boolean> {
  try { await update(); return true }
  catch (error) { onError(error); return false }
}
