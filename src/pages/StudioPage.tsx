import { useState, type Dispatch } from 'react'
import type { MidiState } from '../hooks/useMidi'
import type { AudioStatus } from '../hooks/useAudioEngine'
import type { SaveState } from '../lib/projectPersistence'
import { isAMinor, sortedChordNames } from '../lib/chord'
import {
  canCompleteSession,
  type ProgressAction,
  sessionEvidenceLevel,
} from '../lib/progress'
import type {
  InputSource,
  Page,
  SessionProgress,
  Settings,
  StudioStage,
} from '../types'
import { Transport } from '../components/Brand'
import { Icon } from '../components/Icon'
import { MiraPanel } from '../components/MiraPanel'
import { MiniArrangement } from '../components/MiniArrangement'
import { PianoKeyboard } from '../components/PianoKeyboard'
import { PianoRoll } from '../components/PianoRoll'

interface StudioAudio {
  status: AudioStatus
  ensureReady: () => Promise<boolean>
  trigger: (note: number, duration?: number, velocity?: number) => Promise<boolean>
  playChord: (notes: readonly number[], duration?: number) => Promise<boolean>
  playSeparated: (notes: readonly number[]) => Promise<boolean>
  playComparison: (mode: 'minor' | 'major') => Promise<boolean>
  playMetronome: () => Promise<boolean>
  stopAll: () => void
}

interface StudioPageProps {
  progress: SessionProgress
  dispatch: Dispatch<ProgressAction>
  navigate: (page: Page) => void
  settings: Settings
  midi: MidiState
  audio: StudioAudio
  activeNotes: number[]
  pressScreenNote: (note: number) => void
  releaseNote: (note: number) => void
  clearActiveNotes: () => void
  onReset: () => void
  storageOk: boolean
  saveState: SaveState
}

const phases: Array<{ label: string; stages: StudioStage[] }> = [
  { label: 'Return', stages: ['welcome', 'recall'] },
  { label: 'Explore', stages: ['explore'] },
  { label: 'Learn', stages: ['learn'] },
  { label: 'Practise', stages: ['practice'] },
  { label: 'Apply', stages: ['apply'] },
  { label: 'Studio Check', stages: ['check'] },
  { label: 'Evidence', stages: ['evidence'] },
]

const stageOrder: StudioStage[] = [
  'welcome',
  'recall',
  'explore',
  'learn',
  'practice',
  'apply',
  'check',
  'evidence',
]

const miraMessages: Record<StudioStage, { message: string; mood?: 'listening' | 'thinking' | 'encouraging' | 'celebrating'; action?: string }> = {
  welcome: {
    message: 'Today we’ll build an A minor chord. We’ll take it one step at a time.',
    mood: 'listening',
  },
  recall: {
    message: 'Bring back the four-beat bar from last time. Tap at any steady pace.',
    mood: 'listening',
  },
  explore: {
    message: 'Listen first. There isn’t a wrong mood to notice.',
    mood: 'thinking',
  },
  learn: {
    message: 'A, C, and E keep their own sound. Together, they become one chord shape.',
    mood: 'encouraging',
  },
  practice: {
    message: 'Use screen keys, your computer keys, or MIDI. I’ll only check the notes you play.',
    mood: 'listening',
  },
  apply: {
    message: 'Place your A minor shape at the start of bar 1, then play it back.',
    mood: 'listening',
  },
  check: {
    message: 'I’ll stay quiet while you rebuild it. Ask for a clue whenever you want.',
    mood: 'listening',
  },
  evidence: {
    message: 'You built A minor, placed it on the grid, and rebuilt it from memory. Your checkpoint is safe.',
    mood: 'celebrating',
  },
}

export function StudioPage(props: StudioPageProps) {
  const { progress, navigate, audio } = props
  const stage = progress.stage
  const copy = miraMessages[stage]
  const playTransport = () => {
    if (stage === 'apply' && progress.evidence.apply.notes.length) {
      void audio.playChord(progress.evidence.apply.notes, 1.4)
    } else {
      void audio.playChord([57, 60, 64], 1.4)
    }
  }

  return (
    <div className="app-shell studio-shell">
      <Transport
        onPlay={playTransport}
        onStop={audio.stopAll}
        onHome={() => navigate('home')}
        saveState={props.saveState}
      />
      {((props.saveState === 'not-saved' || props.saveState === 'conflict') || audio.status === 'unavailable') && (
        <div className="recovery-toast" role="status">
          <Icon name="help" />
          <span>{(props.saveState === 'not-saved' || props.saveState === 'conflict') ? 'Progress is not saving on this browser. Keep this tab open while you work.' : 'Sound could not start. Your notes and grid edits are still here.'}</span>
          {audio.status === 'unavailable' && <button type="button" onClick={() => void audio.ensureReady()}>Enable sound</button>}
        </div>
      )}
      <SoundBrowser />
      <main className="studio-main" id="main-content" tabIndex={-1}>
        <PhaseRail stage={stage} />
        <div className="studio-workspace">
          <StageContent {...props} />
        </div>
      </main>
      <MiraPanel
        title="Session 3 · Build the Harmony A"
        message={copy.message}
        mood={copy.mood}
        actionLabel={stage === 'check' && !progress.evidence.check.completedAt ? 'Give me one clue' : undefined}
        onAction={stage === 'check' && !progress.evidence.check.completedAt ? () => props.dispatch({ type: 'CHECK_HINT' }) : undefined}
      />
      <div className="studio-footer-status">
        <span className={props.midi.status === 'connected' ? 'is-ready' : ''}>● {props.midi.status === 'connected' ? props.midi.deviceName : 'Screen keys ready'}</span>
        <span>● {audio.status === 'ready' ? 'Audio ready' : audio.status === 'unavailable' ? 'Audio unavailable' : 'Audio on after first play'}</span>
        <span>● {props.saveState === 'saving' ? 'Saving…' : props.storageOk ? 'Saved' : 'Not saved'}</span>
      </div>
    </div>
  )
}

function SoundBrowser() {
  const sounds = [
    ['piano', 'Piano'],
    ['grid', 'Keys'],
    ['music', 'Bass'],
    ['spark', 'Drums'],
    ['music', 'Strings'],
    ['spark', 'Pad'],
    ['settings', 'FX'],
  ] as Array<[Parameters<typeof Icon>[0]['name'], string]>
  return (
    <aside className="sound-browser shell-frame" aria-label="Sound browser">
      <div className="eyebrow teal">Sounds</div>
      <label className="sound-search"><span className="sr-only">Search sounds</span><input type="search" placeholder="Search sounds…" disabled /><span>⌕</span></label>
      <div className="eyebrow sound-browser__category">Categories</div>
      <div className="sound-list">
        {sounds.map(([icon, label]) => (
          <button type="button" className={label === 'Piano' ? 'is-active' : ''} key={label} disabled={label !== 'Piano'}>
            <Icon name={icon} /> {label}
          </button>
        ))}
      </div>
      <div className="sound-browser__project"><Icon name="projects" /> Your first 8 bars</div>
    </aside>
  )
}

function PhaseRail({ stage }: { stage: StudioStage }) {
  const activeIndex = stageOrder.indexOf(stage)
  return (
    <ol className="phase-rail" aria-label="Session phases">
      {phases.map((phase, index) => {
        const phaseIndex = Math.min(...phase.stages.map((item) => stageOrder.indexOf(item)))
        const isActive = phase.stages.includes(stage)
        const isComplete = activeIndex > Math.max(...phase.stages.map((item) => stageOrder.indexOf(item)))
        return (
          <li className={`${isActive ? 'is-active' : ''} ${isComplete ? 'is-complete' : ''}`} key={phase.label}>
            <span>{isComplete ? <Icon name="check" /> : <i />}</span>
            <strong>{phase.label}</strong>
            {index < phases.length - 1 && <b aria-hidden="true" />}
            <em className="sr-only">{isActive ? 'current' : isComplete ? 'complete' : `phase ${phaseIndex + 1}`}</em>
          </li>
        )
      })}
    </ol>
  )
}

function StageContent(props: StudioPageProps) {
  switch (props.progress.stage) {
    case 'welcome':
      return <WelcomeStage {...props} />
    case 'recall':
      return <RecallStage {...props} />
    case 'explore':
      return <ExploreStage {...props} />
    case 'learn':
      return <LearnStage {...props} />
    case 'practice':
      return <PracticeStage {...props} />
    case 'apply':
      return <ApplyStage {...props} />
    case 'check':
      return <CheckStage {...props} />
    case 'evidence':
      return <EvidenceStage {...props} />
  }
}

function WelcomeStage({ dispatch, audio, navigate, storageOk }: StudioPageProps) {
  return (
    <section className="studio-stage welcome-stage">
      <div className="studio-stage__heading">
        <div className="eyebrow amber">Session 3 · Build the Harmony A</div>
        <h1>Welcome back</h1>
        <p>{storageOk ? 'Your progress saves locally. Start with a small reminder from last time.' : 'Keep this tab open while local saving is unavailable. Start with a small reminder from last time.'}</p>
      </div>
      <div className="welcome-arrangement panel"><MiniArrangement /><span className="welcome-arrangement__tag"><Icon name="save" /> beat-and-bar-complete</span></div>
      <p className="recap-line"><strong>Last time:</strong> you learned how four beats make one bar.</p>
      <div className="page-actions welcome-actions">
        <button type="button" className="button button--gold" onClick={() => void audio.playMetronome()}><Icon name="volume" /> Hear where I left off</button>
        <button type="button" className="button button--primary" onClick={() => dispatch({ type: 'START_RECALL' })}>Start 4-beat recall <Icon name="arrow" /></button>
        <button type="button" className="button button--quiet" onClick={() => navigate('projects')}>Open project map</button>
      </div>
      <div className="safe-copy"><Icon name="save" /> {storageOk ? 'Meaningful actions are autosaved on this browser.' : 'This in-memory session will be lost if the tab closes.'}</div>
    </section>
  )
}

function RecallStage({ progress, dispatch, audio }: StudioPageProps) {
  const taps = progress.evidence.recall.taps
  return (
    <section className="studio-stage recall-stage">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">A small return</div>
        <h1>Bring back one bar</h1>
        <p>Tap four steady beats. There is no timer.</p>
      </div>
      <div className="beat-recall panel">
        <div className="beat-dots">
          {[1, 2, 3, 4].map((beat) => <span className={taps >= beat ? 'is-hit' : ''} key={beat}>{beat}</span>)}
        </div>
        <button
          type="button"
          className="beat-pad"
          onClick={() => {
            void audio.trigger(taps === 0 ? 84 : 79, 0.12, taps === 0 ? 0.92 : 0.64)
            dispatch({ type: 'RECALL_TAP' })
          }}
        >
          <Icon name="music" /> Tap beat {Math.min(4, taps + 1)}
        </button>
      </div>
      <p className="safe-copy"><Icon name="clock" /> Any steady pace works for this reminder.</p>
    </section>
  )
}

function ExploreStage({ progress, dispatch, audio }: StudioPageProps) {
  const { explore } = progress.evidence
  const canChoose = explore.heardMinor && explore.heardMajor
  const play = async (mode: 'minor' | 'major') => {
    if (await audio.playComparison(mode)) {
      dispatch({ type: 'HEARD_COMPARISON', mode })
    }
  }
  return (
    <section className="studio-stage explore-stage">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">Explore by listening</div>
        <h1>Which one fits your track?</h1>
        <p>Hear both before choosing. This is about what you notice, not a right mood.</p>
      </div>
      <div className="comparison-grid">
        <article className={`comparison-card panel panel--teal ${explore.heardMinor ? 'has-played' : ''}`}>
          <div className="eyebrow">Version A</div><h2>A minor</h2>
          <div className="triad-visual"><span>A</span><span>C</span><span>E</span></div>
          <div className="waveform waveform--large" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 13) % 65)}%` }} />)}</div>
          <button type="button" className="button button--primary" onClick={() => void play('minor')}><Icon name="play" /> {explore.heardMinor ? 'Play A again' : 'Play A'}</button>
        </article>
        <article className={`comparison-card panel panel--gold ${explore.heardMajor ? 'has-played' : ''}`}>
          <div className="eyebrow amber">Version B</div><h2>A major</h2>
          <div className="triad-visual triad-visual--major"><span>A</span><span>C♯</span><span>E</span></div>
          <div className="waveform waveform--large waveform--gold" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${20 + ((index * 19) % 60)}%` }} />)}</div>
          <button type="button" className="button button--gold" onClick={() => void play('major')}><Icon name="play" /> {explore.heardMajor ? 'Play B again' : 'Play B'}</button>
        </article>
      </div>
      <div className="choice-row">
        <span>{canChoose ? 'Which version belongs in your reflective track?' : 'Listen to both versions to unlock your choice.'}</span>
        <button type="button" className="button button--quiet" disabled={!canChoose} onClick={() => dispatch({ type: 'CHOOSE_COMPARISON', choice: 'minor' })}>Choose A minor</button>
        <button type="button" className="button button--quiet" disabled={!canChoose} onClick={() => dispatch({ type: 'CHOOSE_COMPARISON', choice: 'major' })}>Choose A major</button>
      </div>
    </section>
  )
}

function LearnStage({ progress, dispatch, audio }: StudioPageProps) {
  const { learn } = progress.evidence
  const complete = learn.heardSeparate && learn.heardTogether
  return (
    <section className="studio-stage learn-stage">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">One shape · three notes</div>
        <h1>Meet A · C · E</h1>
        <p>A triad uses three note names. First hear each note, then hear the chord.</p>
      </div>
      <div className="learn-layout">
        <div className="note-towers panel">
          {[
            ['A', 'Root', 'The note the chord is named after.'],
            ['C', 'Third', 'The note that gives this chord its minor colour.'],
            ['E', 'Fifth', 'The note that helps the shape feel steady.'],
          ].map(([note, role, copy], index) => (
            <div className="note-tower" key={note}>
              <button type="button" onClick={() => void audio.trigger([57, 60, 64][index], 0.8)}>{note}</button>
              <strong>{role}</strong><small>{copy}</small>
            </div>
          ))}
        </div>
        <div className="learn-actions panel">
          <button type="button" className={`lesson-audio ${learn.heardSeparate ? 'is-done' : ''}`} onClick={() => { void audio.playSeparated([57, 60, 64]).then((played) => { if (played) dispatch({ type: 'HEARD_LESSON', mode: 'separate' }) }) }}>
            <Icon name="play" /><span><strong>Hear A, then C, then E</strong><small>Three separate sounds</small></span>{learn.heardSeparate && <Icon name="check" />}
          </button>
          <button type="button" className={`lesson-audio ${learn.heardTogether ? 'is-done' : ''}`} onClick={() => { void audio.playChord([57, 60, 64], 1.5).then((played) => { if (played) dispatch({ type: 'HEARD_LESSON', mode: 'together' }) }) }}>
            <Icon name="play" /><span><strong>Hear A + C + E</strong><small>One combined chord shape</small></span>{learn.heardTogether && <Icon name="check" />}
          </button>
          <button type="button" className="button button--primary" disabled={!complete} onClick={() => dispatch({ type: 'GO_PRACTICE' })}>Let me build it <Icon name="arrow" /></button>
        </div>
      </div>
    </section>
  )
}

function PracticeStage(props: StudioPageProps) {
  const { progress, dispatch, settings, activeNotes, pressScreenNote, releaseNote } = props
  const practice = progress.evidence.practice
  const complete = isAMinor(practice.notes) && practice.inputEvents >= 3
  const names = sortedChordNames(practice.notes)
  return (
    <section className="studio-stage practice-stage">
      <div className="studio-stage__heading studio-stage__heading--row">
        <div><div className="eyebrow teal">Disposable practice space</div><h1>Build A minor</h1><p>Play A, C, and E. Step capture works one note at a time.</p></div>
        <InputBadge source={practice.source} midi={props.midi} />
      </div>
      <div className={`capture-status panel ${complete ? 'is-correct' : ''}`}>
        <div className="capture-slots">
          {[0, 1, 2].map((index) => <span key={index}>{names[index] ?? '·'}</span>)}
        </div>
        <div>
          <strong>{complete ? 'A minor found' : names.length ? `${names.join(' + ')} captured` : 'Waiting for your notes'}</strong>
          <p>{complete ? 'Those three pitch classes make A minor, in any octave.' : practice.notes.length > 3 ? 'One extra pitch class is present. Clear the capture and try the three-note shape again.' : 'Use the piano below, computer keys A–K, or a MIDI keyboard.'}</p>
        </div>
        <button type="button" className="button button--small button--quiet" onClick={() => dispatch({ type: 'PRACTICE_CLEAR' })}>Clear</button>
      </div>
      <PianoKeyboard activeNotes={[...activeNotes, ...practice.notes]} onPress={pressScreenNote} onRelease={releaseNote} showNames={settings.showNoteNames} highlighted={practice.hintsUsed ? [57, 60, 64] : []} />
      <div className="practice-footer">
        <button type="button" className="button button--gold" onClick={() => dispatch({ type: 'PRACTICE_HINT' })}><Icon name="help" /> {practice.hintsUsed ? 'Show me differently' : 'Give me one hint'}</button>
        <span>{practice.hintsUsed ? 'Clue: find the three highlighted white notes.' : 'Hints change the support record, never your ability to continue.'}</span>
        <button type="button" className="button button--primary" disabled={!complete} onClick={() => dispatch({ type: 'GO_APPLY' })}>Apply to my track <Icon name="arrow" /></button>
      </div>
    </section>
  )
}

function ApplyStage({ progress, dispatch, audio }: StudioPageProps) {
  const apply = progress.evidence.apply
  const chordReady = isAMinor(apply.notes) && apply.editEvents >= 3
  const complete = chordReady && apply.playedBack
  const toggle = (note: number) => {
    dispatch({ type: 'APPLY_TOGGLE', note })
    void audio.trigger(note, 0.4)
  }
  return (
    <section className="studio-stage apply-stage">
      <div className="studio-stage__heading studio-stage__heading--row">
        <div><div className="eyebrow teal">Piano Roll · your first 8 bars</div><h1>Place A minor in bar 1</h1><p>Pitch moves up and down. Time moves left to right.</p></div>
        <div className="apply-status"><Icon name={complete ? 'check' : 'grid'} /><span>{complete ? 'Applied and heard' : 'Bar 1 · chord lane'}</span></div>
      </div>
      <div className="apply-layout">
        <PianoRoll notes={apply.notes} onToggle={toggle} />
        <aside className="apply-inspector panel">
          <div className="eyebrow">Selected lane</div><h2>Piano chords</h2>
          <dl><div><dt>Bar</dt><dd>1</dd></div><div><dt>Length</dt><dd>1 bar</dd></div><div><dt>Captured</dt><dd>{sortedChordNames(apply.notes).join(' · ') || 'None yet'}</dd></div></dl>
          <p>{chordReady ? 'Your A, C, and E notes share the same start line.' : 'Choose A, C, and E in the first column.'}</p>
        </aside>
      </div>
      <div className="apply-footer">
        <button type="button" className="button button--quiet" onClick={() => { if (apply.notes.length) { void audio.playChord(apply.notes, 1.4).then((played) => { if (played) dispatch({ type: 'APPLY_PLAYED' }) }) } }} disabled={!chordReady}><Icon name="play" /> Play this pattern</button>
        <span>{chordReady && !apply.playedBack ? 'Listen once before the Studio Check.' : complete ? 'The chord is placed and your playback is recorded.' : 'The grid only accepts your own edits.'}</span>
        <button type="button" className="button button--primary" onClick={() => dispatch({ type: 'GO_CHECK' })} disabled={!complete}>Studio Check <Icon name="arrow" /></button>
      </div>
    </section>
  )
}

function CheckStage(props: StudioPageProps) {
  const { progress, dispatch, settings, activeNotes, pressScreenNote, releaseNote } = props
  const check = progress.evidence.check
  const complete = isAMinor(check.notes) && check.inputEvents >= 3
  const names = sortedChordNames(check.notes)
  const clue = check.hintsUsed > 0
  return (
    <section className="studio-stage check-stage">
      <div className="studio-stage__heading studio-stage__heading--row">
        <div><div className="eyebrow teal">Studio Check</div><h1>Build A minor without note lights</h1><p>No timer. Use any input that lets you show the chord from memory.</p></div>
        <InputBadge source={check.source} midi={props.midi} />
      </div>
      <div className={`memory-capture ${complete ? 'is-correct' : ''}`}>
        <div className="capture-slots capture-slots--large">{[0, 1, 2].map((index) => <span key={index}>{names[index] ?? '·'}</span>)}</div>
        {complete && <div className="memory-capture__result"><Icon name="check" /><span><strong>A minor rebuilt</strong><small>{clue ? 'With one or more clues' : 'Without note lights'}</small></span></div>}
      </div>
      <PianoKeyboard activeNotes={[...activeNotes, ...check.notes]} onPress={pressScreenNote} onRelease={releaseNote} showNames={settings.showNoteNames && clue} highlighted={clue ? [57, 60, 64] : []} hideGuidance={!clue} />
      <div className="check-footer">
        <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'CHECK_CLEAR' })}>Clear and try again</button>
        <span><Icon name="clock" /> Take your time.</span>
        {!complete ? (
          <button type="button" className="button button--gold" onClick={() => dispatch({ type: 'CHECK_HINT' })}><Icon name="help" /> I need a clue</button>
        ) : (
          <button type="button" className="button button--primary" disabled={!canCompleteSession(progress)} onClick={() => dispatch({ type: 'FINALIZE' })}>See my evidence <Icon name="arrow" /></button>
        )}
      </div>
    </section>
  )
}

function EvidenceStage({ progress, dispatch, navigate, audio, onReset, storageOk }: StudioPageProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const level = sessionEvidenceLevel(progress)
  const support = level === 'independent' ? 'Independent' : 'With guidance'
  return (
    <section className="studio-stage evidence-stage">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">{storageOk ? 'Checkpoint saved' : 'Checkpoint pending'} · harmony-a-complete</div>
        <h1>{storageOk ? 'Session saved' : 'Session complete in this tab'}</h1>
        <p>You have a clear record of what you actually did today.</p>
      </div>
      <div className="evidence-layout">
        <div className="evidence-card panel panel--teal">
          <div className="eyebrow">Today’s evidence</div>
          <EvidenceLine icon="piano" text="Built A minor in practice" detail={`${progress.evidence.practice.inputEvents} note inputs · ${progress.evidence.practice.source ?? 'screen'} keys`} />
          <EvidenceLine icon="grid" text="Placed A · C · E on the Piano Roll" detail={`${progress.evidence.apply.editEvents} grid edits · played back`} />
          <EvidenceLine icon="spark" text="Rebuilt A minor from memory" detail={`${support} · ${progress.evidence.check.hintsUsed} clues`} />
          <EvidenceLine icon="save" text={storageOk ? 'Saved harmony-a-complete' : 'harmony-a-complete pending save'} detail={storageOk && progress.checkpoint ? new Date(progress.checkpoint.savedAt).toLocaleString() : 'Download a backup or keep this tab open'} />
          <span className={`support-pill support-pill--${level}`}>{support}</span>
        </div>
        <div className="reflection-card panel">
          <div className="eyebrow amber">Reflection</div>
          <h2>How did A minor feel in your track?</h2>
          <div className="reflection-choices">
            {['Calm', 'Sad', 'Uncertain'].map((choice) => <button type="button" className={progress.evidence.reflection === choice ? 'is-active' : ''} key={choice} onClick={() => dispatch({ type: 'SET_REFLECTION', value: choice })}>{choice}</button>)}
          </div>
          <label>My own words<textarea value={progress.evidence.reflection && !['Calm', 'Sad', 'Uncertain'].includes(progress.evidence.reflection) ? progress.evidence.reflection : ''} onChange={(event) => dispatch({ type: 'SET_REFLECTION', value: event.target.value })} placeholder="A few words are enough…" /></label>
        </div>
      </div>
      <MiniArrangement completed />
      <div className="evidence-actions">
        <button type="button" className="button button--gold" onClick={() => navigate('projects')}><Icon name="save" /> Stop here safely</button>
        <button type="button" className="button button--primary" onClick={() => void audio.playChord([57, 60, 64], 1.5)}><Icon name="play" /> Keep experimenting</button>
        {!confirmReset ? (
          <button type="button" className="text-link text-link--muted" onClick={() => setConfirmReset(true)}><Icon name="refresh" /> Restart the session demo</button>
        ) : (
          <div className="reset-confirm" role="group" aria-label="Confirm Session 3 reset">
            <span>Reset only this NADI Session 3 checkpoint?</span>
            <button type="button" onClick={onReset}>Reset Session 3 data</button>
            <button type="button" onClick={() => setConfirmReset(false)}>Keep checkpoint</button>
          </div>
        )}
      </div>
    </section>
  )
}

function InputBadge({ source, midi }: { source?: InputSource; midi: MidiState }) {
  const label = source === 'midi' ? midi.deviceName ?? 'MIDI keyboard' : source === 'computer' ? 'Computer keys' : source === 'screen' ? 'Screen keys' : midi.status === 'connected' ? midi.deviceName : 'Choose any input'
  return <span className="input-badge"><i className={source ? 'is-live' : ''} /> {label}</span>
}

function EvidenceLine({ icon, text, detail }: { icon: Parameters<typeof Icon>[0]['name']; text: string; detail: string }) {
  return <div className="evidence-line"><span><Icon name="check" /></span><Icon name={icon} /><div><strong>{text}</strong><small>{detail}</small></div></div>
}
