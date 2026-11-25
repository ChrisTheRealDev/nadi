import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from './model'
import { EditorContext, PatternPlaylist, SoundBrowser, TrackControls, TrackMixer } from './Workbench'
import { moveClipTick, stackClips } from './workbenchMath'
import { SOUNDS } from './sounds'

function fixture() {
  const project = createStudioProject()
  return { project, selectedTrackId: project.tracks[0].id, selectedClipId: project.clips[0].id, onAction: vi.fn() }
}

describe('multi-instrument workspace', () => {
  it('exposes every registered sound with separate preview and add actions', () => {
    const props = fixture(), html = renderToStaticMarkup(<SoundBrowser {...props} onPreviewSound={vi.fn()} />)
    for (const name of ['Piano', 'Electric Piano', 'Synth Bass', 'Soft Pad', 'Strings', 'Plucked Guitar', 'French Horn', 'Trumpet', 'Kick', 'Snare', 'Hi-hat']) expect(html).toContain(`Preview ${name}`)
    for (const sound of SOUNDS) expect(html).toContain(`Preview ${sound.name}`)
    expect(html.match(/>Add<\/button>/g)).toHaveLength(SOUNDS.length)
    expect(html).toContain('Find a sound')
    expect(html).toContain('Sound family')
    expect(props.onAction).not.toHaveBeenCalled()
  })
  it('shows honest load failures with retry and keeps addition available', () => {
    const html = renderToStaticMarkup(<SoundBrowser {...fixture()} soundStatus={{ strings: { state: 'error', message: 'Sample unavailable' } }} />)
    expect(html).toContain('Sample unavailable'); expect(html).toContain('Retry Strings')
  })
  it('distinguishes hiding from deleting and displays the recording destination', () => {
    const html = renderToStaticMarkup(<TrackControls {...fixture()} />)
    expect(html).toContain('Hide track'); expect(html).toContain('Delete track'); expect(html).toContain('Playing / recording:')
    expect(html).toContain('not from your song')
  })
  it('labels independent duplication and linked edits explicitly', () => {
    const props = fixture()
    props.project.clips.push({ ...props.project.clips[0], id: 'second', startTick: 1920 })
    const html = renderToStaticMarkup(<><PatternPlaylist {...props} /><EditorContext {...props} /></>)
    for (const text of ['Duplicate independently', 'Repeat linked', 'Paste independent', 'Make independent', 'Edits affect these copies', 'Start at bar', 'Reusable parts']) expect(html).toContain(text)
    expect(html).toContain('Linked ×2')
  })
  it('retains hidden-track recovery and independent duplicate-instrument mixer controls', () => {
    const props = fixture()
    props.project.tracks.push({ ...props.project.tracks[0], id: 'second', name: 'Piano 2', hidden: true })
    const html = renderToStaticMarkup(<><PatternPlaylist {...props} /><TrackMixer {...props} /></>)
    expect(html).toContain('Show Piano 2'); expect(html).toContain('aria-label="Piano 2 volume"'); expect(html).toContain('aria-label="Piano volume"')
  })
  it('stacks overlapping clips without altering the input', () => {
    const { project } = fixture(), first = project.clips[0]
    const clips = [first, { ...first, id: 'b', startTick: 100 }, { ...first, id: 'c', startTick: 7680 }]
    const before = structuredClone(clips), result = stackClips(clips, project.patterns)
    expect(result.map(item => item.row)).toEqual([0, 1, 0]); expect(clips).toEqual(before)
  })
  it('moves by snapped deltas, preserves offsets and bounds whole clip placement', () => {
    expect(moveClipTick(13, 2000, 1920, 7680)).toBe(1933)
    expect(moveClipTick(13, 241, 480, 7680)).toBe(493)
    expect(moveClipTick(13, 20.6, 0, 7680)).toBe(34)
    expect(moveClipTick(13, -9000, 480, 7680)).toBe(0)
    expect(moveClipTick(13, 900000, 480, 7680)).toBe(256 * 1920 - 7680)
  })
})
