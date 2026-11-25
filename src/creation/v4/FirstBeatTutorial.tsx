import { useState } from 'react'
import type { StudioProject } from './model'
import './firstBeatTutorial.css'
import { practiceProgress } from './practiceProgress'

const KEY = 'nadi.layout-first-intro.v3'
export function FirstBeatTutorial({ project, disabled, onOpen, onReveal }: { project: StudioProject; disabled: boolean; onOpen: (panel: 'sounds' | 'drums') => void; onReveal: (target: string) => void }) {
  const [mode, setMode] = useState<'invite' | 'tour' | 'prepare' | 'active' | 'hidden'>(() => {
    try { return localStorage.getItem(KEY) ? 'hidden' : 'invite' } catch { return 'invite' }
  })
  const [tourIndex, setTourIndex] = useState(0)
  const [session, setSession] = useState<{ projectId: string; existing: string[] } | null>(null)
  const remember = () => { try { localStorage.setItem(KEY, 'seen') } catch { /* Still usable without storage. */ } }
  const beginTour = () => { remember(); setTourIndex(0); setMode('tour') }
  const start = () => { remember(); setSession({ projectId: project.id, existing: project.tracks.map(track => track.id) }); setMode('active'); onOpen('sounds') }
  const dismiss = () => { remember(); setMode('hidden') }
  const kick = session?.projectId === project.id ? project.tracks.find(track => track.soundId === 'kick' && !session.existing.includes(track.id)) : undefined
  const progress = practiceProgress(project.patterns.find(pattern => pattern.trackId === kick?.id)?.notes ?? [])
  const step = !kick ? 1 : !progress.complete ? 2 : 3
  const offerPractice = () => setMode('prepare')
  if (mode === 'prepare') return <aside className="first-beat-tutorial" aria-label="Practice setup">
    <div><strong>Practice in this project?</strong><p>You will add a new Kick track and four hits to “{project.name}”. These edits stay in this project when you exit the tutorial.</p><p>To keep this song untouched, choose Back to tour, exit, then use Project to start a new project before practicing.</p></div>
    <div className="first-beat-actions"><button type="button" disabled={disabled} onClick={start}>Practice in this project</button><button type="button" onClick={() => setMode('tour')}>Back to tour</button><button type="button" onClick={dismiss}>Exit tutorial</button></div>
  </aside>
  if (mode === 'hidden') return <div className="first-beat-restart"><button type="button" disabled={disabled} onClick={beginTour}>Mira · Studio tutorial</button></div>
  if (mode === 'tour') {
    const page = LAYOUT_TOUR[tourIndex]
    return <aside className="first-beat-tutorial" aria-label="Mira studio layout tour" data-tour={page.highlight}>
      <div className="tutorial-copy"><small>BEFORE SESSION 1: YOUR WORKSPACE · {tourIndex + 1} / {LAYOUT_TOUR.length}</small>
        <h2>{page.title}</h2><ul>{page.points.map(point => <li key={point}>{point}</li>)}</ul>
        <small>Looking around does not add or change music. You can skip or come back anytime.</small>
      </div><div className="first-beat-actions">
        {page.target && <button type="button" disabled={disabled} onClick={() => onReveal(page.target!)}>{page.show}</button>}
        <button type="button" disabled={tourIndex === 0} onClick={() => setTourIndex(value => Math.max(0, value - 1))}>Back</button>
        <button type="button" disabled={disabled} onClick={() => tourIndex === LAYOUT_TOUR.length - 1 ? offerPractice() : setTourIndex(value => Math.min(LAYOUT_TOUR.length - 1, value + 1))}>{tourIndex === LAYOUT_TOUR.length - 1 ? 'Try the practice activity' : 'Next'}</button>
        <button type="button" disabled={disabled} onClick={offerPractice}>Skip to practice</button>
        <button type="button" onClick={dismiss}>Exit tutorial</button>
      </div>
    </aside>
  }
  return <aside className="first-beat-tutorial" aria-label="Mira first beat tutorial">
    <div><strong>Mira · {mode === 'invite' ? 'Get familiar with NADI before Session 1.' : `Practice the controls · ${step} / 3`}</strong>
      {mode === 'invite' ? <p>Get to know the layout and controls before your first session. Then try optional practice. This is a workspace orientation for any musical experience level.</p>
        : session?.projectId !== project.id ? <p>You changed projects. Restart the tutorial here when you’re ready.</p>
        : step === 1 ? <p>Sounds is your instrument shelf. Find Kick under Drums: it makes a low thump. Press ▶ beside it to hear a sample, then Add once. This creates a separate row for that sound and opens it for you.</p>
        : step === 2 ? <p>Time moves left to right. In the first bar of <strong>{kick?.name}</strong>, light up squares 1, 5, 9 and 13. {progress.matched} of 4 target hits placed. {progress.extra > 0 && `Remove ${progress.extra} extra first-bar hit(s) with Erase, then return to Draw.`}</p>
        : <p>Press Play in the top bar. Hear your four hits, then stop and try adding a Snare. You’ve made a beat! Use Save to keep your work.</p>}
      <small>For live keyboard playing, wired speakers or headphones avoid Bluetooth’s extra delay. This built-in guide works without live AI.</small>
    </div><div className="first-beat-actions">
      {mode === 'invite' ? <><button type="button" disabled={disabled} onClick={beginTour}>Show me the layout</button><button type="button" onClick={dismiss}>Explore on my own</button></>
        : <>{session?.projectId !== project.id ? <button type="button" disabled={disabled} onClick={offerPractice}>Restart here</button> : step < 3 ? <button type="button" disabled={disabled} onClick={() => onOpen(step === 1 ? 'sounds' : 'drums')}>{step === 1 ? 'Show Sounds' : 'Show drum grid'}</button> : <button type="button" onClick={dismiss}>I heard it · Finish</button>}<button type="button" onClick={dismiss}>Skip tutorial</button></>}
    </div>
  </aside>
}

const LAYOUT_TOUR: { title: string; points: string[]; highlight: string; target?: string; show?: string }[] = [
  { title: 'Your workspace', highlight: 'layout', points: ['Top bar: play and save. Icon row: choose a view. Large area below: edit your music.', 'Hover over icons, or focus them with Tab, to see their names.'] },
  { title: 'Listen or record', highlight: 'transport', target: 'play-song', show: 'Show Play', points: ['Play listens; Pause pauses; Stop ends playback. Record captures keyboard notes into the selected instrument.', 'Tempo sets speed. Metronome adds a steady click. Grid editing does not need Record.'] },
  { title: 'Change your mind', highlight: 'transport', target: 'undo', show: 'Show Undo', points: ['Undo reverses an edit; Redo restores it. A greyed-out button is unavailable.', 'The selected instrument receives your keyboard notes. Switching instruments keeps your music.'] },
  { title: 'Choose an editing view', highlight: 'panels', target: 'editor-piano', show: 'Show Notes', points: ['Notes: higher blocks sound higher; wider blocks last longer. Drums: click squares to place hits. Arrangement: put parts together.', 'Maximise enlarges a panel; Restore returns it. Close (×) hides the panel and keeps your music.'] },
  { title: 'Choose your sounds', highlight: 'panels', target: 'instrument-picker', show: 'Show Sounds', points: ['Sounds: preview with ▶, then Add to create an instrument track. Mixer: adjust volume or mute.', 'Keyboard opens playable keys. Idea Pad records quick ideas, with microphone permission.'] },
  { title: 'Keep a copy', highlight: 'transport', target: 'save-project', show: 'Show Save', points: ['Save keeps this browser’s project. Project reopens saved work. Export downloads an editable .nadi copy or listening audio.', 'Tutor sharing needs a signed-in account. Anonymous projects stay in this browser.'] },
  { title: 'Review and ask questions', highlight: 'account', points: ['Sheet music shows all instruments or one part as notation. Close returns to the studio.', 'My work & tutor feedback opens questions, progress and comments. Sign in when prompted.'] },
  { title: 'Ask Mira for help', highlight: 'panels', points: ['Mira · AI assistant opens help beside your work. Suggestions are yours to accept or ignore.', 'Next: optional practice with one drum sound and four hits. This tour works without live AI.'] },
]
