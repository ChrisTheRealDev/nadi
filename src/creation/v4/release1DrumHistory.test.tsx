import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DrumEditor } from '../DrumEditor'
import { CombinedDrums } from './CombinedDrums'
import { describeStudioEdit, describeWorkbenchAction } from './editDescription'
import { normalizeEditResult } from './editResult'
import { createStudioProject } from './model'
import { addTrack, deleteClip, duplicateClip, makeIndependent, moveClip, removeUnusedPatterns } from './operations'
import { SoundBrowser } from './Workbench'

describe('release-one drum and history boundaries', () => {
  it('keeps refusal and cancellation distinct from accepted edits', () => {
    expect(normalizeEditResult(false).status).toBe('rejected')
    expect(normalizeEditResult({ status: 'cancelled' }).status).toBe('cancelled')
    expect(normalizeEditResult({ status: 'unchanged' }).status).toBe('unchanged')
    expect(normalizeEditResult(undefined).status).toBe('accepted') // legacy callback
  })
  it('disables out-of-part cells with an explanation', () => {
    const html = renderToStaticMarkup(<DrumEditor notes={[]} bars={4} startBar={0} visibleBars={4} playhead={0} playing={false} previewEnabled={false} instruments={['kick']} editableStartTick={1920} editableEndTick={3840} onChange={vi.fn()} onPreview={vi.fn()} onMessage={vi.fn()} onUndo={vi.fn()} />)
    expect(html).toContain('outside this part, create or select a part covering this bar')
    expect(html).toContain('drum-step--outside-part')
    expect(html).not.toContain('Undo drum edit')
  })
  it('uses one combined horizontal scroll and one time ruler for drum tracks', () => {
    let project = addTrack(createStudioProject(), 'kick')
    project = addTrack(project, 'snare')
    const html = renderToStaticMarkup(<CombinedDrums project={project} startBar={0} visibleBars={4} selectedClipId={null} onSelectClip={vi.fn()} onEdit={vi.fn(() => ({ status: 'accepted' as const }))} onMessage={vi.fn()} onUndo={vi.fn()} onPreview={vi.fn()} previewEnabled={false} playhead={0} playing={false} />)
    expect(html.match(/class="combined-drum-scroll"/g)).toHaveLength(1)
    expect(html.match(/class="step-numbers drum-time-ruler"/g)).toHaveLength(1)
    expect(html.match(/class="drum-scroll"/g)).toHaveLength(2)
  })
  it('exposes linked drum independence at the exact scoped help target', () => {
    const first = addTrack(createStudioProject(), 'kick'), clip = first.clips.at(-1)!
    const project = duplicateClip(first, clip.id, true)
    const html = renderToStaticMarkup(<CombinedDrums project={project} startBar={0} visibleBars={4} selectedClipId={clip.id} onSelectClip={vi.fn()} onEdit={vi.fn(() => true)} onMessage={vi.fn()} onUndo={vi.fn()} onPreview={vi.fn()} onMakeIndependent={vi.fn()} previewEnabled={false} playhead={0} playing={false} />)
    expect(html).toContain('data-help-target="make-independent"')
    expect(html).toContain(`data-help-clip-id="${clip.id}"`)
    expect(html).toContain('>Make independent</button>')
  })
  it('names independence, linked repetition, and unused-part cleanup accurately', () => {
    const before = addTrack(createStudioProject(), 'kick'), clip = before.clips.at(-1)!
    const independent = makeIndependent(before, clip.id)
    expect(describeStudioEdit(before, independent).label).toBe('Make clip independent')
    expect(describeWorkbenchAction({ type: 'clip-independent', clipId: clip.id }, before, independent).context?.panel).toBe('drums')
    const repeated = duplicateClip(before, clip.id, true)
    expect(describeWorkbenchAction({ type: 'clip-duplicate', clipId: clip.id, linked: true }, before, repeated).label).toBe('Repeat linked clip')
    const unplaced = deleteClip(before, clip.id)
    const unused = removeUnusedPatterns(unplaced, [before.patterns.at(-1)!.id])
    expect(describeStudioEdit(unplaced, unused)).toMatchObject({ label: 'Remove 1 unused part(s)', context: { panel: 'arrangement' } })
    const moved = moveClip(before, clip.id, 1920)
    expect(describeStudioEdit(before, moved).label).toContain('Move')
  })
  it('names every instrument Add control independently', () => {
    const project = createStudioProject()
    const html = renderToStaticMarkup(<SoundBrowser project={project} selectedTrackId={null} selectedClipId={null} onAction={vi.fn()} />)
    for (const name of ['Piano', 'Kick', 'Snare', 'Hi-hat']) expect(html).toContain(`aria-label="Add ${name}"`)
  })
})
