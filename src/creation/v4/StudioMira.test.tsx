import { describe, expect, expectTypeOf, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStudioProject } from './model'
import { addTrack, duplicateClip } from './operations'
import { StudioMira, type StudioMiraProps } from './StudioMira'
import { routeStudioQuestion, STUDIO_HELP_TOPICS, studioHelpAnswer, type StudioHelpTopic } from './studioHelp'

describe('studio built-in Mira', () => {
  it('exposes navigation only, never generated audio or musical-edit callbacks', () => {
    expectTypeOf<keyof StudioMiraProps>().toEqualTypeOf<'open' | 'onClose' | 'onRevealTarget' | 'project' | 'selectedTrackId' | 'selectedClipId' | 'uiContext' | 'observedAction' | 'canUndo' | 'saved' | 'passageContext' | 'audioContext' | 'onArchiveExchange'>()
    const html = renderToStaticMarkup(<StudioMira open onClose={() => {}} project={createStudioProject()} />)
    expect(html).toContain('Built-in help')
    expect(html).toContain('<summary>AI settings</summary>')
    expect(html).not.toContain('AI ready')
    expect(html).toContain('I have not listened to your audio')
    expect(html).toContain('Built-in mode keeps new questions in this browser')
    expect(html).toContain('/assets/mira/mira-encouraging.png')
    expect(html).not.toContain('expression-sheet')
    expect(html).not.toContain('Develop this idea')
    expect(html).toContain('Explain these notes')
    expect(html).not.toContain('Suggest a variation')
    expect(html).not.toContain('How could this continue?')
    expect(html).not.toContain('Hear example')
    expect(html).toContain('Help me do something')
    expect(html).toContain('Something isn’t working')
    expect(html).not.toContain('Make a short piano song')
    expect(html).toContain('My musical goal')
  })
  it.each([
    ['how do I add bass?', 'add'], ['change instrument sound', 'sound'], ['record my keyboard', 'record'],
    ['make an independent copy', 'independent'], ['what are linked parts?', 'linked'], ['move clips', 'arrange'],
    ['delete a mistake', 'delete'], ['add drums', 'drums'], ['balance volume', 'volume'], ['no sound', 'listen'],
    ['save my work', 'save'], ['draw a chord', 'notes'], ['install an external plugin', null],
    ['undo deleting a track', 'undo'], ['delete this note', 'delete-note'], ['remove a clip', 'delete-clip'], ['delete the track', 'delete-track'],
    ['reopen my project', 'reopen'], ['unlink this copy', 'unlink'], ['strings sound failed', 'missing-sound'], ['delete something', 'delete'],
    ["can't hear bass", 'listen'], ['cannot hear bass', 'listen'], ['my strings are silent', 'listen'],
  ])('routes %s only to authored guidance', (question, topic) => { expect(routeStudioQuestion(question)).toBe(topic) })
  it('never mutates the supplied graph and returns one optional action for every topic', () => {
    const project = createStudioProject(), before = structuredClone(project)
    for (const topic of Object.keys(STUDIO_HELP_TOPICS) as StudioHelpTopic[]) {
      const answer = studioHelpAnswer(topic, project, project.tracks[0].id, project.clips[0].id)
      expect(answer.idea.length).toBeGreaterThan(0)
      expect(answer.action.length).toBeGreaterThan(0)
      expect(answer).not.toHaveProperty('execute')
    }
    expect(project).toEqual(before)
  })
  it('uses exact control labels and handles missing or mismatched selection before highlighting', () => {
    const project = createStudioProject()
    expect(studioHelpAnswer('independent', project).target).toBe('pattern-playlist')
    const answer = studioHelpAnswer('independent', project, project.tracks[0].id, project.clips[0].id)
    expect(answer.action).toContain('Duplicate independently')
    expect(answer.target).toBe('duplicate-independent')
    const two = addTrack(project, 'strings')
    expect(studioHelpAnswer('record', two, two.tracks[1].id, two.clips[0].id).target).toBe('pattern-playlist')
  })
  it('names the actual recording track and warns about shared note edits', () => {
    const project = addTrack(createStudioProject(), 'strings')
    const record = studioHelpAnswer('record', project, project.tracks[1].id, project.clips[1].id)
    expect(record.idea).toContain('Strings')
    expect(record.target).toBe('record-destination')
    const linked = duplicateClip(project, project.clips[1].id, true)
    const answer = studioHelpAnswer('linked', linked, linked.tracks[1].id, linked.clips[1].id)
    expect(answer.idea).toContain('2 placement(s)')
    expect(answer.differently).toContain('Make independent')
  })
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<StudioMira open={false} onClose={() => {}} project={createStudioProject()} />)).toBe('')
  })
})
