import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspacePreferences } from './workspacePreferences'
import './workspaceSetup.css'

interface WorkspaceSetupProps {
  initial: WorkspacePreferences
  firstRun: boolean
  onApply: (preferences: WorkspacePreferences) => void
  onCancel: () => void
}

const panels = [
  { key: 'browser', name: 'Sound browser', detail: 'Find instruments, sounds and your Idea Pad.' },
  { key: 'mira', name: 'MIRA assistant', detail: 'Ask for help while you make music.' },
  { key: 'playlist', name: 'Song arrangement', detail: 'See your notes in each bar of the song.' },
  { key: 'mixer', name: 'Mixer', detail: 'Adjust track volume and mute.' },
  { key: 'keyboard', name: 'Play keyboard', detail: 'Play notes with onscreen keys.' },
] as const

export function WorkspaceSetup({ initial, firstRun, onApply, onCancel }: WorkspaceSetupProps) {
  const [draft, setDraft] = useState<WorkspacePreferences>(() => ({ ...initial }))
  const [step, setStep] = useState(firstRun ? 0 : 1)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previous = document.activeElement
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    heading.current?.focus()
    return () => {
      if (typeof element.close === 'function' && element.open) element.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => { heading.current?.focus() }, [step])

  function handleKeys(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')
    if (!controls?.length) return
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === heading.current)) {
      event.preventDefault()
      first.focus()
    }
  }

  function preset(kind: 'piano' | 'drums' | 'full') {
    setDraft({ ...DEFAULT_WORKSPACE_PREFERENCES,
      editor: kind === 'drums' ? 'drums' : 'piano',
      keyboard: kind !== 'drums',
      ...(kind === 'full' ? { browser: true, mira: true, playlist: true, mixer: true } : {}),
    })
    setStep(1)
  }

  const leftPanels = panels.filter(panel => (panel.key === 'browser' || panel.key === 'mira') && draft[panel.key] && draft[panel.key === 'browser' ? 'browserSide' : 'miraSide'] === 'left').reverse()
  const rightPanels = panels.filter(panel => (panel.key === 'browser' || panel.key === 'mira') && draft[panel.key] && draft[panel.key === 'browser' ? 'browserSide' : 'miraSide'] === 'right')
  const arrangement = <div className="workspace-preview-band">Song arrangement</div>

  return <dialog ref={dialog} className="workspace-setup" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeys} onCancel={event => { event.preventDefault(); onCancel() }}>
    <div className="workspace-setup-header">
      <span className="workspace-setup-eyebrow">YOUR NADI WORKSPACE{firstRun ? ` · ${step + 1} OF 3` : ' · SHOW, HIDE & ARRANGE'}</span>
      <button type="button" className="workspace-setup-close" aria-label="Close workspace setup" onClick={onCancel}>×</button>
      <h2 ref={heading} id={titleId} tabIndex={-1}>{['How do you want to start?', 'What should appear?', 'Where should it go?'][step]}</h2>
      <p id={descriptionId}>{!firstRun && step === 1 ? 'Tick what you want to see. Hiding a panel never deletes your music or ideas—you can bring it back here anytime.' : ['A little space goes a long way. Choose a starting point.', 'Keep the things you need. Everything else stays out of the way.', 'Place your panels around your music. You can change this later.'][step]}</p>
    </div>

    <div className="workspace-setup-body">
      {step === 0 && <div className="workspace-start-options">
        <button type="button" onClick={() => preset('piano')}><span>Simple piano</span><small>Note editor and play keyboard. A calm place to begin.</small><em>Recommended</em></button>
        <button type="button" onClick={() => preset('drums')}><span>Make a beat</span><small>Drum pattern editor with room to focus.</small></button>
        <button type="button" onClick={() => preset('full')}><span>Full studio</span><small>All panels visible, ready to customise.</small></button>
      </div>}

      {step === 1 && <>
        <fieldset className="workspace-editor-choice"><legend>Main editor</legend>
          <label><input type="radio" name="workspace-editor" checked={draft.editor === 'piano'} onChange={() => setDraft(current => ({ ...current, editor: 'piano' }))} /> Piano notes</label>
          <label><input type="radio" name="workspace-editor" checked={draft.editor === 'drums'} onChange={() => setDraft(current => ({ ...current, editor: 'drums' }))} /> Drum pattern</label>
        </fieldset>
        <fieldset className="workspace-panel-options"><legend>Optional panels</legend>
          {panels.map(panel => <label key={panel.key}><input type="checkbox" checked={draft[panel.key]} onChange={event => setDraft(current => ({ ...current, [panel.key]: event.target.checked }))} /><span>{panel.name}<small>{panel.detail}</small></span></label>)}
        </fieldset>
      </>}

      {step === 2 && <div className="workspace-placement">
        <div className="workspace-placement-controls">
          {draft.browser && <label>Sound browser<select value={draft.browserSide} onChange={event => setDraft(current => ({ ...current, browserSide: event.target.value as 'left' | 'right' }))}><option value="left">Left side</option><option value="right">Right side</option></select></label>}
          {draft.mira && <label>MIRA assistant<select value={draft.miraSide} onChange={event => setDraft(current => ({ ...current, miraSide: event.target.value as 'left' | 'right' }))}><option value="left">Left side</option><option value="right">Right side</option></select></label>}
          {draft.playlist && <label>Song arrangement<select value={draft.playlistPosition} onChange={event => setDraft(current => ({ ...current, playlistPosition: event.target.value as 'top' | 'bottom' }))}><option value="top">Above editor</option><option value="bottom">Below editor</option></select></label>}
          {!draft.browser && !draft.mira && !draft.playlist && <p>Your editor stays in the centre. Nothing else needs a position.</p>}
          <p className="workspace-placement-note">The play keyboard stays with the editor. The mixer sits below it when shown.</p>
          <p className="workspace-placement-note">On narrower screens, side panels stack so your editor keeps its room.</p>
        </div>
        <figure className="workspace-preview"><figcaption>Your workspace preview · schematic</figcaption>
          <div className="workspace-preview-shell">
            <div className="workspace-preview-transport">Play controls</div>
            <div className="workspace-preview-columns">
              {!!leftPanels.length && <div className="workspace-preview-side">{leftPanels.map(panel => <div key={panel.key}>{panel.name}</div>)}</div>}
              <div className="workspace-preview-centre">
                {draft.playlist && draft.playlistPosition === 'top' && arrangement}
                <div className="workspace-preview-editor">{draft.editor === 'piano' ? 'Piano note editor' : 'Drum pattern editor'}<span>Room for your music</span></div>
                {draft.keyboard && <div className="workspace-preview-band">Play keyboard · with editor</div>}
                {draft.mixer && <div className="workspace-preview-band">Mixer</div>}
                {draft.playlist && draft.playlistPosition === 'bottom' && arrangement}
              </div>
              {!!rightPanels.length && <div className="workspace-preview-side">{rightPanels.map(panel => <div key={panel.key}>{panel.name}</div>)}</div>}
            </div>
          </div>
        </figure>
      </div>}
    </div>

    <div className="workspace-setup-footer">
      <button type="button" className="workspace-setup-secondary" onClick={() => firstRun ? onApply({ ...DEFAULT_WORKSPACE_PREFERENCES }) : onCancel()}>{firstRun ? 'Start simple' : 'Cancel'}</button>
      <div>{step > 0 && <button type="button" className="workspace-setup-secondary" onClick={() => setStep(current => current - 1)}>{!firstRun && step === 1 ? 'Starting presets' : 'Back'}</button>}
        <button type="button" className={!firstRun && step === 1 ? 'workspace-setup-secondary' : 'workspace-setup-primary'} onClick={() => step < 2 ? setStep(current => current + 1) : onApply({ ...draft })}>{step === 2 ? 'Open my workspace' : step === 0 ? 'Keep my current setup' : 'Choose positions'}</button>
        {!firstRun && step === 1 && <button type="button" className="workspace-setup-primary" onClick={() => onApply({ ...draft })}>Apply changes</button>}
      </div>
    </div>
  </dialog>
}
