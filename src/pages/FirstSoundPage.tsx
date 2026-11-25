import { useEffect, useState, type Dispatch } from 'react'
import { Transport } from '../components/Brand'
import { Icon } from '../components/Icon'
import { MiraPanel } from '../components/MiraPanel'
import { PianoKeyboard } from '../components/PianoKeyboard'
import type { AudioStatus } from '../hooks/useAudioEngine'
import type { MidiState } from '../hooks/useMidi'
import type { SaveState } from '../lib/projectPersistence'
import {
  canCompleteFirstSound,
  inputPracticeComplete,
  midiCheckComplete,
  type FirstSoundAction,
} from '../lib/firstSound'
import { noteNames } from '../data'
import type {
  FirstSoundInputEvidence,
  FirstSoundProgress,
  FirstSoundStage,
  Page,
  PianoPreset,
  Settings,
} from '../types'

interface FirstSoundAudio {
  status: AudioStatus
  preset: PianoPreset
  setPreset: (preset: PianoPreset) => void
  ensureReady: () => Promise<boolean>
  trigger: (note: number, duration?: number, velocity?: number) => Promise<boolean>
  playPreset: (preset: PianoPreset) => Promise<boolean>
  stopAll: () => void
}

interface FirstSoundPageProps {
  progress: FirstSoundProgress
  dispatch: Dispatch<FirstSoundAction>
  navigate: (page: Page) => void
  settings: Settings
  midi: MidiState
  rescanMidi: () => void
  selectMidiDevice: (id: string) => void
  audio: FirstSoundAudio
  activeNotes: number[]
  pressScreenNote: (note: number) => void
  releaseScreenNote: (note: number) => void
  clearActiveNotes: () => void
  onReset: () => void
  storageOk: boolean
  saveState: SaveState
}

const stages: FirstSoundStage[] = [
  'welcome',
  'connect',
  'practice',
  'choose',
  'check',
  'evidence',
]

const stageLabels: Record<FirstSoundStage, string> = {
  welcome: 'Begin',
  connect: 'Connect',
  practice: 'Play',
  choose: 'Choose sound',
  check: 'Studio Check',
  evidence: 'Evidence',
}

const miraCopy: Record<
  FirstSoundStage,
  {
    message: string
    mood: 'listening' | 'thinking' | 'encouraging' | 'celebrating' | 'technical'
  }
> = {
  welcome: {
    message:
      'Let’s make one sound first. MIDI carries the instructions; NADI turns them into the piano you hear.',
    mood: 'listening',
  },
  connect: {
    message:
      'We’ll check the keyboard and sound separately. A setup problem is never your fault.',
    mood: 'technical',
  },
  practice: {
    message:
      'Play any three comfortable keys and release each one. Screen keys are fine for practice.',
    mood: 'encouraging',
  },
  choose: {
    message:
      'Hear both pianos. Warm is softer; Clear is cleaner. Pick the one you want to keep.',
    mood: 'thinking',
  },
  check: {
    message:
      'Now show the real keyboard connection: three MIDI notes, three releases, then two quiet seconds.',
    mood: 'listening',
  },
  evidence: {
    message:
      'Your keyboard sent MIDI, NADI made sound, and every note stopped cleanly. That is your first signal.',
    mood: 'celebrating',
  },
}

export function FirstSoundPage(props: FirstSoundPageProps) {
  const { progress, audio, navigate, dispatch } = props
  const stage = progress.stage
  const copy = miraCopy[stage]
  const evidence = stage === 'check' ? progress.check : progress.practice

  useEffect(() => {
    if (stage !== 'practice' && stage !== 'check') return
    if (
      evidence.completedCycles < 3 ||
      evidence.audioSignals < 3 ||
      evidence.held.length > 0 ||
      evidence.silenceConfirmedAt
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      dispatch({ type: 'CONFIRM_SILENCE', phase: stage })
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [dispatch, evidence, stage])

  return (
    <div className="app-shell studio-shell first-sound-shell">
      <Transport
        onPlay={() => void audio.trigger(60, 1.1, 0.74)}
        onStop={() => {
          audio.stopAll()
          props.clearActiveNotes()
        }}
        onHome={() => navigate('home')}
        saveState={props.saveState}
      />
      {((props.saveState === 'not-saved' || props.saveState === 'conflict') || audio.status === 'unavailable') && (
        <div className="recovery-toast" role="status">
          <Icon name="help" />
          <span>
            {(props.saveState === 'not-saved' || props.saveState === 'conflict')
              ? 'Progress is not saving on this browser. Keep this tab open while you work.'
              : 'Sound could not start. Your setup progress is still here.'}
          </span>
          {audio.status === 'unavailable' && (
            <button type="button" onClick={() => void audio.ensureReady()}>
              Enable sound
            </button>
          )}
        </div>
      )}
      <FirstSoundBrowser preset={progress.preset.choice ?? audio.preset} />
      <main className="studio-main" id="main-content" tabIndex={-1}>
        <FirstSoundRail stage={stage} />
        <div className="studio-workspace">
          <FirstSoundStageContent {...props} />
        </div>
      </main>
      <MiraPanel
        title="Session 1 · First Sound"
        message={copy.message}
        mood={copy.mood}
      />
      <div className="studio-footer-status">
        <span className={props.midi.status === 'connected' ? 'is-ready' : ''}>
          ●{' '}
          {props.midi.status === 'connected'
            ? props.midi.deviceName
            : 'MIDI not verified'}
        </span>
        <span className={audio.status === 'ready' ? 'is-ready' : ''}>
          ● {audio.status === 'ready' ? 'Audio ready' : 'Audio needs a click'}
        </span>
        <span className={props.storageOk ? 'is-ready' : ''}>
          ● {props.saveState === 'saving' ? 'Saving…' : props.storageOk ? 'Saved' : 'Not saved'}
        </span>
      </div>
    </div>
  )
}

function FirstSoundBrowser({ preset }: { preset: PianoPreset }) {
  return (
    <aside className="sound-browser shell-frame" aria-label="Sound browser">
      <div className="eyebrow teal">Piano sound</div>
      <div className="first-sound-preset-orb" aria-hidden="true">
        <Icon name="piano" />
      </div>
      <div className="eyebrow sound-browser__category">Loaded preset</div>
      <div className="sound-list">
        <button type="button" className={preset === 'warm' ? 'is-active' : ''} disabled>
          <Icon name="spark" /> Warm Piano
        </button>
        <button type="button" className={preset === 'clear' ? 'is-active' : ''} disabled>
          <Icon name="music" /> Clear Piano
        </button>
      </div>
      <div className="sound-browser__project">
        <Icon name="projects" /> Your first 8 bars
      </div>
    </aside>
  )
}

function FirstSoundRail({ stage }: { stage: FirstSoundStage }) {
  const active = stages.indexOf(stage)
  return (
    <ol className="phase-rail phase-rail--first-sound" aria-label="Session phases">
      {stages.map((item, index) => (
        <li
          className={`${item === stage ? 'is-active' : ''} ${index < active ? 'is-complete' : ''}`}
          key={item}
        >
          <span>{index < active ? <Icon name="check" /> : <i />}</span>
          <strong>{stageLabels[item]}</strong>
          {index < stages.length - 1 && <b aria-hidden="true" />}
          <em className="sr-only">
            {item === stage ? 'current' : index < active ? 'complete' : `phase ${index + 1}`}
          </em>
        </li>
      ))}
    </ol>
  )
}

function FirstSoundStageContent(props: FirstSoundPageProps) {
  switch (props.progress.stage) {
    case 'welcome':
      return <FirstSoundWelcome {...props} />
    case 'connect':
      return <FirstSoundConnect {...props} />
    case 'practice':
      return <FirstSoundPractice {...props} />
    case 'choose':
      return <FirstSoundChoose {...props} />
    case 'check':
      return <FirstSoundCheck {...props} />
    case 'evidence':
      return <FirstSoundEvidence {...props} />
  }
}

function FirstSoundWelcome({ dispatch }: FirstSoundPageProps) {
  return (
    <section className="studio-stage first-sound-welcome">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">Session 1 · 25–35 minutes</div>
        <h1>Make your first sound</h1>
        <p>Connect an instrument, hear it respond, and learn what MIDI actually does.</p>
      </div>
      <div className="signal-explainer">
        <article className="panel">
          <Icon name="connections" />
          <div><div className="eyebrow">MIDI</div><h2>The instruction</h2><p>Which key, how firmly, and when you release it.</p></div>
        </article>
        <span aria-hidden="true"><Icon name="arrow" /></span>
        <article className="panel panel--teal">
          <Icon name="piano" />
          <div><div className="eyebrow">Audio</div><h2>The sound</h2><p>NADI’s piano turns that instruction into something you can hear.</p></div>
        </article>
      </div>
      <div className="page-actions">
        <button type="button" className="button button--primary" onClick={() => dispatch({ type: 'START_SETUP' })}>
          Check my setup <Icon name="arrow" />
        </button>
      </div>
    </section>
  )
}

function FirstSoundConnect({ progress, dispatch, midi, rescanMidi, selectMidiDevice, audio }: FirstSoundPageProps) {
  const audioReady = progress.audioReady && audio.status === 'ready'
  const midiConnected = midi.status === 'connected'
  const enableAudio = async () => {
    const ready = await audio.ensureReady()
    dispatch({ type: 'AUDIO_READY', ready })
    if (ready) void audio.trigger(60, 0.8, 0.7)
  }
  return (
    <section className="studio-stage first-sound-connect">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">Two links · checked separately</div>
        <h1>Keyboard in. Sound out.</h1>
        <p>Nothing here changes your score. We are only checking the signal path.</p>
      </div>
      <div className="setup-grid">
        <article className={`setup-card panel ${midiConnected ? 'is-ready' : ''}`}>
          <div className="setup-card__top"><Icon name="connections" /><span className="status-pill">{midi.status.replaceAll('-', ' ')}</span></div>
          <div className="eyebrow">1 · MIDI input</div>
          <h2>{midiConnected ? midi.deviceName : 'Find your keyboard'}</h2>
          <p>{midi.message}</p>
          {midi.devices.length > 1 && (
            <label className="midi-device-select">
              MIDI input
              <select value={midi.selectedDeviceId ?? ''} onChange={(event) => selectMidiDevice(event.target.value)}>
                {midi.devices.map((device) => <option value={device.id} key={device.id}>{device.name}</option>)}
              </select>
            </label>
          )}
          <dl><div><dt>Auto checks</dt><dd>{midi.attempts} of 3</dd></div><div><dt>Last note</dt><dd>{midi.lastNote === undefined ? 'Waiting…' : noteNames[midi.lastNote] ?? midi.lastNote}</dd></div></dl>
          <button type="button" className="button button--quiet" onClick={rescanMidi}><Icon name="refresh" /> Scan again</button>
        </article>
        <article className={`setup-card panel ${audioReady ? 'is-ready' : ''}`}>
          <div className="setup-card__top"><Icon name="volume" /><span className="status-pill">{audioReady ? 'ready' : audio.status}</span></div>
          <div className="eyebrow">2 · Audio output</div>
          <h2>{audioReady ? 'Warm Piano is sounding' : 'Unlock browser sound'}</h2>
          <p>{audioReady ? 'The piano engine responded to your click.' : 'Browsers wait for one deliberate click before they play audio.'}</p>
          <button type="button" className="button button--primary" onClick={() => void enableAudio()}><Icon name="play" /> {audioReady ? 'Test again' : 'Enable sound'}</button>
        </article>
      </div>
      {!midiConnected && audioReady && <div className="info-strip"><Icon name="help" /> You can practise with screen keys now. The First Signal badge still requires your MIDI keyboard.</div>}
      <div className="page-actions">
        <button type="button" className="button button--primary" disabled={!audioReady} onClick={() => dispatch({ type: 'CONTINUE_TO_PRACTICE' })}>
          {midiConnected ? 'Play three notes' : 'Practise with screen keys'} <Icon name="arrow" />
        </button>
      </div>
    </section>
  )
}

function FirstSoundPractice(props: FirstSoundPageProps) {
  const { progress, settings, activeNotes, pressScreenNote, releaseScreenNote, dispatch } = props
  const evidence = progress.practice
  const complete = inputPracticeComplete(evidence)
  return (
    <section className="studio-stage first-sound-practice">
      <SignalHeading
        eyebrow="Practice · any input"
        title="Play three notes, then let go"
        description="Choose comfortable keys. NADI watches the press, the sound, and the release separately."
        evidence={evidence}
      />
      <SignalMeter evidence={evidence} />
      <PianoKeyboard
        activeNotes={activeNotes}
        onPress={pressScreenNote}
        onRelease={releaseScreenNote}
        showNames={settings.showNoteNames}
      />
      <div className="practice-footer">
        <span>{evidence.held.length ? `${evidence.held.length} key${evidence.held.length === 1 ? '' : 's'} still held` : evidence.completedCycles >= 3 && !evidence.silenceConfirmedAt ? 'Listening for two quiet seconds…' : complete ? 'Every practice note stopped cleanly.' : 'Screen, computer, and MIDI notes all work here.'}</span>
        <button type="button" className="button button--primary" disabled={!complete} onClick={() => dispatch({ type: 'GO_CHOOSE' })}>Choose my piano <Icon name="arrow" /></button>
      </div>
    </section>
  )
}

function FirstSoundChoose({ progress, dispatch, audio }: FirstSoundPageProps) {
  const heardBoth = progress.preset.heardWarm && progress.preset.heardClear
  const hear = async (preset: PianoPreset) => {
    if (await audio.playPreset(preset)) dispatch({ type: 'HEARD_PRESET', preset })
  }
  const choose = (preset: PianoPreset) => {
    audio.setPreset(preset)
    dispatch({ type: 'CHOOSE_PRESET', preset })
  }
  return (
    <section className="studio-stage first-sound-choose">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">One piano · two colours</div>
        <h1>Warm or Clear?</h1>
        <p>Hear both versions before choosing. This is a preference, not a test.</p>
      </div>
      <div className="preset-grid">
        {(['warm', 'clear'] as const).map((preset) => {
          const heard = preset === 'warm' ? progress.preset.heardWarm : progress.preset.heardClear
          const chosen = progress.preset.choice === preset
          return (
            <article className={`preset-card panel ${chosen ? 'is-chosen' : ''}`} key={preset}>
              <div className="preset-card__art"><Icon name={preset === 'warm' ? 'spark' : 'music'} /></div>
              <div className="eyebrow">{preset === 'warm' ? 'Soft · rounded' : 'Clean · focused'}</div>
              <h2>{preset === 'warm' ? 'Warm Piano' : 'Clear Piano'}</h2>
              <p>{preset === 'warm' ? 'Gentler edges for reflective ideas.' : 'A simpler tone that makes each note easy to follow.'}</p>
              <button type="button" className="button button--quiet" onClick={() => void hear(preset)}><Icon name="play" /> {heard ? 'Hear again' : `Hear ${preset}`}</button>
              <button type="button" className="button button--primary" disabled={!heardBoth} onClick={() => choose(preset)}>{chosen ? 'Chosen' : `Choose ${preset}`}</button>
            </article>
          )
        })}
      </div>
      <div className="page-actions">
        <button type="button" className="button button--primary" disabled={!progress.preset.choice} onClick={() => dispatch({ type: 'GO_CHECK' })}>Studio Check <Icon name="arrow" /></button>
      </div>
    </section>
  )
}

function FirstSoundCheck(props: FirstSoundPageProps) {
  const { progress, dispatch, midi, rescanMidi, activeNotes } = props
  const evidence = progress.check
  const complete = midiCheckComplete(evidence) && progress.midi.connected
  const activeNames = activeNotes.map((note) => noteNames[note] ?? String(note))
  return (
    <section className="studio-stage first-sound-check">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">Studio Check · physical MIDI</div>
        <h1>Reconnect, play three, release three</h1>
        <p>No note lights and no timer. This check verifies the actual keyboard signal.</p>
      </div>
      {midi.status !== 'connected' ? (
        <div className="midi-required panel panel--gold">
          <Icon name="connections" />
          <div><div className="eyebrow">MIDI still needed</div><h2>Your screen-key practice is safe</h2><p>{midi.message}</p></div>
          <button type="button" className="button button--primary" onClick={rescanMidi}><Icon name="refresh" /> Reconnect keyboard</button>
        </div>
      ) : (
        <>
          <div className="midi-live-monitor panel panel--teal">
            <div><div className="eyebrow">Connected device</div><strong>{midi.deviceName}</strong></div>
            <div className="live-notes" aria-live="polite">{activeNames.length ? activeNames.join(' · ') : 'Waiting for MIDI notes…'}</div>
          </div>
          <SignalMeter evidence={evidence} midiOnly />
          <div className="check-footer">
            <button type="button" className="button button--quiet" onClick={() => dispatch({ type: 'CLEAR_CHECK' })}>Clear check</button>
            <span>{evidence.completedCycles >= 3 && !evidence.silenceConfirmedAt ? 'Listening for two quiet seconds…' : complete ? 'Three MIDI notes stopped cleanly.' : 'Play and release any three comfortable keys.'}</span>
            <button type="button" className="button button--primary" disabled={!canCompleteFirstSound(progress)} onClick={() => dispatch({ type: 'FINALIZE' })}>See my evidence <Icon name="arrow" /></button>
          </div>
        </>
      )}
    </section>
  )
}

function FirstSoundEvidence({ progress, navigate, audio, onReset, storageOk }: FirstSoundPageProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const preset = progress.preset.choice ?? 'warm'
  return (
    <section className="studio-stage first-sound-evidence">
      <div className="studio-stage__heading">
        <div className="eyebrow teal">{storageOk ? 'Checkpoint saved' : 'Checkpoint pending'} · first-signal-complete</div>
        <h1>Your first signal works</h1>
        <p>The result below names the setup evidence—there is no percentage score.</p>
      </div>
      <div className="first-signal-card panel panel--teal">
        <div className="first-signal-badge"><Icon name="spark" /><span>First Signal</span></div>
        <EvidenceRow icon="connections" title="MIDI input verified" detail={progress.midi.deviceName ?? 'Previously verified MIDI keyboard'} />
        <EvidenceRow icon="piano" title="Three press-and-release cycles" detail={`${progress.check.midiCycles} MIDI cycles observed`} />
        <EvidenceRow icon="volume" title="Sound responded" detail={`${progress.check.audioSignals} audio signals registered`} />
        <EvidenceRow icon="check" title="No notes left held" detail="Two quiet seconds confirmed after release" />
        <EvidenceRow icon="music" title={`${preset === 'warm' ? 'Warm' : 'Clear'} Piano selected`} detail="Creative preference · not graded" />
      </div>
      <div className="evidence-actions">
        <button type="button" className="button button--gold" onClick={() => navigate('projects')}><Icon name="projects" /> Back to sessions</button>
        <button type="button" className="button button--primary" onClick={() => void audio.trigger(60, 1.2, 0.75)}><Icon name="play" /> Play my piano</button>
        {!confirmReset ? (
          <button type="button" className="text-link text-link--muted" onClick={() => setConfirmReset(true)}><Icon name="refresh" /> Restart Session 1 demo</button>
        ) : (
          <div className="reset-confirm" role="group" aria-label="Confirm Session 1 reset">
            <span>Reset only the Session 1 checkpoint?</span>
            <button type="button" onClick={onReset}>Reset Session 1 data</button>
            <button type="button" onClick={() => setConfirmReset(false)}>Keep checkpoint</button>
          </div>
        )}
      </div>
    </section>
  )
}

function SignalHeading({ eyebrow, title, description, evidence }: { eyebrow: string; title: string; description: string; evidence: FirstSoundInputEvidence }) {
  const source = evidence.lastSource === 'midi' ? 'MIDI keyboard' : evidence.lastSource === 'computer' ? 'Computer keys' : evidence.lastSource === 'screen' ? 'Screen keys' : 'Choose any input'
  return (
    <div className="studio-stage__heading studio-stage__heading--row">
      <div><div className="eyebrow teal">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
      <span className="input-badge"><i className={evidence.lastSource ? 'is-live' : ''} /> {source}</span>
    </div>
  )
}

function SignalMeter({ evidence, midiOnly = false }: { evidence: FirstSoundInputEvidence; midiOnly?: boolean }) {
  const cycles = midiOnly ? evidence.midiCycles : evidence.completedCycles
  return (
    <div className="signal-meter panel" aria-label="Note signal evidence">
      <MeterItem label="Pressed" value={Math.min(evidence.noteOns, 3)} target={3} />
      <Icon name="arrow" />
      <MeterItem label="Sound" value={Math.min(evidence.audioSignals, 3)} target={3} />
      <Icon name="arrow" />
      <MeterItem label="Released" value={Math.min(cycles, 3)} target={3} />
      <Icon name="arrow" />
      <MeterItem label="Quiet" value={evidence.silenceConfirmedAt ? 1 : 0} target={1} />
    </div>
  )
}

function MeterItem({ label, value, target }: { label: string; value: number; target: number }) {
  const complete = value >= target
  return <div className={complete ? 'is-complete' : ''}><span>{complete ? <Icon name="check" /> : value}</span><strong>{label}</strong><small>{value}/{target}</small></div>
}

function EvidenceRow({ icon, title, detail }: { icon: Parameters<typeof Icon>[0]['name']; title: string; detail: string }) {
  return <div className="first-signal-row"><span><Icon name="check" /></span><Icon name={icon} /><div><strong>{title}</strong><small>{detail}</small></div></div>
}
