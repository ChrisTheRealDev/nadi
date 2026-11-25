import { isMelodicSound, type StudioProject } from './model'
import type { StudioHelpAnswer, StudioObservedAction } from './studioHelp'

export const FIRST_SONG_PHASES = ['grid', 'listen', 'correct', 'develop', 'variation', 'layers', 'finish'] as const
export type FirstSongPhase = typeof FIRST_SONG_PHASES[number]
export const FIRST_SONG_STEP_IDS = ['grid-draw', 'listen-play', 'listen-confirm', 'correct-edit', 'correct-undo', 'develop-repeat', 'variation-duplicate', 'variation-change', 'layers-add', 'layers-edit', 'finish-balance', 'finish-save', 'finish-export'] as const
export type FirstSongStepId = typeof FIRST_SONG_STEP_IDS[number]
export interface FirstSongGuideSession {
  projectId: string; goal: string; currentStep: FirstSongStepId; startSequence: number
  trackId?: string; clipId?: string; completed: FirstSongStepId[]; skipped: FirstSongStepId[]; finished: boolean
  nextDestination?: { trackId: string; clipId: string }
}
export interface FirstSongGuideUi { canUndo?: boolean; activeTool?: 'unknown' | 'draw' | 'select' | 'erase' }
interface FirstSongDefinition extends StudioHelpAnswer {
  phase: FirstSongPhase; title: string; acceptedActions: readonly string[]; scope: 'project' | 'track' | 'clip'
  requires?: 'melodic' | 'notes' | 'clip' | 'track'; confirmationRequired?: boolean
}
/** Authored instructions only. This registry never changes musical data or invokes a provider. */
export const FIRST_SONG_STEPS: Record<FirstSongStepId, FirstSongDefinition> = {
  'grid-draw': { phase: 'grid', title: 'Place your first note', target: 'piano-roll', scope: 'clip', requires: 'melodic', acceptedActions: ['note-changed'],
    idea: 'Up means a higher pitch; right means later in time. A small idea is enough to begin.',
    action: 'Choose Draw, then click an empty square in the piano grid to place a note.',
    differently: 'The block’s left edge is its start. Its width is its length. Try a few notes and let your ears choose.' },
  'listen-play': { phase: 'listen', title: 'Play your idea', target: 'play-song', scope: 'project', requires: 'notes', acceptedActions: ['song-played'],
    idea: 'Listening helps you decide what to keep. Mira cannot hear your speakers or judge whether you like it.',
    action: 'Press Play to hear your idea.', differently: 'If you hear nothing, try Test sound and check volume, Mute and sound loading. Starting playback does not confirm that you heard it.' },
  'listen-confirm': { phase: 'listen', title: 'Decide after listening', target: null, scope: 'project', acceptedActions: [], confirmationRequired: true,
    idea: 'Your ears make this decision. A successful Play action cannot tell Mira whether the sound reached you or felt right.',
    action: 'When you have heard your idea and are ready to continue, choose “I listened — continue”.',
    differently: 'You can replay and edit first. This confirmation means you have listened, not that the idea is finished or perfect.' },
  'correct-edit': { phase: 'correct', title: 'Try one small correction', target: 'piano-roll', scope: 'clip', requires: 'notes', acceptedActions: ['note-changed', 'note-deleted', 'drum-hit-changed'],
    idea: 'Edits are experiments. Make one change so you can hear what it does.',
    action: 'Drag a note body to change its pitch or timing, or its right-edge handle to change its length.',
    differently: 'Try changing just one note. Right-click removes a note; Undo will let you compare with the previous version.' },
  'correct-undo': { phase: 'correct', title: 'Undo the experiment', target: 'undo', scope: 'clip', requires: 'clip', acceptedActions: ['undo'],
    idea: 'Undo restores the musical edit immediately before it. It is useful for comparing an experiment with your original.',
    action: 'Press Undo in the top toolbar to reverse your latest musical edit.',
    differently: 'Check the Undo label before pressing it. If you have made more edits since the experiment, Undo reverses the most recent one.' },
  'develop-repeat': { phase: 'develop', title: 'Develop a longer phrase', target: 'repeat-next-bar', scope: 'clip', requires: 'notes', acceptedActions: ['bar-duplicated'],
    idea: 'Repeating a short phrase gives your listener something to recognize.',
    action: 'Show the bar with your notes, open Bar actions, and choose Repeat in next bar.',
    differently: 'This copies the shown bar’s notes into the next bar of this part. The copies can then be edited separately.' },
  'variation-duplicate': { phase: 'variation', title: 'Make an independent variation', target: 'duplicate-independent', scope: 'clip', requires: 'notes', acceptedActions: ['clip-duplicated-independent', 'clips-duplicate'],
    idea: 'An independent copy lets the next phrase change while the first phrase stays as it was.',
    action: 'Select your clip in Arrangement and press Duplicate independently.',
    differently: 'Keep just this clip selected. Repeat linked shares its notes and is not the independent variation in this step.' },
  'variation-change': { phase: 'variation', title: 'Change the new copy', target: 'piano-roll', scope: 'clip', requires: 'notes', acceptedActions: ['note-changed', 'note-deleted', 'drum-hit-changed'],
    idea: 'The independent copy has its own notes. Editing it does not change the original.',
    action: 'In the newly selected independent copy, move or resize one note.',
    differently: 'Dragging a note body changes pitch or timing; its right-edge handle changes length. You choose what to change, and Undo lets you reverse it.' },
  'layers-add': { phase: 'layers', title: 'Add another instrument', target: 'instrument-picker', scope: 'project', acceptedActions: ['track-add'],
    idea: 'Another instrument gets its own track. Adding it leaves your existing notes unchanged.',
    action: 'Open Sounds and press Add for one instrument you want.',
    differently: 'Preview only auditions the sound. Add creates its own track and part; choose any sound that fits your idea.' },
  'layers-edit': { phase: 'layers', title: 'Write the new layer', target: 'piano-roll', scope: 'clip', requires: 'clip', acceptedActions: ['note-changed', 'drum-hit-changed'],
    idea: 'The new layer is a separate part. You choose its notes and where they play.',
    action: 'Add a note in the new instrument’s piano grid, or a hit in its drum row.',
    differently: 'Check the selected track and part before editing. Play lets you hear the layers together; Mira does not choose notes for you.' },
  'finish-balance': { phase: 'finish', title: 'Balance the instruments', target: 'track-mixer', scope: 'track', requires: 'track', acceptedActions: ['mix-changed'],
    idea: 'Balance makes the important idea easy to hear without every instrument competing for attention.',
    action: 'Open Mixer and adjust the selected instrument’s volume while listening.',
    differently: 'If the new layer covers your melody, turn that layer down a little. Mira cannot hear the result; your ears decide.' },
  'finish-save': { phase: 'finish', title: 'Save the editable song', target: 'save-project', scope: 'project', acceptedActions: ['project-saved'],
    idea: 'Save keeps an editable copy in this browser so you can return to the song.',
    action: 'Press Save in the top toolbar.', differently: 'A browser save is local to this browser. The next step makes a downloadable copy you can keep elsewhere.' },
  'finish-export': { phase: 'finish', title: 'Download your song', target: 'export', scope: 'project', acceptedActions: ['project-exported'],
    idea: 'Choose the file that fits what you want to do next.',
    action: 'Open Export and download .nadi, WAV audio, or MIDI notes.',
    differently: '.nadi is an editable backup. WAV is audio to listen to or share. MIDI transfers notes to another music app, not the exact sounds or mix.' },
}

export function createFirstSongGuide(projectId: string, goal: string, startSequence = 0, trackId?: string | null, clipId?: string | null): FirstSongGuideSession {
  return { projectId, goal: goal.trim().slice(0, 160), currentStep: 'grid-draw', startSequence, trackId: trackId ?? undefined, clipId: clipId ?? undefined, completed: [], skipped: [], finished: false }
}
export interface ResolvedFirstSongStep extends StudioHelpAnswer {
  id: FirstSongStepId; phase: FirstSongPhase; title: string; ready: boolean; precondition: string | null
  completed: boolean; skipped: boolean; acceptedActions: readonly string[]; confirmationRequired: boolean
}
export function resolveFirstSongStep(session: FirstSongGuideSession, project: StudioProject, trackId?: string | null, clipId?: string | null, ui?: FirstSongGuideUi): ResolvedFirstSongStep {
  const step = FIRST_SONG_STEPS[session.currentStep]
  const track = project.tracks.find(item => item.id === session.trackId)
  const clip = project.clips.find(item => item.id === session.clipId && item.trackId === track?.id)
  const pattern = project.patterns.find(item => item.id === clip?.patternId)
  let precondition: string | null = null, target = step.target, action = step.action
  if (project.id !== session.projectId) precondition = 'This guide belongs to another project. Start a new guide for this song.'
  else if (step.requires === 'track' && !track) precondition = 'Choose an instrument track for this step.'
  else if (step.requires && step.requires !== 'track' && (!track || !clip)) precondition = 'Choose a placed clip in Arrangement for this step.'
  else if ((step.requires === 'melodic' || session.currentStep === 'develop-repeat') && track && !isMelodicSound(track.soundId)) precondition = 'Choose a piano or another melodic clip for this piano-grid step.'
  else if (step.requires === 'notes' && !pattern?.notes.length) precondition = 'Add a note or hit to this part first.'
  else if (step.scope === 'clip' && (trackId !== session.trackId || clipId !== session.clipId)) precondition = 'Return to this step’s chosen clip, or restart this step on your selected clip.'
  else if (step.scope === 'track' && trackId !== session.trackId) precondition = 'Return to this step’s chosen track, or restart this step on your selected track.'
  else if (session.currentStep === 'correct-undo' && ui?.canUndo === false) precondition = 'Make a musical edit first so there is an action to Undo.'
  if (precondition) {
    target = project.id !== session.projectId ? null : !track || !clip || trackId !== session.trackId || clipId !== session.clipId || ((step.requires === 'melodic' || session.currentStep === 'develop-repeat') && !isMelodicSound(track.soundId)) ? 'pattern-playlist' : track && !isMelodicSound(track.soundId) ? 'drum-timeline' : 'piano-roll'
    action = precondition
  } else if (track && !isMelodicSound(track.soundId) && ['correct-edit', 'variation-change', 'layers-edit'].includes(session.currentStep)) {
    target = 'drum-timeline'; action = 'Click an empty step in the selected instrument’s drum row to add a hit, or click a filled step to remove it.'
  } else if (session.currentStep === 'grid-draw' && ui?.activeTool && !['unknown', 'draw'].includes(ui.activeTool)) action = 'Choose Draw above the piano grid, then click an empty square to add a note.'
  return { ...step, id: session.currentStep, target, action, ready: !precondition && !session.finished, precondition,
    completed: session.completed.includes(session.currentStep), skipped: session.skipped.includes(session.currentStep), confirmationRequired: !!step.confirmationRequired }
}

/** Observations must be newer than entry into this step and match its bound destination. */
export function observeFirstSongGuide(session: FirstSongGuideSession, observed: StudioObservedAction | null | undefined, project: StudioProject): FirstSongGuideSession {
  const step = FIRST_SONG_STEPS[session.currentStep]
  if (session.finished || session.completed.includes(session.currentStep) || !observed || observed.sequence <= session.startSequence || observed.projectId !== session.projectId || project.id !== session.projectId || !step.acceptedActions.includes(observed.type)) return session
  if (step.scope !== 'project' && (!session.trackId || observed.trackId !== session.trackId)) return session
  if (step.scope === 'clip' && (!session.clipId || observed.clipId !== session.clipId)) return session
  // Check the destination still exists. A valid deletion may leave the part empty.
  const track = project.tracks.find(item => item.id === session.trackId)
  const clip = project.clips.find(item => item.id === session.clipId && item.trackId === session.trackId)
  if ((step.scope === 'track' && !track) || (step.scope === 'clip' && (!track || !clip))) return session
  if (step.requires === 'melodic' && track && !isMelodicSound(track.soundId)) return session
  const createdDestination = ['variation-duplicate', 'layers-add'].includes(session.currentStep) && observed.resultTrackId && observed.resultClipId && project.clips.some(item => item.id === observed.resultClipId && item.trackId === observed.resultTrackId)
    ? { trackId: observed.resultTrackId, clipId: observed.resultClipId } : undefined
  return { ...session, completed: [...session.completed, session.currentStep], nextDestination: createdDestination }
}
export function confirmFirstSongListening(session: FirstSongGuideSession): FirstSongGuideSession {
  return session.currentStep !== 'listen-confirm' || session.finished || session.completed.includes('listen-confirm') ? session : { ...session, completed: [...session.completed, 'listen-confirm'] }
}
/** Next only navigates after completion. Skip records an explicit omission, never success. */
export function advanceFirstSongGuide(session: FirstSongGuideSession, sequence: number, trackId?: string | null, clipId?: string | null, skip = false): FirstSongGuideSession {
  if (session.finished || (!skip && !session.completed.includes(session.currentStep))) return session
  const index = FIRST_SONG_STEP_IDS.indexOf(session.currentStep)
  const skipped = skip && !session.completed.includes(session.currentStep) && !session.skipped.includes(session.currentStep) ? [...session.skipped, session.currentStep] : session.skipped
  return { ...session, skipped, currentStep: FIRST_SONG_STEP_IDS[index + 1] ?? session.currentStep, finished: index === FIRST_SONG_STEP_IDS.length - 1,
    startSequence: sequence, trackId: session.nextDestination?.trackId ?? trackId ?? undefined, clipId: session.nextDestination?.clipId ?? clipId ?? undefined, nextDestination: undefined }
}
/** Explicitly bind the active step to a newly chosen destination; no progress is fabricated. */
export function retargetFirstSongGuide(session: FirstSongGuideSession, sequence: number, trackId?: string | null, clipId?: string | null): FirstSongGuideSession {
  const changed = session.trackId !== (trackId ?? undefined) || session.clipId !== (clipId ?? undefined)
  return { ...session, startSequence: sequence, trackId: trackId ?? undefined, clipId: clipId ?? undefined,
    completed: changed ? session.completed.filter(id => id !== session.currentStep) : session.completed, nextDestination: changed ? undefined : session.nextDestination }
}
