import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProgressActions from './ProgressActions'
import type { TrackingClient, TrackingWorkspace } from './client'

const studentId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const goalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'

function learner() {
  return {
    profile: { id: studentId, display_name: 'Learner', role: 'student' as const },
    progress: {
      learnerId: studentId,
      goals: [{ id: goalId, title: 'Short motif', description: '', status: 'not-started', version: 0, due_date: null, created_at: '2026-09-25T00:00:00.000Z' }],
      workSessions: [], events: [], checkpoints: [], feedback: [],
      helpRequests: [{ id: requestId, goal_id: goalId, message: 'Need a cue.', created_at: '2026-09-25T00:00:00.000Z', resolved_at: null }],
    },
  }
}

function render(role: 'mentor' | 'student', disclosed: boolean) {
  const workspace: TrackingWorkspace = {
    profile: role === 'mentor' ? { id: mentorId, display_name: 'Mentor', role } : learner().profile,
    disclosureAccepted: disclosed,
    learners: [learner()],
  }
  return renderToStaticMarkup(<ProgressActions client={{} as TrackingClient} workspace={workspace} selectedLearnerId={studentId} onChanged={() => {}} defaultExpanded />)
}

describe('progress-action role boundaries', () => {
  it('shows mentor goal and resolution controls without student disclosure or status controls', () => {
    const html = render('mentor', false)
    expect(html).toContain('New assignment')
    expect(html).toContain('Mark resolved')
    expect(html).not.toContain('Accept disclosure')
    expect(html).not.toContain('I’m starting')
    expect(html).not.toContain('I’m stuck')
  })

  it('shows student disclosure and personal status/help controls without mentor authoring', () => {
    const html = render('student', false)
    expect(html).toContain('Accept disclosure')
    expect(html).toContain('I’m starting')
    expect(html).toContain('Ask your tutor')
    expect(html).toContain('Send question')
    expect(html).not.toContain('New assignment')
    expect(html).not.toContain('Mark resolved')
  })

  it('omits disclosure acceptance after it is already accepted', () => {
    expect(render('student', true)).not.toContain('Accept disclosure')
  })
})
