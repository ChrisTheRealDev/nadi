import { describe, expect, it } from 'vitest'
import { isReviewAcknowledgement } from './reviewAcknowledgement'
describe('deployed music command acknowledgements', () => {
  it('accepts the actual comment thread UUID returned by SQL', () => {
    expect(isReviewAcknowledgement('comment', { threadId: '9ae9e6ad-9c1b-4446-af3a-ae4d0b08dad8' })).toBe(true)
  })
  it.each(['reply', 'resolve'])('accepts saved:true for %s', kind => { expect(isReviewAcknowledgement(kind, { saved: true })).toBe(true) })
  it.each([null, {}, { saved: true }, { threadId: '' }, { threadId: 'not-a-uuid' }, []])('rejects malformed comment response %j', value => { expect(isReviewAcknowledgement('comment', value)).toBe(false) })
  it.each(['reply', 'resolve'])('does not confuse threadId with a %s receipt', kind => { expect(isReviewAcknowledgement(kind, { threadId: '9ae9e6ad-9c1b-4446-af3a-ae4d0b08dad8' })).toBe(false); expect(isReviewAcknowledgement(kind, { saved: false })).toBe(false) })
})
