import { describe, expect, it } from 'vitest'
import { createStudioProject } from '../creation/v4/model'
import type { TrackingClient } from './client'
import { latestReviewRevision, loadReviewRevision } from './reviewSelection'

const client = {} as TrackingClient
const revision = (number: number, manifest: unknown = createStudioProject()) => ({ id: `r${number}`, revision: number, received_at: '', manifest })

describe('saved composition review', () => {
  it('offers the highest received revision regardless of response ordering', () => {
    expect(latestReviewRevision([revision(3), revision(1), revision(5)])?.id).toBe('r5')
    expect(latestReviewRevision([])).toBeUndefined()
  })
  it('keeps current music available when the preceding revision is invalid', async () => {
    const current = revision(2), brokenPrevious = revision(1, {})
    const result = await loadReviewRevision(current, [current, brokenPrevious], client, 'tutor', 'learner')
    expect(result.current).toEqual(current.manifest)
    expect(result.previous).toBeUndefined()
    expect(result.warning).toContain('could not be loaded')
    expect(result.summary.join(' ')).not.toContain('First received')
  })
  it('never displays an invalid selected revision merely because an older one works', async () => {
    await expect(loadReviewRevision(revision(2, {}), [revision(1)], client, 'tutor', 'learner')).rejects.toThrow()
  })
  it('compares immediate revisions and does not mislabel a history gap as first work', async () => {
    const current = revision(4)
    const compared = await loadReviewRevision(current, [revision(3)], client, 'tutor', 'learner')
    expect(compared.previous).toBeDefined()
    expect(compared.summary.join(' ')).toContain('notes added')
    const gap = await loadReviewRevision(current, [revision(1)], client, 'tutor', 'learner')
    expect(gap.previous).toBeUndefined()
    expect(gap.summary.join(' ')).toContain('No immediately preceding revision')
  })
})
