import { expect, it, vi } from 'vitest'
import { confirmReviewUpdate } from './confirmReviewUpdate'

it.each(['local persistence', 'network delivery', 'receipt cleanup'])('returns no confirmation when %s fails', async failedStage => {
  const error = vi.fn(), reset = vi.fn(), reached: string[] = []
  const confirmed = await confirmReviewUpdate(async () => {
    for (const stage of ['local persistence', 'network delivery', 'receipt cleanup']) {
      reached.push(stage)
      if (stage === failedStage) throw new Error(stage)
    }
  }, error)
  if (confirmed) reset()
  expect(reset).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledOnce()
  expect(reached.at(-1)).toBe(failedStage)
})

it('returns confirmation after a completed update', async () => {
  expect(await confirmReviewUpdate(async () => {}, vi.fn())).toBe(true)
})
