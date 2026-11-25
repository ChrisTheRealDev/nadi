import { useState, type Dispatch } from 'react'
import { Transport } from '../components/Brand'
import { Icon } from '../components/Icon'
import { MiraPanel } from '../components/MiraPanel'
import {
  canFinalizeGuidedSession,
  chordNotes,
  currentProjectReference,
  expectedChords,
  isGuidedSessionComplete,
  learnComplete,
  makeComplete,
  melodyAValid,
  melodyBValid,
  mixWithinBeginnerRange,
  scaleNotes,
  type CourseAction,
  type CourseProgress,
  type CourseValue,
  type GuidedStage,
} from '../lib/courseProgress'
import type { AudioStatus } from '../hooks/useAudioEngine'
import type { AuditionCompletionReceipt, PlaybackReceipt, ScheduledNote } from '../lib/audio'
import { session2ArtifactFingerprint, session4ArtifactFingerprint } from '../lib/learningChecks'
import {
  beatLabelFromTick,
  durationLabel,
  EIGHTH_NOTE_TICKS,
  eventsForBar,
  hasOverlappingEvents,
  melodyDurationChoices,
  midiForNoteNameNear,
  noteNameFromMidi as eventNoteName,
  TICKS_PER_BAR,
  type MelodyNoteEvent,
} from '../lib/melodyEvents'
import type { GuidedSessionId, Page } from '../types'
import type { SaveState } from '../lib/projectPersistence'
import { highestSupportUsed, learningCycleStages } from '../lib/learningAttempts'
import { projectContentFingerprint, type ProjectCommand } from '../lib/projectModel'

interface SessionAudio {
  status: AudioStatus
  trigger: (note: number, duration?: number, velocity?: number) => Promise<boolean>
  playChord: (notes: readonly number[], duration?: number) => Promise<boolean>
  playMetronome: (bars?: number) => Promise<boolean>
  playProject: (project: CourseProgress['project']) => Promise<PlaybackReceipt | undefined>
  playProjectSection: (project: CourseProgress['project'], startBar: number, endBar: number) => Promise<PlaybackReceipt | undefined>
  currentAudioEpoch: () => number
  playAuditionArtifact: (request: { notes: readonly ScheduledNote[]; bpm: number; attemptId: string; generation: number; fingerprint: string; lengthTicks: number }) => Promise<AuditionCompletionReceipt | undefined>
  validateAuditionReceiptAgainstCurrentAudio: (receipt: AuditionCompletionReceipt) => boolean
  stopAll: () => void
}

interface GuidedSessionPageProps {
  session: GuidedSessionId
  progress: CourseProgress
  dispatch: Dispatch<CourseAction>
  navigate: (page: Page) => void
  audio: SessionAudio
  storageOk: boolean
  saveState: SaveState
  onReset: (session: GuidedSessionId) => void
  recordingScope?: string
  onToggleRawTake: (scope: string) => void
}

const sessionCopy: Record<GuidedSessionId, { title: string; duration: string; badge: string; promise: string; mira: string }> = {
  2: { title: 'Beat, Bar & Grid', duration: '30–40 min', badge: 'Pulse Finder', promise: 'Learn that four beats make one bar, and see where those beats live in a DAW.', mira: 'Today has one idea: four beats make one bar. Beat 1 starts each bar, and the grid shows us exactly where each beat belongs.' },
  4: { title: 'Harmony B', duration: '35–45 min', badge: 'Harmony Builder', promise: 'Build F, C, and G, then hear the progression move.', mira: 'A minor was one shape. These three new shapes give your music somewhere to travel.' },
  5: { title: 'Shape the Chords', duration: '35–45 min', badge: 'Pattern Maker', promise: 'Place and align the complete eight-bar harmony.', mira: 'You already made the harmony. Now the Piano Roll decides when each chord starts and stops.' },
  6: { title: 'Write a Phrase', duration: '45–55 min', badge: 'Phrase Maker', promise: 'Write an original four-bar melody over your chords.', mira: 'Your melody does not need to be fancy. Give it a stable beginning, a little movement, and some breathing room.' },
  7: { title: 'Repeat with Meaning', duration: '35–45 min', badge: 'Eight-Bar Builder', promise: 'Repeat your phrase, then change the ending on purpose.', mira: 'Recognition plus change makes a form. We’ll keep your idea and make the second half answer it.' },
  8: { title: 'Give It Expression', duration: '40–55 min', badge: 'First Track', promise: 'Shape touch, balance, and space without hiding the notes.', mira: 'The notes are ready. Now we’ll shape how firmly they speak and how much space surrounds them.' },
}

const stages: GuidedStage[] = ['welcome', 'learn', 'make', 'check', 'evidence']
const stageLabels: Record<GuidedStage, string> = {
  welcome: 'Begin', learn: 'Hear & learn', make: 'Make', check: 'Studio Check', evidence: 'Evidence',
}

export function GuidedSessionPage(props: GuidedSessionPageProps) {
  const { session, progress, audio, navigate } = props
  const record = progress.sessions[String(session)]
  const copy = sessionCopy[session]
  const missingPrerequisite =
    (session === 7 && record.stage === 'make' && !melodyAValid(progress.project)) ||
    (session === 8 && record.stage === 'make' && !(expectedChords.every((chord, index) => progress.project.chords[index] === chord) && melodyAValid(progress.project) && melodyBValid(progress.project)))
  const preview = () => {
    if (session === 2) void audio.playMetronome()
    else if (session === 4 || session === 5) void audio.playChord(chordNotes.Am, 1.1)
    else void audio.trigger(69, 1, 0.72)
  }
  return (
    <div className="app-shell studio-shell guided-session-shell">
      <Transport onPlay={preview} onStop={audio.stopAll} onHome={() => navigate('projects')} saveState={props.saveState} />
      {(props.saveState === 'not-saved' || props.saveState === 'conflict') && <div className="recovery-toast" role="status"><Icon name="help" /><span>This session is not saving in this browser. Keep the tab open while you work.</span></div>}
      <CourseBrowser progress={progress} session={session} />
      <main className="studio-main" id="main-content" tabIndex={-1}>
        <CourseRail stage={record.stage} />
        <div className="studio-workspace">
          {record.learning && <LearningCyclePanel progress={progress} session={session} dispatch={props.dispatch} />}
          {session >= 5 && <CompositionMap progress={progress} />}
          <section className="studio-stage guided-stage">
            {session === 2 && <GridLessonGoal />}
            {record.stage === 'welcome' && <Welcome {...props} />}
            {record.stage === 'learn' && <Learn {...props} />}
            {record.stage === 'make' && <Make {...props} />}
            {record.stage === 'check' && <Check {...props} />}
            {record.stage === 'evidence' && <Evidence {...props} />}
          </section>
        </div>
      </main>
      <MiraPanel title={`Session ${session} · ${copy.title}`} message={record.stage === 'evidence' ? `You earned ${copy.badge}. The evidence names what you demonstrated—there is no percentage score.` : missingPrerequisite ? 'This workspace is ready. Finish the earlier project layer first, and your own music will appear here safely.' : copy.mira} mood={record.stage === 'evidence' ? 'celebrating' : record.stage === 'check' ? 'listening' : missingPrerequisite ? 'technical' : 'encouraging'} />
      <div className="studio-footer-status"><span className={audio.status === 'ready' ? 'is-ready' : ''}>● {audio.status === 'ready' ? 'Audio ready' : 'Audio starts on click'}</span><span className="is-ready">● 90 BPM · 4/4 · 8 bars</span><span className={props.storageOk ? 'is-ready' : ''}>● {props.saveState === 'saving' ? 'Saving…' : props.storageOk ? 'Saved' : 'Not saved'}</span></div>
    </div>
  )
}

function LearningCyclePanel({ progress, session, dispatch }: { progress: CourseProgress; session: GuidedSessionId; dispatch: Dispatch<CourseAction> }) {
  const learning = progress.sessions[String(session)].learning
  if (!learning) return null
  const current = learning.current
  const support = highestSupportUsed(current.support)
  const supportCopy = support === 'none' ? 'Try a nudge' : support === 'nudge' ? 'Show a cue' : support === 'cue' ? 'Show an example' : 'Example used'
  const next = learningCycleStages[learningCycleStages.indexOf(current.stage) + 1]
  return <aside className="panel" aria-label="Learning cycle and support">
    <div className="eyebrow teal">{learningCycleStages.map((stage) => stage === current.stage ? `[${stage}]` : stage).join(' → ')}</div>
    <p>{support === 'none' ? 'No help used in this attempt.' : `Help used: ${support}. This attempt can still be recorded as supported.`}</p>
    <div className="button-row">
      {next && current.stage !== 'independent-check' && current.stage !== 'reflect' && <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'ADVANCE_LEARNING_STAGE', session, next })}>Continue to {next}</button>}
      {support !== 'example' && current.result === 'not-yet' && <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'RECORD_LEARNING_SUPPORT', session, level: support === 'none' ? 'nudge' : support === 'nudge' ? 'cue' : 'example' })}>{supportCopy}</button>}
      {support !== 'none' && <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'RESTART_FRESH_ATTEMPT', session })}>{support === 'example' ? 'Clear example and start fresh' : 'Start a fresh lower-help attempt'}</button>}
    </div>
    {support === 'nudge' && <p>Notice the first event in the bar or phrase before changing anything.</p>}
    {support === 'cue' && <p>Compare the current artifact with the target, one property at a time.</p>}
    {support === 'example' && <p>The example shows a possible process, not an answer to submit. Clear it, then make a fresh attempt.</p>}
  </aside>
}

function ReflectionCapture({ session, attempt, dispatch }: { session: GuidedSessionId; attempt: NonNullable<CourseProgress['sessions'][string]['learning']>['current']; dispatch: Dispatch<CourseAction> }) {
  return <div className="panel"><label>Reflect on the fresh attempt (recorded for review)<input value={attempt.reflection} onChange={(event) => dispatch({ type: 'RECORD_LEARNING_REFLECTION', session, reflection: event.target.value })} placeholder="What did you notice or choose?" /></label><button type="button" className="button button--primary" disabled={attempt.reflection.trim().length < 3 || attempt.result !== 'not-yet'} onClick={() => dispatch({ type: 'EARN_GUIDED_EVIDENCE', session })}>Record this evidence</button>{attempt.result !== 'not-yet' && <p role="status">Recorded as {attempt.result}. Asking for help was preserved honestly.</p>}</div>
}

function GridLessonGoal() {
  return <aside className="grid-lesson-goal" aria-label="Session 2 learning goal">
    <span>SESSION TARGET</span>
    <strong>4 beats = 1 bar</strong>
    <p>Beat 1 starts every bar. A DAW grid shows where those beats belong.</p>
  </aside>
}

function CompositionMap({ progress }: { progress: CourseProgress }) {
  return <section className="composition-map panel" aria-label="Eight-bar composition map">
    <div className="composition-map__heading"><span>Composition map</span><strong>A</strong><i /><strong>A′</strong></div>
    <div className="composition-map__bars">{Array.from({ length: 8 }, (_, index) => {
      const chord = progress.project.chords[index] || expectedChords[index]
      const count = eventsForBar(progress.project.melodyEvents, index).length
      return <div key={index} className={count ? 'has-melody' : ''}><span>{index + 1}</span><strong>{chord}</strong><small>{count ? `${count} melody ${count === 1 ? 'note' : 'notes'}` : 'space'}</small></div>
    })}</div>
  </section>
}

function CourseBrowser({ progress, session }: { progress: CourseProgress; session: GuidedSessionId }) {
  const complete = isGuidedSessionComplete(progress, session)
  return <aside className="sound-browser shell-frame" aria-label="Project browser">
    <div className="eyebrow teal">Emotive Piano 01</div>
    <div className="course-browser-meter"><span style={{ width: `${session * 12.5}%` }} /></div>
    <strong>Session {session} of 8</strong>
    <div className="sound-list">
      <button type="button" disabled className={progress.project.chords.length === 8 ? 'is-active' : ''}><Icon name="grid" /> Piano chords</button>
      <button type="button" disabled className={progress.project.melodyEvents.length ? 'is-active' : ''}><Icon name="music" /> Melody</button>
    </div>
    <dl className="course-browser-facts"><div><dt>Tempo</dt><dd>90 BPM</dd></div><div><dt>Form</dt><dd>8 bars</dd></div><div><dt>Status</dt><dd>{complete ? 'Saved' : 'In progress'}</dd></div></dl>
  </aside>
}

function CourseRail({ stage }: { stage: GuidedStage }) {
  const active = stages.indexOf(stage)
  return <ol className="phase-rail guided-rail" aria-label="Session phases">{stages.map((item, index) => <li key={item} className={`${item === stage ? 'is-active' : ''} ${index < active ? 'is-complete' : ''}`}><span>{index < active ? <Icon name="check" /> : <i />}</span><strong>{stageLabels[item]}</strong>{index < stages.length - 1 && <b aria-hidden="true" />}<em className="sr-only">{item === stage ? 'current' : index < active ? 'complete' : `phase ${index + 1}`}</em></li>)}</ol>
}

function Heading({ session, eyebrow, title, description }: { session: GuidedSessionId; eyebrow: string; title: string; description: string }) {
  return <div className="studio-stage__heading"><div className="eyebrow teal">Session {session} · {eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
}

function Welcome({ session, dispatch }: GuidedSessionPageProps) {
  const copy = sessionCopy[session]
  return <><Heading session={session} eyebrow={copy.duration} title={copy.title} description={copy.promise} /><div className="guided-welcome panel panel--teal"><Icon name={session < 5 ? 'grid' : 'music'} /><div><div className="eyebrow">One main idea</div><h2>{sessionGoal(session)}</h2><p>You can pause after any phase. Asking for help never lowers a score; this attempt records support honestly.</p></div></div><div className="page-actions"><button type="button" className="button button--primary" onClick={() => dispatch({ type: 'START', session })}>Hear the idea <Icon name="arrow" /></button></div></>
}

function sessionGoal(session: GuidedSessionId) {
  return ({ 2: 'Beat → bar → grid', 4: 'Three new chord shapes', 5: 'Time inside the Piano Roll', 6: 'Chord tones and melody', 7: 'Repetition and variation', 8: 'Velocity, balance, and space' } as const)[session]
}

function Learn(props: GuidedSessionPageProps) {
  switch (props.session) {
    case 2: return <GridLearn {...props} />
    case 4: return <HarmonyLearn {...props} />
    case 5: return <ShapeLearn {...props} />
    case 6: return <PhraseLearn {...props} />
    case 7: return <VariationLearn {...props} />
    case 8: return <ExpressionLearn {...props} />
  }
}

function LearningCards({ session, items, progress, dispatch }: { session: GuidedSessionId; items: Array<{ key: string; title: string; body: string; play: () => Promise<boolean> }>; progress: CourseProgress; dispatch: Dispatch<CourseAction>; audio: SessionAudio }) {
  const record = progress.sessions[String(session)]
  const description = session === 2
    ? 'Learn the three words in order. Each one explains the next.'
    : 'Try each comparison. The words arrive after the sound.'
  return <><Heading session={session} eyebrow="Hear · notice · name" title={sessionGoal(session)} description={description} /><div className="learning-card-grid">{items.map((item, index) => { const done = record.learned.includes(item.key); return <article className={`panel learning-action-card ${done ? 'is-complete' : ''}`} key={item.key}><span>{index + 1}</span><h2>{item.title}</h2><p>{item.body}</p><button type="button" className="button button--quiet" onClick={() => { void item.play().then((played) => { if (played) dispatch({ type: 'MARK', session, area: 'learned', key: item.key }) }) }}><Icon name={done ? 'check' : 'play'} /> {done ? 'Hear again' : 'Try it'}</button></article> })}</div><div className="page-actions"><button type="button" className="button button--primary" disabled={!learnComplete(progress, session)} onClick={() => dispatch({ type: 'GO_MAKE', session })}>Make something <Icon name="arrow" /></button></div></>
}

function GridLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'heard-accent', title: '1. Beat = one pulse', body: 'The steady clicks are beats. They give music a pace you can follow.', play: () => props.audio.playMetronome() },
  { key: 'counted-four', title: '2. Four beats = one bar', body: 'Count 1, 2, 3, 4. The stronger beat 1 tells you a new bar has started.', play: () => props.audio.playMetronome() },
  { key: 'used-transport', title: '3. Grid = time drawn', body: 'In a DAW, vertical grid lines show the same beats. Play moves a cursor through them; Stop pauses it.', play: () => props.audio.trigger(72, .35) },
]} /> }
function HarmonyLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'heard-progression', title: 'Hear movement', body: 'Am begins at home; F, C, and G move the feeling forward.', play: () => props.audio.playChord(chordNotes.Am, 1.1) },
  { key: 'heard-triads', title: 'Three-note shapes', body: 'Each chord combines a root, third, and fifth from the scale.', play: () => props.audio.playChord(chordNotes.F, 1.1) },
  { key: 'named-movement', title: 'Name the feeling', body: 'Mood words describe your hearing; there is no correct taste.', play: () => props.audio.playChord(chordNotes.G, 1.1) },
]} /> }
function ShapeLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'read-piano-roll', title: 'Pitch goes up', body: 'The Piano Roll shows pitch vertically and time horizontally.', play: () => props.audio.trigger(57, .35) },
  { key: 'heard-snap', title: 'Snap aligns time', body: 'Snap moves a note to the grid; it does not choose the music.', play: () => props.audio.playMetronome() },
  { key: 'understood-duration', title: 'Length holds sound', body: 'A one-bar chord begins on the bar line and lasts four beats.', play: () => props.audio.playChord(chordNotes.Am, 1.5) },
]} /> }
function PhraseLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'heard-motifs', title: 'A small idea', body: 'A motif is a short shape the listener can recognise.', play: async () => (await Promise.all([props.audio.trigger(69, .3), props.audio.trigger(72, .6)])).every(Boolean) },
  { key: 'heard-chord-tones', title: 'Stable beginnings', body: 'Starting a bar on its chord tone usually feels settled.', play: () => props.audio.playChord([69, 72, 76], 1) },
  { key: 'chose-entry', title: 'Play or draw', body: 'Both entry methods create the same MIDI notes. This prototype uses the grid.', play: () => props.audio.trigger(76, .5) },
]} /> }
function VariationLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'compared-halves', title: 'A then A′', body: 'The second half begins recognisably, then changes.', play: () => props.audio.trigger(69, .45) },
  { key: 'heard-variation', title: 'Change one property', body: 'Keep the motif recognisable, then change pitch, rhythm, note length, or space on purpose.', play: () => props.audio.trigger(72, .7) },
  { key: 'heard-resolution', title: 'Let the ending rest', body: 'A, C, or E connects the final melody note to A minor.', play: () => props.audio.playChord(chordNotes.Am, 1.1) },
]} /> }
function ExpressionLearn(props: GuidedSessionPageProps) { return <LearningCards {...props} items={[
  { key: 'heard-velocity', title: 'Velocity is touch', body: 'It changes how firmly a note speaks, not which note it is.', play: async () => (await Promise.all([props.audio.trigger(69, .35, .35), props.audio.trigger(72, .35, .9)])).every(Boolean) },
  { key: 'introduced-space-control', title: 'Reverb is space', body: 'The control is introduced here; a true wet/dry audio comparison is still a planned engine upgrade.', play: () => props.audio.playChord(chordNotes.Am, 1.2) },
  { key: 'read-safe-range', title: 'Use a safe starting range', body: 'NADI can verify the controls are in a conservative range; a real peak meter is still required before claiming no clipping.', play: () => props.audio.playChord(chordNotes.C, .8) },
]} /> }

function Make(props: GuidedSessionPageProps) {
  switch (props.session) {
    case 2: return <GridMake {...props} />
    case 4: return <HarmonyMake {...props} />
    case 5: return <ShapeMake {...props} />
    case 6: return <PhraseMake {...props} />
    case 7: return <VariationMake {...props} />
    case 8: return <ExpressionMake {...props} />
  }
}

function GoCheck({ props }: { props: GuidedSessionPageProps }) { return <div className="page-actions"><button type="button" className="button button--primary" disabled={!makeComplete(props.progress, props.session)} onClick={() => props.dispatch({ type: 'GO_CHECK', session: props.session })}>Studio Check <Icon name="arrow" /></button></div> }

function GridMake(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['2']; const taps = valueNumber(record.values.pulseTaps)
  const tap = () => { void props.audio.trigger(taps % 4 === 0 ? 84 : 79, .1, taps % 4 === 0 ? .9 : .6); props.dispatch({ type: 'INCREMENT', session: 2, key: 'pulseTaps', max: 8 }); if (taps + 1 >= 8) props.dispatch({ type: 'MARK', session: 2, area: 'made', key: 'tapped-pulse' }) }
  const heard = record.made.includes('heard-two-bars')
  const identified = record.values.barStartChoice === 'beat-5'
  return <><Heading session={2} eyebrow="Make · two visible bars" title="Follow eight beats across two bars" description="First hear the count. Then tap once per beat and find where bar 2 begins." /><div className="pulse-workbench panel">
    <div className="grid-task-steps" aria-label="Session 2 activity steps"><span className={heard ? 'is-complete' : ''}>1 · Hear</span><span className={taps >= 8 ? 'is-complete' : ''}>2 · Tap 8 beats</span><span className={identified ? 'is-complete' : ''}>3 · Find bar 2</span></div>
    <button type="button" className="button button--quiet grid-hear-button" onClick={() => { void props.audio.playMetronome(2).then((completed) => { if (completed) props.dispatch({ type: 'MARK', session: 2, area: 'made', key: 'heard-two-bars' }) }) }}><Icon name={heard ? 'check' : 'play'} /> {heard ? 'Hear the two bars again' : 'Step 1 · Hear two bars'}</button>
    <div className="bar-ruler" aria-hidden="true"><span>BAR 1</span><span>BAR 2</span></div>
    <div className="beat-strip beat-strip--two-bars">{Array.from({ length: 8 }, (_, i) => <span key={i} className={`${i < taps ? 'is-hit' : ''} ${i === 0 || i === 4 ? 'is-bar-start' : ''}`}><small>{i === 0 || i === 4 ? 'START' : 'BEAT'}</small><strong>{i % 4 + 1}</strong></span>)}</div>
    <p className="grid-explanation"><strong>Read the grid:</strong> the numbers restart after four beats. The gold <b>1</b> begins a new bar.</p>
    <button type="button" className="pulse-pad" disabled={!heard || taps >= 8} onClick={tap}>Optional motor practice · Tap<small>{taps}/8 beats</small></button>
    <small className="timing-disclaimer">Tap along if useful. Motor timing is feedback only and does not unlock the understanding check.</small>
    {heard && <div className="bar-start-question"><strong>What does the fifth tile mean?</strong><div><button type="button" onClick={() => props.dispatch({ type: 'SET_VALUE', session: 2, key: 'barStartChoice', value: 'wrong' })}>Beat 5 of bar 1</button><button type="button" className={identified ? 'is-correct' : ''} onClick={() => { props.dispatch({ type: 'SET_VALUE', session: 2, key: 'barStartChoice', value: 'beat-5' }); props.dispatch({ type: 'MARK', session: 2, area: 'made', key: 'identified-next-bar' }) }}>Beat 1 of bar 2</button></div>{record.values.barStartChoice === 'wrong' && <p role="status">Look at the divider: after beat 4, the count restarts at 1 because bar 2 begins.</p>}{identified && <p role="status">Exactly—four beats completed bar 1, so the next beat is beat 1 of bar 2.</p>}</div>}
  </div><GoCheck props={props} /></>
}

function HarmonyMake(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['4']
  return <><Heading session={4} eyebrow="Make · chord shapes" title="Build the rest of the progression" description="Hear each chord, then choose one honest mood word." /><div className="chord-build-grid">{(['F', 'C', 'G'] as const).map((chord) => { const key = `built-${chord.toLowerCase()}`; const done = record.made.includes(key); return <button type="button" className={`chord-build-card panel ${done ? 'is-complete' : ''}`} key={chord} onClick={() => { void props.audio.playChord(chordNotes[chord], 1.1); props.dispatch({ type: 'MARK', session: 4, area: 'made', key }) }}><span>{done ? <Icon name="check" /> : chord}</span><strong>{chord} {chord === 'F' || chord === 'C' || chord === 'G' ? 'major' : ''}</strong><small>{chordNotes[chord].map((note) => noteName(note)).join(' · ')}</small></button> })}</div><div className="mood-choice panel"><span>What does the movement feel like?</span>{['reflective', 'hopeful', 'unsettled'].map((mood) => <button type="button" key={mood} className={record.values.mood === mood ? 'is-active' : ''} onClick={() => { props.dispatch({ type: 'SET_VALUE', session: 4, key: 'mood', value: mood }); props.dispatch({ type: 'MARK', session: 4, area: 'made', key: 'chose-mood' }) }}>{mood}</button>)}</div><GoCheck props={props} /></>
}

function ShapeMake(props: GuidedSessionPageProps) {
  return <><Heading session={5} eyebrow="Make · Playlist" title="Place eight one-bar chords" description="Build the eight-bar harmony, then perform real duplicate, move, resize, undo, and fresh repair edits on canonical clips." /><ChordTimeline progress={props.progress} setChord={(bar, chord) => { props.dispatch({ type: 'SET_CHORD', bar, chord }); void props.audio.playChord(chordNotes[chord], .55) }} /><ClipEditLab progress={props.progress} dispatch={props.dispatch} /><button type="button" className="button button--quiet audition-pattern" onClick={() => { void props.audio.playProject(props.progress.project).then((receipt) => { if (receipt) props.dispatch({ type: 'CONFIRM_PROJECT_PLAYBACK', session: 5, receipt, currentAudioEpoch: props.audio.currentAudioEpoch() }) }) }}><Icon name="play" /> Audition full eight-bar arrangement</button><GoCheck props={props} /></>
}

function ClipEditLab({ progress, dispatch }: { progress: CourseProgress; dispatch: Dispatch<CourseAction> }) {
  const record = progress.sessions['5']
  const attempt = record.learning?.current
  const value = (key: string) => valueText(record.values[key])
  const expected = () => currentProjectReference(progress)
  const apply = (edit: Extract<CourseAction, { type: 'APPLY_PROJECT_EDIT' }>['edit'], label: string, evidenceKey: string) => {
    const commandId = `command-${progress.history.nextCommandId}`
    dispatch({ type: 'APPLY_PROJECT_EDIT', edit, expectedProject: expected(), label })
    dispatch({ type: 'SET_VALUE', session: 5, key: evidenceKey, value: commandId })
  }
  const duplicateId = attempt ? `practice-${attempt.id.replace(/[^A-Za-z0-9._:-]/g, '').slice(-50)}` : 'practice-clip'
  const duplicateCommand = value('s5DuplicateCommand')
  const moveCommand = value('s5MoveCommand')
  const resizeCommand = value('s5ResizeCommand')
  const undoJson = value('s5UndoCommand')
  const challengeCommand = value('s5ChallengeCommand')
  const repairCommand = value('s5RepairCommand')
  const repairDestination = typeof record.values.s5RepairDestination === 'number' ? record.values.s5RepairDestination : -1
  const practiceClip = progress.project.content.clips.find((clip) => clip.id === duplicateId)
  const challengeClip = progress.project.content.clips.find((clip) => clip.id === 'clip-chord-8')
  const undoResize = () => {
    const command = progress.history.past.at(-1)
    if (!command || command.id !== resizeCommand) return
    dispatch({ type: 'UNDO_PROJECT' })
    dispatch({ type: 'SET_VALUE', session: 5, key: 's5UndoCommand', value: JSON.stringify(command) })
  }
  return <section className="clip-edit-lab panel">
    <div><div className="eyebrow teal">Canonical clip edit lab</div><p>The playlist lane organizes clips; the pattern keeps its channel routing. Duplicate shares its pattern until Make Unique is explicitly chosen.</p></div>
    <div className="clip-edit-lane">{Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}{practiceClip && <i style={{ gridColumn: `${Math.floor(practiceClip.startTick / 1_920) + 1} / span ${Math.max(1, Math.ceil(practiceClip.lengthTicks / 1_920))}` }}>PRACTICE</i>}{challengeClip && <i style={{ gridColumn: `${Math.floor(challengeClip.startTick / 1_920) + 1}` }}>REPAIR</i>}</div>
    <div className="edit-operation-row"><button type="button" disabled={Boolean(duplicateCommand) || !progress.project.content.clips.some((clip) => clip.id === 'clip-chord-1')} onClick={() => apply({ type: 'duplicate-clip', sourceClipId: 'clip-chord-1', newClipId: duplicateId, startTick: 3_840 }, 'Duplicate practice clip', 's5DuplicateCommand')}>1 · Duplicate shared clip</button><button type="button" disabled={!duplicateCommand || Boolean(moveCommand)} onClick={() => apply({ type: 'move-clip', clipId: duplicateId, startTick: 4_800 }, 'Move practice clip', 's5MoveCommand')}>2 · Move clip</button><button type="button" disabled={!moveCommand || Boolean(resizeCommand)} onClick={() => apply({ type: 'resize-clip', clipId: duplicateId, lengthTicks: 960 }, 'Resize practice clip', 's5ResizeCommand')}>3 · Resize clip</button><button type="button" disabled={!resizeCommand || Boolean(undoJson)} onClick={undoResize}>4 · Undo resize</button></div>
    <div className="edit-operation-row"><button type="button" disabled={!undoJson || Boolean(challengeCommand)} onClick={() => apply({ type: 'move-clip', clipId: 'clip-chord-8', startTick: 12_960 }, 'Create fresh displaced-clip challenge', 's5ChallengeCommand')}>Start fresh displaced-clip challenge</button><label>Destination<select value={repairDestination} disabled={!challengeCommand} onChange={(event) => dispatch({ type: 'SET_VALUE', session: 5, key: 's5RepairDestination', value: Number(event.target.value) })}><option value={-1}>Choose…</option><option value={9_600}>Bar 6</option><option value={11_520}>Bar 7</option><option value={13_440}>Bar 8</option></select></label><button type="button" disabled={!challengeCommand || repairDestination < 0 || challengeClip?.startTick !== 12_960} onClick={() => apply({ type: 'move-clip', clipId: 'clip-chord-8', startTick: repairDestination }, 'Apply displaced clip repair', 's5RepairCommand')}>Apply repair</button>{challengeCommand && challengeClip?.startTick !== 12_960 && challengeClip?.startTick !== 13_440 && <button type="button" onClick={() => apply({ type: 'move-clip', clipId: 'clip-chord-8', startTick: 12_960 }, 'Retry displaced clip challenge', 's5RetryCommand')}>Return to challenge and retry</button>}</div>
    <p>{repairCommand && challengeClip?.startTick === 13_440 ? 'Fresh repair recorded. Audition the full arrangement before the Studio Check.' : challengeCommand ? 'Choose where the displaced clip belongs. A wrong destination can be returned to the challenge position and retried.' : 'The repair begins only after the deliberate displacement is visible.'}</p>
  </section>
}

function ChordTimeline({ progress, setChord }: { progress: CourseProgress; setChord: (bar: number, chord: string) => void }) {
  return <div className="chord-timeline panel"><div className="chord-timeline__ruler">{expectedChords.map((_, index) => <span key={index}>BAR {index + 1}</span>)}</div><div className="chord-timeline__clips">{expectedChords.map((expected, index) => <div key={index} className={progress.project.chords[index] === expected ? 'is-correct' : ''}><strong>{progress.project.chords[index] || '—'}</strong><div>{Object.keys(chordNotes).map((chord) => <button type="button" key={chord} onClick={() => setChord(index, chord)} aria-label={`Set bar ${index + 1} to ${chord}`}>{chord}</button>)}</div></div>)}</div></div>
}

function PhraseMake(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['6']; const ready = melodyAValid(props.progress.project)
  const hasHarmony = expectedChords.every((chord, index) => props.progress.project.chords[index] === chord)
  return <><Heading session={6} eyebrow="Make · your melody" title="Write four bars that belong to you" description="Create a phrase with chord tones and intentional space, then compare it and choose Keep or Revise." />{!hasHarmony ? <Prerequisite title="The harmony is not ready" body="Session 5 records the eight chord bars that your melody will answer." onClick={() => props.navigate('session-5')} /> : <><MelodyEditor half="A" progress={props.progress} dispatch={props.dispatch} audio={props.audio} recordingScope={props.recordingScope} onToggleRawTake={props.onToggleRawTake} /><div className="phrase-actions panel"><button type="button" className="button button--quiet" disabled={!ready} onClick={() => { void props.audio.playProjectSection(props.progress.project, 0, 4).then((receipt) => { if (receipt) props.dispatch({ type: 'CONFIRM_PROJECT_PLAYBACK', session: 6, receipt, currentAudioEpoch: props.audio.currentAudioEpoch() }) }) }}><Icon name="play" /> Listen to bars 1–4</button><label>What intention or use of space did you choose?<input value={valueText(record.values.reflection)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 6, key: 'reflection', value: event.target.value })} placeholder="The pause in bar 3…" /></label><div><button type="button" className="button button--quiet" onClick={() => props.dispatch({ type: 'SET_VALUE', session: 6, key: 'comparisonChoice', value: 'keep' })}>Keep</button><button type="button" className="button button--quiet" onClick={() => props.dispatch({ type: 'SET_VALUE', session: 6, key: 'comparisonChoice', value: 'revise' })}>Revise</button></div><span>{record.values.playedBack ? `Comparison heard. Choice: ${valueText(record.values.comparisonChoice) || 'not chosen'}.` : 'Listen after the phrase is ready, then choose.'}</span></div></>}<GoCheck props={props} /></>
}

function VariationMake(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['7']; const hasPhrase = melodyAValid(props.progress.project)
  const hasVariation = props.progress.project.melodyEvents.some((event) => event.patternId === 'melody-b')
  const hasDuplicated = record.made.includes('duplicated-phrase') || record.values.legacyVariationImported === true
  return <><Heading session={7} eyebrow="Make · A + A′" title="Keep the idea, change the answer" description="Duplicate your phrase, make A′ unique, then make one intentional audible change and identify it." />{!hasPhrase ? <Prerequisite title="A four-bar phrase is needed" body="Session 6 saves the melody that this lesson varies." onClick={() => props.navigate('session-6')} /> : <><button type="button" className="button button--quiet duplicate-button" disabled={hasDuplicated} onClick={() => props.dispatch({ type: 'DUPLICATE_MELODY' })}><Icon name="projects" /> {hasDuplicated ? 'Bars 5–8 duplicated' : hasVariation ? 'Replace draft with A copy' : 'Duplicate bars 1–4'}</button>{hasDuplicated && <><button type="button" className="button button--quiet duplicate-button" disabled={props.progress.project.content.clips.find((clip) => clip.id === 'clip-melody-b')?.patternId !== props.progress.project.content.clips.find((clip) => clip.id === 'clip-melody-a')?.patternId} onClick={() => props.dispatch({ type: 'MAKE_UNIQUE_CLIP', clipId: 'clip-melody-b' })}>Make A′ unique before editing</button><MelodyEditor half="B" progress={props.progress} dispatch={props.dispatch} audio={props.audio} recordingScope={props.recordingScope} onToggleRawTake={props.onToggleRawTake} /></>}<div className="phrase-actions panel"><label>What audible property did you change?<select value={valueText(record.values.identifiedProperty)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 7, key: 'identifiedProperty', value: event.target.value })}><option value="">Choose…</option><option value="pitch">Pitch</option><option value="rhythm">Rhythm</option><option value="duration">Duration</option><option value="velocity">Velocity</option><option value="space">Space</option></select></label><label>Describe your intention (recorded for review)<input value={valueText(record.values.intention)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 7, key: 'intention', value: event.target.value })} placeholder="I changed one pitch to lift the answer" /></label><button type="button" className="button button--quiet" disabled={!melodyBValid(props.progress.project)} onClick={() => { void props.audio.playProjectSection(props.progress.project, 0, 8).then((receipt) => { if (receipt) props.dispatch({ type: 'CONFIRM_PROJECT_PLAYBACK', session: 7, receipt, currentAudioEpoch: props.audio.currentAudioEpoch() }) }) }}><Icon name="play" /> {record.values.reviewedArrangement ? 'Review all 8 bars again' : 'Review all 8 bars'}</button></div></>}<GoCheck props={props} /></>
}

function MelodyEditor({ half, progress, dispatch, audio, recordingScope, onToggleRawTake }: { half: 'A' | 'B'; progress: CourseProgress; dispatch: Dispatch<CourseAction>; audio: SessionAudio; recordingScope?: string; onToggleRawTake: (scope: string) => void }) {
  const session = half === 'A' ? 6 : 7
  return <div className="melody-editor">{Array.from({ length: 4 }, (_, index) => {
    const projectBar = half === 'A' ? index : index + 4
    const barEvents = eventsForBar(progress.project.melodyEvents, projectBar)
    const chord = expectedChords[projectBar]
    const tones = chordNotes[chord].map(noteName)
    const overlaps = hasOverlappingEvents(barEvents)
    const scope = `session-${session}-bar-${projectBar + 1}`
    const isRecording = recordingScope === scope
    return <article className={`melody-bar panel ${isRecording ? 'is-recording' : ''}`} key={projectBar} aria-label={`Bar ${projectBar + 1}, ${chord}`}>
      <div><span>BAR {projectBar + 1}</span><strong>{chord}</strong></div>
      <button type="button" className="record-bar" aria-pressed={isRecording} onClick={() => { dispatch({ type: 'SET_VALUE', session, key: 'activeBar', value: index }); onToggleRawTake(scope) }}>{isRecording ? 'Stop & keep raw take' : 'Record raw take'}</button>
      <div className="melody-event-list">{barEvents.length
        ? barEvents.map((event) => <MelodyEventRow key={event.id} event={event} half={half} bar={index} dispatch={dispatch} audio={audio} />)
        : <em>intentional space</em>}
      </div>
      {overlaps && <div className="event-warning" role="status"><Icon name="help" /> Shorten or move an overlapping note.</div>}
      <div className="note-palette" aria-label={`Add a note to bar ${projectBar + 1}`}>{scaleNotes.map((note) => <button type="button" key={note} disabled={barEvents.length >= 6} className={barEvents.length === 0 && tones.includes(note) ? 'is-chord-tone' : ''} aria-label={`Add ${note} to bar ${projectBar + 1}`} onClick={() => { dispatch({ type: 'ADD_MELODY_NOTE', half, bar: index, note }); void audio.trigger(noteMidi(note), .28) }}>{note}</button>)}</div>
      <small className="step-entry-note">Eighth-note snap · timing and length are editable below each note.</small>
    </article>
  })}</div>
}

function MelodyEventRow({ event, half, bar, dispatch, audio }: { event: MelodyNoteEvent; half: 'A' | 'B'; bar: number; dispatch: Dispatch<CourseAction>; audio: SessionAudio }) {
  const globalBar = half === 'A' ? bar : bar + 4
  const barStart = globalBar * TICKS_PER_BAR
  const startOptions = Array.from({ length: 8 }, (_, index) => barStart + index * EIGHTH_NOTE_TICKS)
    .filter((tick) => tick + event.durationTicks <= barStart + TICKS_PER_BAR)
  const currentStartIsSnapped = startOptions.includes(event.startTick)
  const durationOptions = melodyDurationChoices.filter((ticks) => event.startTick + ticks <= barStart + TICKS_PER_BAR)
  const currentDurationIsPreset = durationOptions.includes(event.durationTicks as (typeof melodyDurationChoices)[number])
  return <div className="melody-event-row">
    <select aria-label={`Pitch for note in bar ${globalBar + 1} at beat ${beatLabelFromTick(event.startTick)}`} value={eventNoteName(event.pitch)} onChange={(change) => { dispatch({ type: 'SET_MELODY_PITCH', half, eventId: event.id, note: change.target.value }); void audio.trigger(midiForNoteNameNear(change.target.value, event.pitch), .28) }}>
      {scaleNotes.map((note) => <option value={note} key={note}>{note}</option>)}
    </select>
    <label><span>Start</span><select aria-label={`Start time for ${eventNoteName(event.pitch)} in bar ${globalBar + 1}`} value={event.startTick} onChange={(change) => dispatch({ type: 'SET_MELODY_TIMING', half, eventId: event.id, startTick: Number(change.target.value) })}>
      {!currentStartIsSnapped && <option value={event.startTick}>Inferred · {beatLabelFromTick(event.startTick)}</option>}
      {startOptions.map((tick) => <option value={tick} key={tick}>{beatLabelFromTick(tick)}</option>)}
    </select></label>
    <label><span>Length</span><select aria-label={`Duration for ${eventNoteName(event.pitch)} in bar ${globalBar + 1}`} value={event.durationTicks} onChange={(change) => dispatch({ type: 'SET_MELODY_TIMING', half, eventId: event.id, durationTicks: Number(change.target.value) })}>
      {!currentDurationIsPreset && <option value={event.durationTicks}>Inferred · {durationLabel(event.durationTicks)}</option>}
      {durationOptions.map((ticks) => <option value={ticks} key={ticks}>{durationLabel(ticks)}</option>)}
    </select></label>
    <button type="button" className="remove-event" aria-label={`Delete ${eventNoteName(event.pitch)} from bar ${globalBar + 1} beat ${beatLabelFromTick(event.startTick)}`} onClick={() => dispatch({ type: 'REMOVE_MELODY_NOTE', half, bar, eventId: event.id })}>×</button>
  </div>
}

function ExpressionMake(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['8']
  const [playing, setPlaying] = useState(false)
  const projectReady = expectedChords.every((chord, i) => props.progress.project.chords[i] === chord) && melodyAValid(props.progress.project) && melodyBValid(props.progress.project)
  const safeRange = mixWithinBeginnerRange(props.progress.project)
  const melodyEvents = props.progress.project.melodyEvents
  const playThrough = async () => {
    setPlaying(true)
    const completed = await props.audio.playProject(props.progress.project)
    setPlaying(false)
    if (completed) {
      props.dispatch({ type: 'CONFIRM_PROJECT_PLAYBACK', session: 8, receipt: completed, currentAudioEpoch: props.audio.currentAudioEpoch() })
    }
  }
  return <><Heading session={8} eyebrow="Make · mix and expression" title="Shape the finished track" description="Change touch on real notes, keep both lanes audible, add restrained space, then play the whole project once." />{!projectReady ? <Prerequisite title="The eight-bar arrangement is not ready" body="Complete Shape the Chords, Write a Phrase, and Repeat with Meaning first." onClick={() => props.navigate('session-5')} /> : <div className="expression-console"><section className="panel velocity-panel"><div className="eyebrow">Per-note melody velocity</div><div className="velocity-event-grid">{melodyEvents.map((event) => <label key={event.id}><span>Bar {Math.floor(event.startTick / TICKS_PER_BAR) + 1} · {eventNoteName(event.pitch)} · {beatLabelFromTick(event.startTick)}</span><input aria-label={`Velocity for ${eventNoteName(event.pitch)} in bar ${Math.floor(event.startTick / TICKS_PER_BAR) + 1} at beat ${beatLabelFromTick(event.startTick)}`} type="range" min="30" max="110" value={event.velocity} onChange={(change) => props.dispatch({ type: 'SET_EVENT_VELOCITY', eventId: event.id, value: Number(change.target.value) })} /><output>{event.velocity}</output></label>)}</div></section><section className="panel mixer-panel"><div className="eyebrow">Beginner-linked mixer</div><Range label="Chords" value={props.progress.project.chordLevel} max={100} onChange={(value) => props.dispatch({ type: 'SET_MIX', key: 'chordLevel', value })} /><Range label="Melody" value={props.progress.project.melodyLevel} max={100} onChange={(value) => props.dispatch({ type: 'SET_MIX', key: 'melodyLevel', value })} /><Range label="Reverb" value={props.progress.project.reverb} max={40} suffix="%" onChange={(value) => props.dispatch({ type: 'SET_MIX', key: 'reverb', value })} /><div className={`mix-range-status ${safeRange ? 'is-safe' : ''}`} role="status"><Icon name={safeRange ? 'check' : 'help'} /><span>{safeRange ? 'Controls are in the green beginner range.' : 'Keep both lanes at 35–90, their total at 165 or less, and reverb at 8–20%.'}</span></div><button type="button" className="button button--primary" disabled={playing} onClick={() => void playThrough()}><Icon name={playing ? 'stop' : 'play'} /> {playing ? 'Playing all 8 bars…' : record.values.fullPlayback ? 'Play full track again' : 'Play full 8-bar check'}</button></section></div>}<div className="reflection-pair panel"><label>Velocity changed…<input value={valueText(record.values.velocityReflection)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 8, key: 'velocityReflection', value: event.target.value })} placeholder="how firmly the notes speak" /></label><label>My bars 5–8 changed…<input value={valueText(record.values.variationReflection)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 8, key: 'variationReflection', value: event.target.value })} placeholder="the ending by…" /></label></div><GoCheck props={props} /></>
}

function Range({ label, value, max, suffix = '', onChange }: { label: string; value: number; max: number; suffix?: string; onChange: (value: number) => void }) { return <label className="mixer-range"><span>{label}</span><input type="range" min="0" max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output>{value}{suffix}</output></label> }
function Prerequisite({ title, body, onClick }: { title: string; body: string; onClick: () => void }) { return <div className="prerequisite-card panel panel--gold"><Icon name="help" /><div><h2>{title}</h2><p>{body}</p></div><button type="button" className="button button--primary" onClick={onClick}>Open earlier session</button></div> }

function Check(props: GuidedSessionPageProps) {
  const record = props.progress.sessions[String(props.session)]
  return <><Heading session={props.session} eyebrow="Studio Check · less help" title={checkTitle(props.session)} description="No timer and no percentage. Demonstrate the idea once without the teaching overlay." />
    {props.session === 2 && <GridCheck {...props} />}
    {props.session === 4 && <HarmonyCheck {...props} />}
    {props.session === 5 && <Session5CheckPanel {...props} />}
    {props.session === 6 && <StartToneCheck {...props} />}
    {props.session === 7 && <ChoiceCheck session={7} questions={[['What makes A′ different?', 'identified-change', 'An intentional change'], ['Which ending connects to A minor?', 'resolved-ending', 'A, C, or E']]} record={record} dispatch={props.dispatch} />}
    {props.session === 8 && <ChoiceCheck session={8} questions={[["Velocity changes…", "velocity-is-touch", "Touch, not pitch"], ["Reverb changes…", "reverb-is-space", "The sense of space"], ["A safe starting mix…", "meter-is-safe", "Keeps both lanes audible inside the green range"]]} record={record} dispatch={props.dispatch} />}
    <div className="page-actions"><button type="button" className="button button--primary" disabled={!canFinalizeGuidedSession(props.progress, props.session)} onClick={() => props.dispatch({ type: 'FINALIZE', session: props.session })}>Save evidence <Icon name="arrow" /></button></div></>
}

function checkTitle(session: GuidedSessionId) { return ({ 2: 'Count and control one bar', 4: 'Rebuild F, C, and G', 5: 'Read the Piano Roll', 6: 'Choose stable starting tones', 7: 'Explain the variation', 8: 'Explain the mix choices' } as const)[session] }

function GridCheck(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['2']
  const attempt = record.learning?.current
  const ticks = valueNumbers(record.values.freshBeatTicks)
  const tapTimes = valueNumbers(record.values.freshTapTimes)
  const explanation = valueText(record.values.freshDownbeatExplanation)
  const selectedTick = typeof record.values.selectedFreshBeatTick === 'number' ? record.values.selectedFreshBeatTick : -1
  const accentTick = typeof record.values.freshAccentTick === 'number' ? record.values.freshAccentTick : -1
  const availableTicks = [0, 240, 480, 720, 960, 1_200, 1_440, 1_680]
  const [auditionReceipt, setAuditionReceipt] = useState<AuditionCompletionReceipt>()
  const beats = ticks.map((startTick, order) => ({ order, pitch: 60, source: 'screen' as const, learnerAuthored: true as const, startTick, velocity: startTick === accentTick ? 110 : 70 }))
  const validAuditionReceipt = Boolean(attempt && auditionReceipt && auditionReceipt.artifact.kind === 'artifact' && auditionReceipt.artifact.attemptId === attempt.id && auditionReceipt.artifact.generation === attempt.generation && auditionReceipt.artifact.fingerprint === session2ArtifactFingerprint(beats) && props.audio.validateAuditionReceiptAgainstCurrentAudio(auditionReceipt))
  const toggleBeat = () => {
    if (selectedTick < 0) return
    setAuditionReceipt(undefined)
    props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshBeatTicks', value: ticks.includes(selectedTick) ? ticks.filter((tick) => tick !== selectedTick) : [...ticks, selectedTick].sort((a, b) => a - b) })
  }
  const submit = () => {
    if (!attempt || ticks.length !== 4 || !auditionReceipt || !validAuditionReceipt) return
    props.dispatch({ type: 'SUBMIT_GUIDED_CHECK', session: 2, artifact: { session: 2, check: {
      attemptId: attempt.id,
      generation: attempt.generation,
      tapTimesMs: tapTimes,
      chosenDownbeat: (accentTick / 480 + 1) as 1 | 2 | 3 | 4,
      freshBar: {
        explainedDownbeat: explanation,
        beats,
        audition: { receipt: auditionReceipt, currentAudioEpochAtValidation: props.audio.currentAudioEpoch() },
      },
    } } })
  }
  const audition = async () => {
    if (!attempt || beats.length !== 4 || accentTick < 0) return
    const secondsPerTick = (60 / 90) / 480
    const receipt = await props.audio.playAuditionArtifact({ notes: beats.map((beat) => ({ note: beat.pitch, at: beat.startTick! * secondsPerTick, duration: .1, velocity: beat.velocity! / 127 })), bpm: 90, attemptId: attempt.id, generation: attempt.generation, fingerprint: session2ArtifactFingerprint(beats), lengthTicks: 1_920 })
    setAuditionReceipt(receipt && props.audio.validateAuditionReceiptAgainstCurrentAudio(receipt) ? receipt : undefined)
  }
  return <div className="studio-check-card panel"><h2>Build a fresh 4/4 bar</h2><p>The timeline starts blank. Choose positions, add or remove four events, then choose the accent. Off-grid choices can be repaired before submitting.</p><div className="beat-strip beat-strip--check">{availableTicks.map((tick, index) => <span key={tick} className={ticks.includes(tick) ? 'is-hit' : ''}><small>{index + 1}</small><strong>{ticks.includes(tick) ? (tick === accentTick ? '◆' : '●') : '○'}</strong></span>)}</div><div className="button-row"><label>Position<select value={selectedTick} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 2, key: 'selectedFreshBeatTick', value: Number(event.target.value) })}><option value={-1}>Choose…</option>{availableTicks.map((tick, index) => <option key={tick} value={tick}>Slot {index + 1}</option>)}</select></label><button type="button" className="button button--quiet" disabled={selectedTick < 0 || (!ticks.includes(selectedTick) && ticks.length >= 4)} onClick={toggleBeat}>{ticks.includes(selectedTick) ? 'Remove event' : 'Add event'}</button><label>Accent<select value={accentTick} onChange={(event) => { setAuditionReceipt(undefined); props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshAccentTick', value: Number(event.target.value) }) }}><option value={-1}>Choose…</option>{ticks.map((tick) => <option key={tick} value={tick}>Placed event at slot {availableTicks.indexOf(tick) + 1}</option>)}</select></label></div><div className="button-row"><button type="button" className="pulse-pad" onClick={() => { props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshTapTimes', value: [...tapTimes, performance.now()].slice(-12) }); void props.audio.trigger(79, .1) }}>Tap pulse</button><button type="button" className="button button--quiet" disabled={!ticks.length && !tapTimes.length} onClick={() => { setAuditionReceipt(undefined); props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshBeatTicks', value: [] }); props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshTapTimes', value: [] }); props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshAccentTick', value: -1 }) }}>Clear</button></div>{tapTimes.length > 1 && <p>Motor feedback: {Math.round((tapTimes.at(-1)! - tapTimes[0]) / (tapTimes.length - 1))} ms average between taps. This is separate feedback, not a gate.</p>}<label>Explain your downbeat choice (recorded for review)<input value={explanation} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 2, key: 'freshDownbeatExplanation', value: event.target.value })} /></label><button type="button" className="button button--quiet" disabled={!attempt || beats.length !== 4 || accentTick < 0} onClick={() => void audition()}><Icon name="play" /> {validAuditionReceipt ? 'Audition completed' : 'Audition this rebuilt bar'}</button><button type="button" className="button button--primary" disabled={!attempt || attempt.stage !== 'independent-check' || !validAuditionReceipt || explanation.trim().length < 3} onClick={submit}>Submit fresh bar</button>{attempt?.stage === 'reflect' && <ReflectionCapture session={2} attempt={attempt} dispatch={props.dispatch} />}</div>
}

function HarmonyCheck(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['4']
  const attempt = record.learning?.current
  const targets = ['F', 'C', 'G'] as const
  const captureTargets = ['F', 'C', 'G', 'repair'] as const
  const keyFor = (target: typeof targets[number] | 'repair') => `captured-${target}`
  const captures = Object.fromEntries(captureTargets.map((target) => [target, valueNumbers(record.values[keyFor(target)]).slice(0, 3)])) as Record<typeof captureTargets[number], number[]>
  const current = targets.find((target) => captures[target].length < 3) ?? (captures.repair.length < 3 ? 'repair' : undefined)
  const selectedPitch = typeof record.values.capturePitch === 'number' ? record.values.capturePitch : -1
  const [auditionReceipt, setAuditionReceipt] = useState<AuditionCompletionReceipt>()
  const add = () => {
    if (!current || selectedPitch < 0) return
    setAuditionReceipt(undefined)
    props.dispatch({ type: 'SET_VALUE', session: 4, key: keyFor(current), value: [...captures[current], selectedPitch] })
    void props.audio.trigger(selectedPitch, .35)
  }
  const occurrence = (id: string, pitches: number[]) => ({ attemptId: `${attempt!.id}:${id}`, generation: attempt!.generation, occurrences: pitches.map((pitch, order) => ({ order, pitch, source: 'screen' as const, learnerAuthored: true as const })), support: highestSupportUsed(attempt!.support) })
  const draft = attempt ? {
    constructions: { F: occurrence('F', captures.F), C: occurrence('C', captures.C), G: occurrence('G', captures.G) },
    freshRepair: {
      ...occurrence('repair', captures.repair),
      target: 'G' as const,
      challengeOccurrences: [55, 59, 61].map((pitch, order) => ({ order, pitch, source: 'screen' as const, learnerAuthored: true as const })),
    },
  } : undefined
  const validAuditionReceipt = Boolean(attempt && draft && auditionReceipt && auditionReceipt.artifact.kind === 'artifact' && auditionReceipt.artifact.attemptId === attempt.id && auditionReceipt.artifact.generation === attempt.generation && auditionReceipt.artifact.fingerprint === session4ArtifactFingerprint(draft) && props.audio.validateAuditionReceiptAgainstCurrentAudio(auditionReceipt))
  const submit = () => {
    if (!attempt || !draft || !auditionReceipt || !validAuditionReceipt) return
    props.dispatch({ type: 'SUBMIT_GUIDED_CHECK', session: 4, artifact: { session: 4, check: {
      ...draft,
      moodContext: valueText(record.values.harmonyMoodContext),
      explanation: valueText(record.values.harmonyExplanation),
      audition: { receipt: auditionReceipt, currentAudioEpochAtValidation: props.audio.currentAudioEpoch() },
    } } })
  }
  const audition = async () => {
    if (!attempt || !draft || current) return
    const groups = [draft.constructions.F, draft.constructions.C, draft.constructions.G, draft.freshRepair]
    const secondsPerBeat = 60 / 90
    const receipt = await props.audio.playAuditionArtifact({ notes: groups.flatMap((group, groupIndex) => group.occurrences.map((note) => ({ note: note.pitch, at: groupIndex * secondsPerBeat, duration: .5, velocity: .72 }))), bpm: 90, attemptId: attempt.id, generation: attempt.generation, fingerprint: session4ArtifactFingerprint(draft), lengthTicks: 1_920 })
    setAuditionReceipt(receipt && props.audio.validateAuditionReceiptAgainstCurrentAudio(receipt) ? receipt : undefined)
  }
  return <div className="studio-check-card panel"><h2>Capture F, C, and G as notes</h2><p>Build each three-note chord. Then repair the deliberately broken final shape G–B–C♯ without a chord-name answer button.</p><div className="check-sequence">{targets.map((target) => <span key={target}>{target}: {captures[target].map(noteName).join(' ') || 'blank'} {captures[target].length > 0 && <button type="button" onClick={() => { setAuditionReceipt(undefined); props.dispatch({ type: 'SET_VALUE', session: 4, key: keyFor(target), value: [] }) }}>Clear {target}</button>}</span>)}<span>Broken: G · B · C♯ → Repair: {captures.repair.map(noteName).join(' ') || 'blank'} {captures.repair.length > 0 && <button type="button" onClick={() => { setAuditionReceipt(undefined); props.dispatch({ type: 'SET_VALUE', session: 4, key: keyFor('repair'), value: [] }) }}>Clear repair</button>}</span></div>{current && <div className="button-row"><label>{current === 'repair' ? 'Replace the broken shape' : `Build ${current}`}<select value={selectedPitch} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 4, key: 'capturePitch', value: Number(event.target.value) })}><option value={-1}>Choose a note…</option>{[53, 55, 57, 59, 60, 62, 64, 67].map((pitch) => <option key={pitch} value={pitch}>{noteName(pitch)}</option>)}</select></label><button type="button" disabled={selectedPitch < 0 || captures[current].length >= 3} onClick={add}>Add note</button></div>}<label>Choose your mood context (recorded, not taste-graded)<input value={valueText(record.values.harmonyMoodContext)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 4, key: 'harmonyMoodContext', value: event.target.value })} /></label><label>Explain the construction choice (recorded for review)<input value={valueText(record.values.harmonyExplanation)} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 4, key: 'harmonyExplanation', value: event.target.value })} /></label><button type="button" className="button button--quiet" disabled={Boolean(current)} onClick={() => void audition()}><Icon name="play" /> {validAuditionReceipt ? 'Audition completed' : 'Audition captured chords'}</button><button type="button" className="button button--primary" disabled={!attempt || attempt.stage !== 'independent-check' || Boolean(current) || !validAuditionReceipt || valueText(record.values.harmonyMoodContext).trim().length < 3 || valueText(record.values.harmonyExplanation).trim().length < 3} onClick={submit}>Submit chord construction and repair</button>{attempt?.stage === 'reflect' && <ReflectionCapture session={4} attempt={attempt} dispatch={props.dispatch} />}</div>
}

function Session5CheckPanel(props: GuidedSessionPageProps) {
  const record = props.progress.sessions['5']
  const attempt = record.learning?.current
  const command = (key: string) => props.progress.history.past.find((item) => item.id === valueText(record.values[key]))
  const duplicate = command('s5DuplicateCommand')
  const move = command('s5MoveCommand')
  const challenge = command('s5ChallengeCommand')
  const repair = command('s5RepairCommand')
  const resize = parseProjectCommand(valueText(record.values.s5UndoCommand))
  const receipt = record.playbackReceipts?.filter((item) => item.projectId === props.progress.project.id && item.projectRevision === props.progress.project.revision && item.sequenceStartTick === 0 && item.sequenceEndTick === 15_360).at(-1)
  const explanation = valueText(record.values.s5Explanation)
  const clipOperation = (source: ProjectCommand | undefined, clipId: string) => {
    const before = source?.before.clips.find((clip) => clip.id === clipId)
    const after = source?.after.clips.find((clip) => clip.id === clipId)
    return source && before && after ? { commandId: source.id, clipId, beforeStartTick: before.startTick, afterStartTick: after.startTick, beforeLengthTicks: before.lengthTicks, afterLengthTicks: after.lengthTicks } : undefined
  }
  const practiceId = duplicate?.after.clips.find((clip) => clip.originClipId === 'clip-chord-1')?.id ?? ''
  const moveEvidence = clipOperation(move, practiceId)
  const resizeEvidence = clipOperation(resize, practiceId)
  const repairEvidence = clipOperation(repair, 'clip-chord-8')
  const ready = Boolean(attempt && duplicate && moveEvidence && resizeEvidence && challenge && repairEvidence && receipt && resize)
  const submit = () => {
    if (!attempt || !duplicate || !moveEvidence || !resizeEvidence || !challenge || !repairEvidence || !receipt || !resize) return
    const createdClip = duplicate.after.clips.find((clip) => !duplicate.before.clips.some((prior) => prior.id === clip.id))
    if (!createdClip) return
    props.dispatch({ type: 'SUBMIT_GUIDED_CHECK', session: 5, artifact: { session: 5, check: {
      attemptId: attempt.id, generation: attempt.generation, project: currentProjectReference(props.progress), move: moveEvidence, resize: resizeEvidence,
      duplicate: { commandId: duplicate.id, sourceClipId: 'clip-chord-1', createdClipId: createdClip.id },
      undo: { undoneCommand: resize, beforeUndoFingerprint: projectContentFingerprint(resize.after), afterUndoFingerprint: projectContentFingerprint(resize.before) },
      freshDisplacedClipRepair: { ...repairEvidence, attemptId: `${attempt.id}:repair`, generation: attempt.generation, challengeCommandId: challenge.id, challengeIntendedStartTick: 13_440 },
      explanation, audition: { receipt, currentAudioEpochAtValidation: receipt.audioEpoch },
    } } })
  }
  return <div className="studio-check-card panel"><h2>Verify the real clip edit and fresh repair</h2><p>This reads canonical before/after commands, not edit counters.</p><ul><li>Shared-pattern duplicate: {duplicate ? 'recorded' : 'missing'}</li><li>Move, resize, and undo: {moveEvidence && resizeEvidence ? 'recorded' : 'missing'}</li><li>Fresh displaced clip returned to bar 8: {challenge && repairEvidence ? 'recorded' : 'missing'}</li><li>Current eight-bar audition: {receipt ? 'completed' : 'missing'}</li></ul><label>Explain what move, resize, and undo changed (recorded for review)<input value={explanation} onChange={(event) => props.dispatch({ type: 'SET_VALUE', session: 5, key: 's5Explanation', value: event.target.value })} /></label><button type="button" className="button button--primary" disabled={!ready || attempt?.stage !== 'independent-check' || explanation.trim().length < 3} onClick={submit}>Submit arrangement repair</button>{attempt?.stage === 'reflect' && <ReflectionCapture session={5} attempt={attempt} dispatch={props.dispatch} />}</div>
}

function parseProjectCommand(value: string): ProjectCommand | undefined {
  if (!value || value.length > 200_000) return undefined
  try {
    const parsed = JSON.parse(value) as ProjectCommand
    return parsed && typeof parsed.id === 'string' && parsed.before && parsed.after ? parsed : undefined
  } catch {
    return undefined
  }
}

function ChoiceCheck({ session, questions, record, dispatch }: { session: GuidedSessionId; questions: Array<[string, string, string]>; record: CourseProgress['sessions'][string]; dispatch: Dispatch<CourseAction> }) {
  const [retry, setRetry] = useState<string>()
  return <><div className="choice-check-grid">{questions.map(([question, key, answer]) => <article className={`panel ${record.checked.includes(key) ? 'is-complete' : ''}`} key={key}><span>{record.checked.includes(key) ? <Icon name="check" /> : '?'}</span><h2>{question}</h2><button type="button" onClick={() => { setRetry(undefined); dispatch({ type: 'MARK', session, area: 'checked', key }) }}>{answer}</button><button type="button" onClick={() => setRetry(key)}>{wrongAnswer(key)}</button></article>)}</div>{retry && <div className="info-strip" role="status"><Icon name="help" /> Not quite yet. Compare the two ideas once more—nothing was lost.</div>}</>
}
function wrongAnswer(key: string) { return key.includes('pitch') ? 'By colour' : key.includes('duration') ? 'Until the next project' : key.includes('velocity') ? 'Which note it is' : key.includes('reverb') ? 'The tempo' : key.includes('meter') ? 'Always stays silent' : key.includes('resolved') ? 'Any random note' : 'Nothing changes' }

function StartToneCheck(props: GuidedSessionPageProps) {
  const answers = valueStrings(props.progress.sessions['6'].values.checkStarts)
  const correct = ['A', 'F', 'C', 'G']
  const set = (index: number, note: string) => { const next = [...answers]; next[index] = note; props.dispatch({ type: 'SET_VALUE', session: 6, key: 'checkStarts', value: next }); void props.audio.trigger(noteMidi(note), .3) }
  return <div className="start-tone-check">{correct.map((answer, index) => <article className={`panel ${answers[index] === answer ? 'is-complete' : ''}`} key={index}><span>BAR {index + 1} · {expectedChords[index]}</span><div>{scaleNotes.map((note) => <button type="button" key={note} className={answers[index] === note ? 'is-active' : ''} onClick={() => set(index, note)}>{note}</button>)}</div></article>)}</div>
}

function Evidence(props: GuidedSessionPageProps) {
  const copy = sessionCopy[props.session]
  const [confirmReset, setConfirmReset] = useState(false)
  const resetCopy = props.session === 5
    ? 'Restart Session 5 and clear dependent work from Sessions 6–8?'
    : props.session === 6
      ? 'Restart Session 6 and clear dependent work from Sessions 7–8?'
      : props.session === 7
        ? 'Restart Session 7 and clear dependent work from Session 8?'
        : `Reset Session ${props.session} evidence?`
  return <><Heading session={props.session} eyebrow={props.storageOk ? 'Checkpoint saved' : 'Checkpoint pending'} title={`${copy.badge} earned`} description={props.storageOk ? 'This evidence is durable on this device. Creative taste remains yours.' : 'This evidence remains in memory until the project save completes.'} /><div className="guided-evidence-card panel panel--teal"><div className="guided-badge"><Icon name="spark" /><strong>{copy.badge}</strong></div>{evidenceLines(props.session).map((line) => <div className="guided-evidence-line" key={line}><Icon name="check" /><span>{line}</span></div>)}</div><div className="evidence-actions"><button type="button" className="button button--gold" onClick={() => props.navigate('projects')}><Icon name="projects" /> Back to sessions</button>{!confirmReset ? <button type="button" className="text-link text-link--muted" onClick={() => setConfirmReset(true)}><Icon name="refresh" /> Restart this session</button> : <div className="reset-confirm"><span>{resetCopy}</span><button type="button" onClick={() => props.onReset(props.session)}>Restart</button><button type="button" onClick={() => setConfirmReset(false)}>Keep it</button></div>}</div></>
}

function evidenceLines(session: GuidedSessionId): readonly string[] { return ({
  2: ['Started and stopped project time', 'Counted a four-beat bar', 'Completed an eight-pulse attempt and comparison'],
  4: ['Captured F, C, and G as note occurrences', 'Repaired a deliberately broken G chord shape', 'Recorded a personal mood response for review'],
  5: ['Placed visible harmony across eight bars', 'Demonstrated canonical duplicate, move, resize, and undo', 'Returned a deliberately displaced clip to its intended bar'],
  6: ['Created an original four-bar phrase', 'Used stable chord-tone starts', 'Listened, revised, and reflected'],
  7: ['Built an A + A′ arrangement', 'Made at least two deliberate changes', 'Ended on an A-minor chord tone'],
  8: ['Changed velocity on at least three notes', 'Kept both lanes and reverb inside the beginner range', 'Completed a full-project playback and reflection'],
} as const)[session] }

function valueNumber(value: CourseValue | undefined) { return typeof value === 'number' ? value : 0 }
function valueNumbers(value: CourseValue | undefined) { return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [] }
function valueStrings(value: CourseValue | undefined) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function valueText(value: CourseValue | undefined) { return typeof value === 'string' ? value : '' }
function noteName(note: number) { return ({ 53: 'F', 55: 'G', 57: 'A', 59: 'B', 60: 'C', 62: 'D', 64: 'E', 67: 'G' } as Record<number, string>)[note] ?? String(note) }
function noteMidi(note: string) { return ({ A: 69, B: 71, C: 72, D: 74, E: 76, F: 77, G: 79 } as Record<string, number>)[note] ?? 69 }
