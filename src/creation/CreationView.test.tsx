import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CreationView, type CreationViewProps } from './CreationView'
import { createProject, type CreationProject } from './model'
import { DEFAULT_WORKSPACE_PREFERENCES } from './workspacePreferences'

function view(project: CreationProject, overrides: Partial<CreationViewProps> = {}) {
  const onEdit = vi.fn()
  const props: CreationViewProps = {
    project, saved: 'Saved', message: '', playing: false, playhead: 0,
    activeNotes: [], recording: false, counting: 0, midiLabel: 'Not connected',
    audioLabel: 'Sound ready', canUndo: false, canRedo: false, selectedBar: 0,
    onSelectBar: vi.fn(), onEdit, onPlay: vi.fn(), onStop: vi.fn(),
    onUndo: vi.fn(), onRedo: vi.fn(), onNoteOn: vi.fn(), onNoteOff: vi.fn(),
    onRecord: vi.fn(), onKeep: vi.fn(), onDiscard: vi.fn(), hasTake: false,
    onDownload: vi.fn(), onImport: vi.fn(), onWav: vi.fn(), onMidi: vi.fn(),
    onNew: vi.fn(), onOpen: vi.fn(), onConnect: vi.fn(), ...overrides,
  }
  return { html: renderToStaticMarkup(<CreationView {...props} />), onEdit }
}

describe('unified studio foundation', () => {
  it('accepts multitrack slots without mounting legacy music controls', () => {
    const { html } = view(createProject(), {
      workspace: { ...DEFAULT_WORKSPACE_PREFERENCES, playlist: true, mixer: true, mira: true },
      controlledEditor: 'drums', trackControls: <div>Track picker slot</div>,
      arrangementContent: <h1 id="arrangement-title">Multitrack playlist</h1>,
      mixerContent: <section id="studio-mixer">Track mixer slot</section>,
      editorContext: <div>Pattern context slot</div>, editorContent: <div>Pattern editor slot</div>,
      barActionsContent: <div>Pattern actions slot</div>, customMira: <aside>Studio Mira slot</aside>,
    })
    for (const text of ['Track picker slot', 'Multitrack playlist', 'Track mixer slot', 'Pattern context slot', 'Pattern editor slot', 'Pattern actions slot', 'Studio Mira slot']) expect(html).toContain(text)
    expect(html).not.toContain('Current sound engine: piano and three drum sounds.')
    expect(html).not.toContain('Clear piano notes in this bar')
    expect(html).toContain('id="editor-tab-drums" aria-controls="editor-panel" tabindex="0"')
  })
  it('keeps workspace visibility separate from musical edits and exposes hidden-arrangement bar navigation', () => {
    const project = createProject(), original = structuredClone(project)
    const { html, onEdit } = view(project, { workspace: { ...DEFAULT_WORKSPACE_PREFERENCES, keyboard: false }, onCustomizeWorkspace: vi.fn() })
    expect(html).toContain('Customize workspace')
    expect(html).toContain('aria-label="Edit bar"')
    expect(html).not.toContain('aria-label="Play C4"')
    expect(html).not.toContain('aria-label="Mira help"')
    expect(html).toContain('class="arrangement panel" hidden=""')
    expect(project).toEqual(original)
    expect(onEdit).not.toHaveBeenCalled()
  })
  it('supports drum focus and independent playable keyboard with either panel placement', () => {
    const { html } = view(createProject(), { workspace: { ...DEFAULT_WORKSPACE_PREFERENCES, editor: 'drums', browserSide: 'right', mira: true, miraSide: 'left', playlist: true, playlistPosition: 'bottom' }, ideaPad: <div>Ideas</div>, ideaPadOpen: true })
    expect(html).toContain('aria-label="Kick step 1"')
    expect(html).toContain('aria-label="Play C4"')
    expect(html).toContain('data-mira-side="left"')
    expect(html).toContain('editor ideas')
    expect(html).toContain('arrangement ideas')
  })
  it('unmounts playable keys and suspends Mira while workspace setup is active', () => {
    const { html } = view(createProject(), { workspace: { ...DEFAULT_WORKSPACE_PREFERENCES, mira: true }, workspaceSetupOpen: true })
    expect(html).not.toContain('aria-label="Play C4"')
    expect(html).not.toContain('aria-label="Mira help"')
  })
  it('connects roving browser/editor tabs to their panels and exposes honest repeat destinations', () => {
    const { html } = view(createProject(), { ideaPad: <textarea aria-label="Draft" />, onRepeatNextBar: vi.fn(), selectedBar: 2, loopBar: true, onToggleLoopBar: vi.fn() })
    expect(html).toContain('id="browser-tab-sounds" aria-controls="browser-panel-sounds" tabindex="-1"')
    expect(html).toContain('id="browser-tab-ideas" aria-controls="browser-panel-ideas" tabindex="0"')
    expect(html).toContain('aria-labelledby="browser-tab-ideas"')
    expect(html).toContain('id="editor-tab-piano" aria-controls="editor-panel" tabindex="0"')
    expect(html).toContain('id="editor-tab-drums" aria-controls="editor-panel" tabindex="-1"')
    expect(html).toContain('aria-labelledby="editor-tab-piano"')
    expect(html).toContain('next destination: bar 4')
    expect(html).toContain('data-help-target="repeat-next-bar"')
    expect(html).toContain('Repeat in next bar')
    expect(html).toContain('Duplicate bar to end')
    expect(html).toContain('data-help-target="loop-range"')
    expect(html).toContain('Loop shown bars')
  })
  it('separates transport from project controls and reserves space beside the editor for capture', () => {
    const { html } = view(createProject(), { ideaPad: <div>Capture</div>, ideaPadOpen: true, onToggleIdeaPad: vi.fn(), selectedBar: 2 })
    expect(html).toContain('class="studio-toolbar"')
    expect(html).toContain('class="project-actions"')
    expect(html).toContain('creation-workspace--ideas')
    expect(html).toContain('003 : 1 : 000')
    expect(html).toContain('aria-label="Play position" aria-live="off"')
    expect(html).not.toContain('class="lane-clip"')
  })

  it('shows bar previews only for existing notes without adding fake musical content', () => {
    const project = createProject()
    project.notes = [{ id: 'real-note', instrument: 'piano', pitch: 64, startTick: 0, durationTicks: 480, velocity: 90 }]
    const { html, onEdit } = view(project)
    expect(html.match(/class="lane-clip"/g)).toHaveLength(1)
    expect(html).toContain('instrument--piano')
    expect(onEdit).not.toHaveBeenCalled()
  })
  it('shows one playable piano track by default without changing existing engine data', () => {
    const project = createProject(), original = structuredClone(project)
    const { html, onEdit } = view(project)
    expect(html).toContain('aria-label="Piano, bar 1"')
    expect(html).toContain('aria-label="Piano volume"')
    expect(html).not.toContain('aria-label="Kick, bar 1"')
    expect(html).not.toContain('aria-label="Kick volume"')
    expect(html).toContain('Add instrument')
    expect(html).toContain('Channel rack')
    expect(html).toContain('aria-label="Play C4"')
    expect(project).toEqual(original)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('automatically reveals stored drum parts and their mix on reopen', () => {
    const project = createProject()
    project.notes = [{ id: 'original-hit', instrument: 'snare', pitch: 38, startTick: 137, durationTicks: 60, velocity: 73 }]
    project.mix.snare = { level: 47, muted: true }
    const original = structuredClone(project), { html, onEdit } = view(project)
    expect(html).toContain('aria-label="Snare, bar 1"')
    expect(html).toContain('aria-label="Snare volume"')
    expect(html).toContain('aria-label="Mute Snare" aria-pressed="true"')
    expect(html).not.toContain('aria-label="Kick, bar 1"')
    expect(project).toEqual(original)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('keeps captured ideas mounted beside composition when the dock is collapsed', () => {
    const { html } = view(createProject(), {
      ideaPad: <div>Unchanged original capture</div>, ideaPadOpen: false,
      onToggleIdeaPad: vi.fn(),
    })
    expect(html).toContain('aria-expanded="false" aria-controls="studio-idea-pad"')
    expect(html).toContain('id="studio-idea-pad" class="studio-idea-pad panel" aria-label="Idea Pad" hidden=""')
    expect(html).toContain('Unchanged original capture')
    expect(html).toContain('data-help-target="piano-roll"')
  })

  it('exposes an open Idea Pad, studio navigation and only honest implemented track controls', () => {
    const { html } = view(createProject(), { ideaPad: <div>Capture here</div>, ideaPadOpen: true, onToggleIdeaPad: vi.fn() })
    expect(html).toContain('aria-expanded="true" aria-controls="studio-idea-pad"')
    expect(html).toContain('href="#create" aria-label="NADI studio"')
    expect(html).not.toContain('href="#home"')
    expect(html).toContain('Pan, effects and expression are planned')
    expect(html).not.toContain('Play example')
    expect(html).toContain('4/4 grid')
  })
})
