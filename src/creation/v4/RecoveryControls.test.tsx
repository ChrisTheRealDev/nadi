import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from './model'
import { deleteClip, duplicateClip } from './operations'
import { StudioStore } from './storage'
import { RecoveryControls } from './RecoveryControls'

describe('compact project care controls', () => {
  it('starts collapsed and explains capacity and session history without mutating music', () => {
    const project = createStudioProject(), onEdit = vi.fn(), onContinue = vi.fn(), before = structuredClone(project)
    const html = renderToStaticMarkup(<RecoveryControls project={project} store={new StudioStore()} onEdit={onEdit} onContinue={onContinue} onMessage={vi.fn()} />)
    expect(html).not.toContain('<details open')
    for (const text of ['Stored notes', 'Played notes', 'Original MIDI events', 'Reload clears history', 'Fit project length', 'Back up and continue clean copy']) expect(html).toContain(text)
    expect(onEdit).not.toHaveBeenCalled(); expect(onContinue).not.toHaveBeenCalled(); expect(project).toEqual(before)
  })
  it('lists only genuinely unused parts and disables maintenance while busy', () => {
    let project = createStudioProject(); project = duplicateClip(project, project.clips[0].id); project = deleteClip(project, project.clips[1].id)
    const html = renderToStaticMarkup(<RecoveryControls project={project} store={new StudioStore()} disabled onEdit={vi.fn()} onContinue={vi.fn()} onMessage={vi.fn()} />)
    expect(html).toContain('1 unused parts'); expect(html).toContain(project.patterns[1].name)
    expect(html.match(/disabled=""/g)).toHaveLength(4)
  })
})
