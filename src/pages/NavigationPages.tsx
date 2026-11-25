import { useState } from 'react'
import { courseSessions, paths } from '../data'
import type { MidiState } from '../hooks/useMidi'
import type { AudioStatus } from '../hooks/useAudioEngine'
import { canCompleteSession, isSessionComplete, sessionEvidenceLevel } from '../lib/progress'
import {
  isGuidedSessionComplete,
  type CourseProgress,
} from '../lib/courseProgress'
import type {
  FirstSoundProgress,
  GuidedSessionPage,
  Page,
  SessionProgress,
  Settings,
} from '../types'
import { Brand, MidiChip } from '../components/Brand'
import { Icon, type IconName } from '../components/Icon'
import { MiraPanel } from '../components/MiraPanel'
import { MiniArrangement } from '../components/MiniArrangement'
import { PianoKeyboard } from '../components/PianoKeyboard'
import type { ConnectionPrefs, SaveState } from '../lib/projectPersistence'

export type NavigationPage = Exclude<Page, 'studio' | 'first-sound' | GuidedSessionPage>

const navigation: Array<{
  id: NavigationPage
  label: string
  icon: IconName
}> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'paths', label: 'Paths', icon: 'paths' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'notebook', label: 'Notebook', icon: 'notebook' },
  { id: 'connections', label: 'Connections', icon: 'connections' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

interface NavigationShellProps {
  page: NavigationPage
  navigate: (page: Page) => void
  progress: SessionProgress
  firstSound: FirstSoundProgress
  course: CourseProgress
  settings: Settings
  setSettings: React.Dispatch<React.SetStateAction<Settings>>
  connectionPrefs: ConnectionPrefs
  setConnectionPrefs: React.Dispatch<React.SetStateAction<ConnectionPrefs>>
  midi: MidiState
  rescanMidi: () => void
  silenceMidi: () => void
  audio: {
    status: AudioStatus
    ensureReady: () => Promise<boolean>
    trigger: (note: number, duration?: number, velocity?: number) => Promise<boolean>
    playChord: (notes: readonly number[], duration?: number) => Promise<boolean>
    playDemo: (
      id: 'emotive' | 'guitar' | 'cinematic' | 'electronic',
    ) => Promise<boolean>
    stopAll: () => void
  }
  activeDemo?: string
  onPlayDemo: (id: 'emotive' | 'guitar' | 'cinematic' | 'electronic') => void
  storageOk: boolean
  saveState: SaveState
}

const miraCopy: Record<NavigationPage, { title?: string; message: string }> = {
  home: {
    message: 'Ready when you are. We can continue, or listen first.',
  },
  paths: {
    message: 'Pick the sound that makes you want to create. The previews are here just to listen.',
  },
  projects: {
    message: 'One session at a time. Your project grows each time you return.',
  },
  notebook: {
    title: 'Theory grows with reflection',
    message: 'This notebook remembers what you tried—not how fast you learned it.',
  },
  connections: {
    message: 'Play one key. If the input moves and you hear the piano, you’re ready.',
  },
  settings: {
    message: 'Set things up in the way that feels comfortable for you.',
  },
}

export function NavigationShell(props: NavigationShellProps) {
  const { page, navigate, midi } = props
  const copy = miraCopy[page]
  return (
    <div className="app-shell navigation-shell">
      <header className="nav-header shell-frame">
        <button type="button" className="brand-button" onClick={() => navigate('home')}>
          <Brand />
          <span className="sr-only">NADI home</span>
        </button>
        <div className="nav-header__actions">
          <MidiChip
            status={midi.status}
            name={midi.deviceName}
            onClick={() => navigate('connections')}
          />
          <button type="button" className="icon-button" onClick={() => navigate('settings')} aria-label="Open settings">
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <aside className="sidebar shell-frame" aria-label="Main navigation">
        <nav>
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`sidebar__item ${page === item.id ? 'is-active' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__save">
          <Icon name="save" />
          <span><small>{props.saveState === 'saving' ? 'Checkpoint saving' : props.storageOk && props.progress.checkpoint ? 'Saved checkpoint' : 'Checkpoint pending'}</small>{props.progress.checkpoint?.name ?? 'No checkpoint yet'}</span>
        </div>
      </aside>
      <main className="navigation-main" id="main-content" tabIndex={-1}>
        {((props.saveState === 'not-saved' || props.saveState === 'conflict') || props.audio.status === 'unavailable') && (
          <div className="recovery-strip" role="status">
            <Icon name="help" />
            <span>{(props.saveState === 'not-saved' || props.saveState === 'conflict') ? 'Progress is not saving on this browser. Keep this tab open while you work.' : 'Sound could not start. Your visual work is still here.'}</span>
            {props.audio.status === 'unavailable' && <button type="button" onClick={() => void props.audio.ensureReady()}>Enable sound</button>}
          </div>
        )}
        <NavigationPageContent {...props} />
      </main>
      <MiraPanel title={copy.title} message={copy.message} />
      <div className="mobile-studio-note">Production works best with a laptop or keyboard. Listening and review remain available here.</div>
    </div>
  )
}

function NavigationPageContent(props: NavigationShellProps) {
  switch (props.page) {
    case 'home':
      return <HomePage {...props} />
    case 'paths':
      return <PathsPage {...props} />
    case 'projects':
      return <ProjectsPage {...props} />
    case 'notebook':
      return <NotebookPage {...props} />
    case 'connections':
      return <ConnectionsPage {...props} />
    case 'settings':
      return <SettingsPage {...props} />
  }
}

function sessionPage(number: number): Page {
  if (number === 1) return 'first-sound'
  if (number === 3) return 'studio'
  return `session-${number}` as Page
}

function HomePage({ progress, firstSound, course, navigate, storageOk, saveState }: NavigationShellProps) {
  const harmonyComplete = isSessionComplete(progress)
  const firstSoundComplete = firstSound.checkpoint?.name === 'first-signal-complete'
  const complete = (number: number) => number === 1
    ? firstSoundComplete
    : number === 3
      ? harmonyComplete
      : isGuidedSessionComplete(course, number as 2 | 4 | 5 | 6 | 7 | 8)
  const activeSession = courseSessions.find((session) => !complete(session.number)) ?? courseSessions[7]
  const activeComplete = courseSessions.every((session) => complete(session.number))
  const completedCount = courseSessions.filter((session) => complete(session.number)).length
  return (
    <section className="page page--home">
      <div className="page-heading page-heading--left">
        <div className="eyebrow">Your studio</div>
        <h1>Welcome back</h1>
        <p>{activeComplete ? 'Your first eight-bar track is complete.' : `${completedCount} of 8 session checkpoints ${storageOk ? 'saved' : 'recorded in this open session'}. Continue when you feel ready.`}</p>
      </div>
      <article className="project-hero panel panel--gold">
        <div className="project-hero__copy">
          <div className="eyebrow teal"><Icon name="piano" /> {activeComplete ? 'Your first track' : 'Continue your 8 bars'}</div>
          <h2>Session {activeSession.number} · {activeSession.title}</h2>
          <div className="project-hero__meta">
            <span><Icon name="clock" /> {activeSession.duration}</span>
            <span><Icon name="save" /> {activeComplete ? 'first-track-complete' : saveState === 'saving' ? 'Saving…' : storageOk ? 'Saved' : 'Not saved'}</span>
          </div>
          <button type="button" className="button button--primary" onClick={() => navigate(sessionPage(activeSession.number))}>
            {activeComplete ? 'Review final session' : `Open Session ${activeSession.number}`} <Icon name="arrow" />
          </button>
        </div>
        <MiniArrangement completed={harmonyComplete} />
      </article>
      <div className="home-shortcuts">
        <button className="shortcut-card panel" type="button" onClick={() => navigate('notebook')}>
          <Icon name="notebook" />
          <span><strong>Theory Notebook</strong><small>{completedCount ? `${Math.min(12, completedCount * 2)} concepts collected` : 'Nothing collected yet'}</small></span>
          <Icon name="arrow" />
        </button>
        <button className="shortcut-card panel" type="button" onClick={() => navigate('projects')}>
          <Icon name="projects" />
          <span><strong>Project & Sessions</strong><small>1 active project</small></span>
          <Icon name="arrow" />
        </button>
      </div>
      <button className="text-link" type="button" onClick={() => navigate('paths')}>
        Choose another sound <Icon name="arrow" />
      </button>
    </section>
  )
}

function PathsPage({ navigate, activeDemo, onPlayDemo }: NavigationShellProps) {
  return (
    <section className="page page--paths">
      <div className="page-heading">
        <div className="eyebrow">Four directions · one complete course</div>
        <h1>Choose your sound</h1>
        <p>Hear each path before you decide.</p>
      </div>
      <div className="path-grid">
        {paths.map((path, index) => (
          <article className={`path-card panel path-card--${path.accent} ${path.available ? 'is-available' : ''}`} key={path.id}>
            <div className="path-card__art" aria-hidden="true">
              <span>{index === 0 ? '♩' : index === 1 ? '⌁' : index === 2 ? '◢' : '✦'}</span>
            </div>
            <div className="path-card__body">
              <div className="path-card__topline">
                <h2>{path.title}</h2>
                <span className="status-pill">{path.eyebrow}</span>
              </div>
              <p>{path.mood}</p>
              <div className="waveform" aria-hidden="true">{Array.from({ length: 22 }, (_, bar) => <i style={{ height: `${20 + ((bar * 17) % 54)}%` }} key={bar} />)}</div>
              <div className="path-card__bottom">
                <button
                  type="button"
                  className={`round-play ${activeDemo === path.id ? 'is-playing' : ''}`}
                  onClick={() => onPlayDemo(path.id)}
                  aria-label={`${activeDemo === path.id ? 'Stop' : 'Play'} ${path.title} preview`}
                >
                  <Icon name={activeDemo === path.id ? 'stop' : 'play'} />
                </button>
                <small>{path.promise}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="info-strip"><Icon name="help" /> You can preview every path. Only Emotive Piano is available to start right now.</div>
      <div className="page-actions">
        <button type="button" className="button button--primary" onClick={() => navigate('projects')}>Start Emotive Piano</button>
        <button type="button" className="button button--quiet" onClick={() => onPlayDemo('emotive')}>Keep listening</button>
      </div>
    </section>
  )
}

function ProjectsPage({ progress, firstSound, course, navigate, settings }: NavigationShellProps) {
  const harmonyDemonstrated = canCompleteSession(progress)
  const harmonyComplete = isSessionComplete(progress)
  const firstSoundComplete = firstSound.checkpoint?.name === 'first-signal-complete'
  const complete = (number: number) => number === 1
    ? firstSoundComplete
    : number === 3
      ? harmonyComplete
      : isGuidedSessionComplete(course, number as 2 | 4 | 5 | 6 | 7 | 8)
  const nextSession = courseSessions.find((session) => !complete(session.number)) ?? courseSessions[7]
  const primaryPage = sessionPage(nextSession.number)
  return (
    <section className="page page--projects">
      <div className="page-heading page-heading--left page-heading--row">
        <div>
          <div className="eyebrow">Emotive Piano · Project 1</div>
          <h1>Project &amp; Sessions</h1>
          <p>Your first 8 bars · about 5–6 hours, at your pace.</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => navigate(primaryPage)}>
          {courseSessions.every((session) => complete(session.number)) ? 'Review finished track' : `Continue Session ${nextSession.number}`}
        </button>
      </div>
      <div className="session-grid">
        {courseSessions.map((session) => {
          const status = complete(session.number) ? 'complete' : session.number === nextSession.number ? 'current' : 'upcoming'
          return (
            <article className={`session-card panel session-card--${status}`} key={session.number}>
              <div className="session-card__number">{status === 'complete' ? <Icon name="check" /> : session.number}</div>
              <div>
                <div className="eyebrow">Session {session.number}</div>
                <h2>{session.title}</h2>
                <p>{session.short}</p>
              </div>
              {settings.showEstimates && <small>{session.duration}</small>}
              {session.playable && (
                <button type="button" className="session-card__action" onClick={() => navigate(sessionPage(session.number))}>
                  {status === 'complete' ? 'Review evidence' : status === 'current' ? 'Continue' : 'Open session'} <Icon name="arrow" />
                </button>
              )}
            </article>
          )
        })}
      </div>
      <div className="project-preview panel">
        <div>
          <div className="eyebrow teal">Project preview</div>
          <MiniArrangement completed={harmonyDemonstrated} compact />
        </div>
        <div className="project-preview__about">
          <div className="eyebrow">About this project</div>
          <p>A calm 8-bar idea in A minor, built with chords and a melody you will write.</p>
          <span className="checkpoint"><Icon name="save" /> {course.sessions['8'].checkpoint?.name ?? progress.checkpoint?.name ?? firstSound.checkpoint?.name ?? 'new-project'}</span>
        </div>
      </div>
    </section>
  )
}

function NotebookPage({ progress, firstSound, course, audio }: NavigationShellProps) {
  const level = sessionEvidenceLevel(progress)
  const levelLabel = level === 'independent' ? 'Independent' : level === 'with-guidance' ? 'With guidance' : 'Not tried'
  const firstSoundState = firstSound.checkpoint
    ? 'Independent'
    : firstSound.practice.completedAt
      ? 'With guidance'
      : 'Not tried'
  const guidedState = (session: 2 | 4 | 5 | 6 | 7 | 8) =>
    isGuidedSessionComplete(course, session)
      ? 'Independent'
      : course.sessions[String(session)].stage !== 'welcome'
        ? 'With guidance'
        : 'Not tried'
  const concepts = [
    { name: 'MIDI vs audio', state: firstSoundState, icon: 'IN → OUT', notes: [60] },
    { name: 'Beat & bar', state: guidedState(2), icon: '4 · 4', notes: [72] },
    { name: '4/4 time', state: guidedState(2), icon: '1–2–3–4', notes: [72, 72] },
    { name: 'A minor triad', state: levelLabel, icon: 'A · C · E', notes: [57, 60, 64] },
    { name: 'Chord progression', state: guidedState(4), icon: '→', notes: [57, 60, 64] },
    { name: 'Harmonic rhythm', state: guidedState(5), icon: '1 BAR', notes: [53, 57, 60] },
    { name: 'Chord-tone melody', state: guidedState(6), icon: 'A · C · E', notes: [69, 72, 76] },
    { name: 'A + A′ form', state: guidedState(7), icon: 'A → A′', notes: [69, 72] },
    { name: 'Velocity & space', state: guidedState(8), icon: 'SOFT → FIRM', notes: [69, 76] },
  ]
  return (
    <section className="page page--notebook">
      <div className="page-heading">
        <div className="eyebrow">Hear · try · remember</div>
        <h1>Theory Notebook</h1>
        <p>Music ideas you can listen to again.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Notebook sections">
        <button type="button" role="tab" aria-selected="true" className="is-active">Concepts</button>
        <button type="button" role="tab" aria-selected="false" disabled>Studio skills</button>
        <button type="button" role="tab" aria-selected="false" disabled>My questions</button>
      </div>
      <div className="notebook-table panel">
        <div className="notebook-table__header"><span>Concept</span><span>Evidence</span><span>Actions</span></div>
        {concepts.map((concept) => (
          <div className="notebook-row" key={concept.name}>
            <span className="notebook-row__icon">{concept.icon}</span>
            <strong>{concept.name}</strong>
            <span className={`evidence-state evidence-state--${concept.state.toLowerCase().replaceAll(' ', '-')}`}><i />{concept.state}</span>
            <button type="button" className="button button--small button--quiet" onClick={() => void audio.playChord(concept.notes, 0.9)}>
              <Icon name="play" /> Play example
            </button>
          </div>
        ))}
      </div>
      <div className="evidence-key panel">
        <span><i className="not-tried" /> Not tried</span>
        <span><i className="with-guidance" /> With guidance</span>
        <span><i className="demonstrated" /> Demonstrated</span>
        <span><i className="independent" /> Independent</span>
        <span><i className="recalled" /> Recalled later</span>
      </div>
    </section>
  )
}

function ConnectionsPage({ midi, rescanMidi, silenceMidi, audio, settings, connectionPrefs: prefs, setConnectionPrefs: setPrefs, storageOk, saveState }: NavigationShellProps) {
  const [showKeys, setShowKeys] = useState(false)
  const [pressed, setPressed] = useState<number[]>([])
  const [soundPrompt, setSoundPrompt] = useState(false)

  const connected = midi.status === 'connected'
  const browserAllowed = !['unsupported', 'permission-denied'].includes(midi.status)
  const setupSaved = connected && prefs.audioConfirmed && prefs.delay === 'comfortable'

  const playScreenNote = (note: number) => {
    setPressed((notes) => [...new Set([...notes, note])])
    void audio.trigger(note, 0.6)
    window.setTimeout(() => setPressed((notes) => notes.filter((item) => item !== note)), 620)
  }

  return (
    <section className="page page--connections">
      <div className="page-heading page-heading--left">
        <div className="eyebrow">Hardware and sound</div>
        <h1>Connections</h1>
        <p>Check one link at a time. Your project stays safe while you reconnect.</p>
      </div>
      <div className="connection-grid">
        <article className="connection-card panel">
          <div className="connection-card__heading"><span><Icon name="piano" /> MIDI keyboard</span><StatusPill ok={connected} text={connected ? 'Connected' : midi.status.replace('-', ' ')} /></div>
          <dl>
            <div><dt>Device</dt><dd>{midi.deviceName ?? 'No keyboard selected'}</dd></div>
            <div><dt>Automatic discovery</dt><dd>{midi.attempts} of 3 attempts</dd></div>
            <div><dt>Live input</dt><dd>{midi.activity ? `Note ${midi.lastNote} received` : 'Waiting for a note…'}</dd></div>
          </dl>
          <p className="connection-message">{midi.message}</p>
          <div className="button-row">
            <button type="button" className="button button--quiet" onClick={() => setShowKeys((value) => !value)}><Icon name="piano" /> Test keys</button>
            <button type="button" className="button button--quiet" onClick={rescanMidi}><Icon name="refresh" /> Rescan MIDI</button>
          </div>
        </article>
        <article className="connection-card panel">
          <div className="connection-card__heading"><span><Icon name="volume" /> Audio output</span><StatusPill ok={prefs.audioConfirmed} text={prefs.audioConfirmed ? 'Confirmed' : 'Check sound'} /></div>
          <dl>
            <div><dt>Output</dt><dd>Browser default speakers</dd></div>
            <div><dt>Instrument</dt><dd>Warm NADI piano</dd></div>
            <div><dt>All notes off</dt><dd>Available any time</dd></div>
          </dl>
          <p className="connection-message">Browser audio begins after you choose Test sound.</p>
          <div className="button-row">
            <button type="button" className="button button--primary" onClick={() => { void audio.trigger(69, 1.1).then((played) => setSoundPrompt(played)) }}><Icon name="play" /> Test sound</button>
            <button type="button" className="button button--quiet" onClick={() => { silenceMidi(); audio.stopAll() }}><Icon name="stop" /> Silence notes</button>
          </div>
          {soundPrompt && (
            <div className="inline-confirm">
              <span>Did you hear the piano?</span>
              <button type="button" onClick={() => { setPrefs((value) => ({ ...value, audioConfirmed: true })); setSoundPrompt(false) }}>Yes, I heard it</button>
              <button type="button" onClick={() => { setPrefs((value) => ({ ...value, audioConfirmed: false })); setSoundPrompt(false) }}>Not yet</button>
            </div>
          )}
        </article>
      </div>
      {showKeys && (
        <div className="connection-keys panel">
          <div><div className="eyebrow teal">Screen-key fallback</div><p>This confirms sound. MIDI setup remains separate until a hardware note arrives.</p></div>
          <PianoKeyboard activeNotes={pressed} onPress={playScreenNote} showNames={settings.showNoteNames} />
        </div>
      )}
      <div className="connection-check panel">
        <div>
          <div className="eyebrow teal">Connection check</div>
          <CheckLine number={1} label="Browser MIDI support" value={browserAllowed ? 'Available' : midi.status === 'unsupported' ? 'Not supported here' : 'Permission is off'} ok={browserAllowed} />
          <CheckLine number={2} label="MIDI input" value={connected ? `Listening to ${midi.deviceName}` : 'Use screen or computer keys for now'} ok={connected} />
          <CheckLine number={3} label="Piano sound" value={prefs.audioConfirmed ? 'You confirmed it is audible' : 'Waiting for your confirmation'} ok={prefs.audioConfirmed} />
          <CheckLine number={4} label="Delay" value={prefs.delay === 'comfortable' ? 'Feels comfortable' : prefs.delay === 'noticeable' ? 'Noticeable delay' : 'Not checked yet'} ok={prefs.delay === 'comfortable'} />
        </div>
        <div className="delay-check">
          <button type="button" className="button button--quiet" onClick={() => { void audio.trigger(72, 0.25); setPrefs((value) => ({ ...value, delay: 'unchecked' })) }}><Icon name="clock" /> Latency check</button>
          <p>After the note, choose what you noticed.</p>
          <div className="segmented">
            <button type="button" className={prefs.delay === 'comfortable' ? 'is-active' : ''} onClick={() => setPrefs((value) => ({ ...value, delay: 'comfortable' }))}>Comfortable</button>
            <button type="button" className={prefs.delay === 'noticeable' ? 'is-active' : ''} onClick={() => setPrefs((value) => ({ ...value, delay: 'noticeable' }))}>Noticeable</button>
          </div>
          <span className={`setup-save ${setupSaved && storageOk ? 'is-saved' : ''}`}><Icon name="save" /> {setupSaved ? saveState === 'saving' ? 'Saving device setup…' : storageOk ? 'Device setup saved' : 'Device setup not saved' : 'Complete the checks to save setup'}</span>
        </div>
      </div>
    </section>
  )
}

function StatusPill({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`status-pill ${ok ? 'status-pill--ok' : ''}`}>{ok && <Icon name="check" />}{text}</span>
}

function CheckLine({ number, label, value, ok }: { number: number; label: string; value: string; ok: boolean }) {
  return <div className="check-line"><span>{number}</span><strong>{label}</strong><i /><em>{value}</em><b className={ok ? 'is-ok' : ''}>{ok ? '✓' : '·'}</b></div>
}

function SettingsPage({ settings, setSettings, storageOk, saveState }: NavigationShellProps) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }
  return (
    <section className="page page--settings">
      <div className="page-heading page-heading--left">
        <div className="eyebrow">{saveState === 'saving' ? 'Saving settings…' : storageOk ? 'Saved automatically' : 'Settings not saved'}</div>
        <h1>Settings</h1>
        <p>Make the studio comfortable without changing what the colours mean.</p>
      </div>
      <div className="settings-stack">
        <section className="settings-group panel">
          <div className="eyebrow teal">Appearance</div>
          <div className="settings-row settings-row--split">
            <div><label>Theme</label><div className="segmented"><button type="button" className={settings.theme === 'midnight' ? 'is-active' : ''} onClick={() => update('theme', 'midnight')}>Bright Midnight</button><button type="button" className={settings.theme === 'daylight' ? 'is-active' : ''} onClick={() => update('theme', 'daylight')}>Daylight</button></div></div>
            <div><label>Text size</label><div className="segmented segmented--text"><button type="button" className={settings.textSize === 'compact' ? 'is-active' : ''} onClick={() => update('textSize', 'compact')}>A</button><button type="button" className={settings.textSize === 'comfortable' ? 'is-active' : ''} onClick={() => update('textSize', 'comfortable')}>Aa</button><button type="button" className={settings.textSize === 'large' ? 'is-active' : ''} onClick={() => update('textSize', 'large')}>AA</button></div></div>
          </div>
        </section>
        <section className="settings-group panel">
          <div className="eyebrow teal">Accessibility</div>
          <Toggle label="Reduce motion" value={settings.reduceMotion} onChange={(value) => update('reduceMotion', value)} />
          <Toggle label="Show note names" value={settings.showNoteNames} onChange={(value) => update('showNoteNames', value)} />
          <Toggle label="High-contrast controls" value={settings.highContrast} onChange={(value) => update('highContrast', value)} />
        </section>
        <section className="settings-group panel">
          <div className="eyebrow teal">Learning</div>
          <Toggle label="Break reminders" value={settings.breakReminders} onChange={(value) => update('breakReminders', value)} />
          <Toggle label="Count-in before playing" value={settings.countIn} onChange={(value) => update('countIn', value)} />
          <Toggle label="Show session estimates" value={settings.showEstimates} onChange={(value) => update('showEstimates', value)} />
        </section>
        <section className="settings-group panel settings-group--language">
          <div><div className="eyebrow teal">Language</div><p>English</p></div>
          <button type="button" disabled>Bahasa Melayu · later</button>
        </section>
      </div>
      <div className="autosave-note"><Icon name="save" /> {saveState === 'saving' ? 'Saving settings…' : storageOk ? 'Settings saved automatically' : 'Settings are not saved; keep this tab open or download a backup'}</div>
    </section>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true"><b /></i>
    </label>
  )
}
