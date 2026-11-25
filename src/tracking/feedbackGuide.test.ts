import { expect, it } from 'vitest'
import { feedbackGuide } from './feedbackGuide'
it('offers software orientation with a neutral checklist, without inventing musical choices', () => {
  const plan = feedbackGuide(true, '4–8')
  expect(plan.steps[0]).toContain('linked composition')
  expect(plan.steps[1]).toContain('4–8')
  expect(plan.steps.join(' ')).toContain('Mira does not choose')
  expect(plan.checks).toHaveLength(4)
  expect(feedbackGuide(false).steps[0]).toContain('Ask which work')
})
