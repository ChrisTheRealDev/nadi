import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { StudioHistory } from './history'
import { describeStudioEdit } from './editDescription'
import { createStudioProject } from './model'
import { TrackControls } from './Workbench'
import { SOUNDS } from './sounds'

describe('named minimal-workspace history', () => {
  it('keeps command identity/context through Undo and Redo and drops a branched future', () => {
    const project = createStudioProject(), history = new StudioHistory()
    const description = { label: 'Move 3 notes', affectedIds: ['a', 'b', 'c'], context: { panel: 'notes' as const, trackId: project.tracks[0].id, clipId: project.clips[0].id, noteIds: ['a', 'b', 'c'] } }
    history.push(project, description)
    const id = history.undoCommand!.id
    description.context.noteIds.pop()
    const current = { ...project, name: 'renamed' }
    const undo = history.undo(current)!
    expect(history.lastTravel).toMatchObject({ id, label: 'Move 3 notes', context: { noteIds: ['a', 'b', 'c'] } })
    expect(history.redoCommand?.id).toBe(id)
    const redo = history.redo(undo)!
    expect(redo.name).toBe('renamed'); expect(history.undoCommand?.id).toBe(id)
    history.undo(redo); history.push(undo, { label: 'Rename project' })
    expect(history.availability.redo).toBe(false)
    expect(history.recent.map(command => command.label)).toEqual(['Rename project'])
  })
  it('describes project, track and part renaming separately from music edits', () => {
    const before = createStudioProject(), renamed = structuredClone(before)
    renamed.name = 'New name'
    expect(describeStudioEdit(before, renamed).label).toBe('Rename project')
    const track = structuredClone(before); track.tracks[0].name = 'Lead'
    expect(describeStudioEdit(before, track).label).toBe('Rename track')
    const part = structuredClone(before); part.patterns[0].name = 'Verse'
    expect(describeStudioEdit(before, part).label).toBe('Rename part')
    const colour = structuredClone(before); colour.tracks[0].color = '#112233'
    expect(describeStudioEdit(before, colour).label).toBe('Change track colour')
  })
  it('filters melodic destinations without hiding percussion from capacity checks', () => {
    const project = createStudioProject()
    project.tracks = Array.from({ length: 16 }, (_, index) => ({ ...project.tracks[0], id: `track-${index}`, name: `Track ${index}`, soundId: index ? 'kick' as const : 'piano' as const }))
    const html = renderToStaticMarkup(<TrackControls project={project} melodicOnly selectedTrackId="track-0" selectedClipId={null} onAction={vi.fn()} />)
    expect(html).toContain('<option value="track-0" selected="">Track 0</option>')
    expect(html).not.toContain('<option value="track-1">')
    expect(html.match(/disabled="" title="Maximum 16 tracks, including 15 melodic tracks\."/g)).toHaveLength(SOUNDS.length)
  })
})
