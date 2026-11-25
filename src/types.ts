export type GuidedSessionId = 2 | 4 | 5 | 6 | 7 | 8
export type GuidedSessionPage = `session-${GuidedSessionId}`

export type Page =
  | 'home'
  | 'paths'
  | 'projects'
  | 'notebook'
  | 'connections'
  | 'settings'
  | 'first-sound'
  | 'studio'
  | GuidedSessionPage

export type StudioStage =
  | 'welcome'
  | 'recall'
  | 'explore'
  | 'learn'
  | 'practice'
  | 'apply'
  | 'check'
  | 'evidence'

export type InputSource = 'screen' | 'computer' | 'midi'

export type PianoPreset = 'warm' | 'clear'

export type FirstSoundStage =
  | 'welcome'
  | 'connect'
  | 'practice'
  | 'choose'
  | 'check'
  | 'evidence'

export interface FirstSoundInputEvidence {
  noteOns: number
  noteOffs: number
  completedCycles: number
  midiCycles: number
  fallbackCycles: number
  audioSignals: number
  held: Array<{ note: number; source: InputSource }>
  lastSource?: InputSource
  silenceConfirmedAt?: string
  completedAt?: string
}

export interface FirstSoundProgress {
  version: 1
  stage: FirstSoundStage
  midi: {
    connected: boolean
    deviceName?: string
  }
  audioReady: boolean
  practice: FirstSoundInputEvidence
  preset: {
    heardWarm: boolean
    heardClear: boolean
    choice?: PianoPreset
    completedAt?: string
  }
  check: FirstSoundInputEvidence
  checkpoint?: {
    name: 'first-signal-complete'
    savedAt: string
  }
  updatedAt: string
}

export type EvidenceLevel =
  | 'not-tried'
  | 'with-guidance'
  | 'demonstrated'
  | 'independent'

export interface CapturedChord {
  notes: number[]
  inputEvents: number
  source?: InputSource
  completedAt?: string
}

export interface SessionEvidence {
  recall: {
    taps: number
    completedAt?: string
  }
  explore: {
    heardMinor: boolean
    heardMajor: boolean
    choice?: 'minor' | 'major'
    completedAt?: string
  }
  learn: {
    heardSeparate: boolean
    heardTogether: boolean
    completedAt?: string
  }
  practice: CapturedChord & {
    hintsUsed: number
  }
  apply: {
    notes: number[]
    editEvents: number
    playedBack: boolean
    completedAt?: string
  }
  check: CapturedChord & {
    hintsUsed: number
  }
  reflection?: string
}

export interface SessionProgress {
  version: 1
  stage: StudioStage
  evidence: SessionEvidence
  checkpoint?: {
    name: 'harmony-a-complete'
    savedAt: string
  }
  updatedAt: string
}

export interface Settings {
  version: 1
  theme: 'midnight' | 'daylight'
  textSize: 'compact' | 'comfortable' | 'large'
  reduceMotion: boolean
  showNoteNames: boolean
  highContrast: boolean
  breakReminders: boolean
  countIn: boolean
  showEstimates: boolean
}

export interface LearningPath {
  id: 'emotive' | 'guitar' | 'cinematic' | 'electronic'
  title: string
  eyebrow: string
  mood: string
  promise: string
  available: boolean
  accent: 'teal' | 'amber' | 'violet' | 'coral'
}

export interface CourseSession {
  number: number
  title: string
  short: string
  duration: string
  status: 'complete' | 'current' | 'upcoming'
  playable: boolean
}
