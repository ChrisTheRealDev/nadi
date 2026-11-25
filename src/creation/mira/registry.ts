import { exactObject, helpTopics, type CreationMiraRequest, type CreationMiraResponse, type CreationMiraSelection, type CreationWorkspace, type HelpAction, type HelpTopic } from './contracts'
import { TICKS_PER_BEAT, TICKS_PER_BAR } from '../model'
export interface HelpStep {
  id: string; target?: string; label: string; idea: string; action: string; differently: string
  observes?: HelpAction; context?: 'piano' | 'drums' | 'selected-note'
}
export const helpSteps: Record<string, HelpStep> = {
  'start-play': { id: 'start-play', target: 'piano-keys', label: 'Piano keys', idea: 'You can start with one sound you choose. There is no required lesson or right tune to make.', action: 'If you like, press and release one of the Piano keys. Choose any key yourself; you do not need to press Record yet.', differently: 'Try one key just to explore. You can stop there, try another, or ask about placing a note in Piano roll. Nothing is recorded unless you choose to record.', observes: 'note-played', context: 'piano' },
  'term-tick': { id: 'term-tick', label: 'Tick', idea: `A beat is the steady pulse you can count. A tick is a tiny fraction of a beat: NADI uses ${TICKS_PER_BEAT} ticks for one beat, so half a beat is ${TICKS_PER_BEAT / 2} ticks and a quarter beat is ${TICKS_PER_BEAT / 4} ticks.`, action: 'Selected note shows Position as bar and beat, and Length in beats. The smaller tick values preserve exact timing between the beat lines.', differently: `Think of one beat divided into ${TICKS_PER_BEAT} small time marks. A length of 1 beat is ${TICKS_PER_BEAT} ticks. Bar 2 begins at tick ${TICKS_PER_BAR}.` },
  'term-beat': { id: 'term-beat', label: 'Beat', idea: 'A beat is the steady pulse you might tap your foot to. Tempo sets how quickly that pulse goes; it is not the same as a drum hit.', action: 'NADI groups four beats into one bar. In Channel rack, each square is a quarter of a beat, so four squares fill one beat.', differently: `Count “1, 2, 3, 4” evenly: each count is one beat. One beat is ${TICKS_PER_BEAT} ticks in the note editor.` },
  'term-bar': { id: 'term-bar', label: 'Bar', idea: 'A bar is a group of beats. In this NADI project, each bar contains four beats: count “1, 2, 3, 4”, then start the next bar.', action: 'Use Go to bar above the editor, or choose a numbered bar in Playlist, to view that part of your music. Open Playlist from the toolbar to change the project length with Bars; this does not add notes for you.', differently: `A bar is one four-beat section of time, not one note. It lasts ${TICKS_PER_BAR} ticks here. An empty bar is silence unless a longer note continues through it.` },
  'term-velocity': { id: 'term-velocity', label: 'Velocity', idea: 'Velocity means how strongly one note is played, not how fast it goes. A higher value usually makes that note louder; a lower value makes it softer.', action: 'Velocity in Selected note changes one note, from 1 to 127. Piano volume in Mixer changes the whole piano track instead.', differently: 'Think of pressing a piano key gently or firmly. Velocity is that strength for a single note; tempo is the speed of the music.' },
  'sound-clarify': { id: 'sound-clarify', label: 'What do you mean by sound?', idea: 'Do you mean a different instrument, a higher or lower note (pitch), louder or softer volume, or that you cannot hear anything?', action: 'Tell me which one. Sounds opens the Piano, Kick, Snare or Hi-hat editor; it does not replace a selected note with a new instrument. Extra instruments and sample imports are not available yet.', differently: 'Try asking “How do I change pitch?”, “How do I change volume?” or “I cannot hear anything”. For instrument choice, the four built-in sounds are the current choices.' },
  'sound-test': { id: 'sound-test', target: 'sound-status', label: 'Test sound', idea: 'The browser needs your permission to start sound. Check your speakers or headphones too.', action: 'Press Test sound and listen for a piano note.', differently: 'Test sound wakes up the browser audio. If you hear nothing, check the device volume and output.', observes: 'sound-tested' },
  'piano-editor': { id: 'piano-editor', target: 'editor-piano', label: 'Piano roll', idea: 'Piano notes live in the piano editor.', action: 'Choose Piano roll.', differently: 'Switch to Piano roll to see the note grid.' },
  'chord-play': { id: 'chord-play', target: 'piano-keys', label: 'Piano keys', idea: 'A chord is a few notes sounding together. Which notes and feeling you choose are yours.', action: 'Try your own notes with your MIDI keyboard or Piano keys. Record can remember your performance.', differently: 'Use Piano keys to explore your own idea. I can explain the controls, but I do not compose or play a musical part for you.', observes: 'note-played', context: 'piano' },
  'chord-record': { id: 'chord-record', target: 'record', label: 'Record', idea: 'Studio recording remembers when you play, without snapping timing. Idea Pad can capture without a tempo or count-in.', action: 'Press Record for the studio count-in, or open Browser → Idea Pad to capture freely.', differently: 'Record gives you four count-in clicks. Idea Pad records immediately at your own pace.', observes: 'record-started' },
  'note-select': { id: 'note-select', target: 'piano-roll', label: 'Piano roll', idea: 'Each rectangle is one note: its height is pitch, and its width is length.', action: 'Click a note in Piano roll to select it. If the bar is empty, click a grid square to place one.', differently: 'Click a rectangle you want to change. You can scroll up or down for other pitches.', context: 'piano' },
  'note-change': { id: 'note-change', target: 'selected-note', label: 'Selected note', idea: 'The inspector changes only your selected note.', action: 'Change Pitch, Position (Bar/Beat), Length (beats) or Strength in Selected note. Advanced shows exact ticks.', differently: 'Pitch changes how high it sounds; Position changes when; Length changes how long; Strength changes how firmly it plays.', observes: 'note-changed', context: 'selected-note' },
  'note-delete': { id: 'note-delete', target: 'delete-notes', label: 'Delete selected', idea: 'Delete removes only the notes you selected. Other notes, including overlapping notes, stay in your project.', action: 'Check the selected notes, then choose Delete selected. Undo can restore the deletion.', differently: 'Select the rectangles you want gone, then use Delete selected. You can also press Delete or Backspace while the note editor has focus.', context: 'selected-note' },
  'note-move': { id: 'note-move', target: 'note-tools', label: 'Move selected notes', idea: 'Moving changes when your selected notes begin without changing their pitch or length.', action: 'Choose Select, then drag a selected note left or right. Position (Bar/Beat) reports the result.', differently: 'Select the note rectangles first, then drag them earlier or later. Snap controls whether the move follows the grid; recorded timing otherwise stays exact.', observes: 'note-changed', context: 'selected-note' },
  'note-resize': { id: 'note-resize', target: 'selected-note', label: 'Change note length', idea: 'Length tells you how many beats the selected note lasts.', action: 'Change Length (beats) in Selected note, or drag a selected note’s end. This changes only the selected note or notes.', differently: 'A longer note continues for more beats; a shorter note releases sooner. Position does not change when you resize from the end.', observes: 'note-changed', context: 'selected-note' },
  'note-listen': { id: 'note-listen', target: 'preview-notes', label: 'Preview note edits', idea: 'Preview note edits lets NADI sound a note when you add it. It does not play, generate or change any notes for you.', action: 'Turn Preview note edits on, then add a note you choose. Removing a note stays silent.', differently: 'Use Preview note edits when you want quick feedback while drawing. Use Play when you want to hear the whole project.', context: 'piano' },
  'drum-editor': { id: 'drum-editor', target: 'editor-drums', label: 'Channel rack', idea: 'Each drum row is a different sound.', action: 'Choose Channel rack.', differently: 'Switch to Channel rack to see Kick, Snare and Hi-hat.' },
  'drum-change': { id: 'drum-change', target: 'drums', label: 'Drum grid', idea: 'A lit square is one drum hit. The squares run from left to right in time; drums are optional.', action: 'Click a square where you want a hit in the Kick, Snare or Hi-hat row.', differently: 'Click an empty square to add your chosen hit. Click a lit square to remove it.', observes: 'drum-hit-changed', context: 'drums' },
  'repeat-bar': { id: 'repeat-bar', target: 'repeat-next-bar', label: 'Repeat in next bar', idea: 'Repeating puts an independent copy directly after the selected bar. Changing the copy does not change the original.', action: 'Choose your bar with Go to bar above the editor or the numbered Playlist, check the shown destination, then press Repeat in next bar. An occupied destination is not overwritten.', differently: 'The copy keeps full note lengths. If its destination conflicts with existing notes, repetition is refused; your notes stay unchanged. Duplicate bar to end is a separate option that appends after all project bars.', observes: 'bar-duplicated' },
  'mix-piano': { id: 'mix-piano', target: 'mixer-piano', label: 'Piano volume', idea: 'Volume balances one instrument against the others. Mute silences it without deleting notes.', action: 'Adjust Piano volume, or another instrument’s Volume or Mute, then press Play to listen.', differently: 'Lower a loud instrument rather than deleting its notes. These settings also affect the WAV download.', observes: 'mix-changed' },
  'save-project': { id: 'save-project', target: 'save', label: 'Save', idea: 'Save keeps a reopenable project. A .nadi download is a portable backup.', action: 'Press Save to save the project.', differently: 'Save keeps your notes and mixer settings. Export offers a .nadi copy you can reopen.', observes: 'project-saved' },
  'export-project': { id: 'export-project', target: 'export', label: 'Export', idea: 'WAV is sound; MIDI is musical notes, not NADI sounds or mixer settings. .nadi preserves the project.', action: 'Open Export and choose .nadi, WAV or MIDI.', differently: 'Choose WAV to listen elsewhere, MIDI to transfer notes, or .nadi to continue in NADI. FL Studio .flp is not supported.', observes: 'project-exported' },
}
export function classifyQuestion(question: string): HelpTopic | null {
  const q = question.toLowerCase()
  if (/\b(plugins?|vst|lyrics)\b/.test(q) || /\b(import|upload|load)\b.*\b(samples?|mp3|audio|wav)\b/.test(q)) return null
  if (/\b(where (?:do i |should i |can i |to )?start|how (?:do i |can i |to )?(?:get started|start)|getting started|don[’']?t know (?:where|how) to (?:start|begin))\b/.test(q)) return 'start'
  const termQuestion = /\b(?:what (?:is|are|does)|what[’']s|explain|meaning|means|define)\b/.test(q)
  if (termQuestion) {
    for (const term of ['tick', 'beat', 'bar', 'velocity'] as const) {
      if (new RegExp(`\\b${term}${term === 'velocity' ? '' : 's?'}\\b`).test(q)) return term
    }
  }
  if (/\b(delete|remove|erase|get rid of)\b.*\b(notes?|piano notes?)\b|\b(notes?|piano notes?)\b.*\b(delete|remove|erase)\b/.test(q)) return 'note-delete'
  if (/\b(move|shift|nudge)\b.*\b(notes?|piano notes?)\b|\b(notes?|piano notes?)\b.*\b(move|shift|nudge|earlier|later|left|right)\b/.test(q)) return 'note-move'
  if (/\b(resize|shorten|lengthen)\b.*\b(notes?|piano notes?)\b|\b(make|change)\b.*\b(notes?|piano notes?)\b.*\b(longer|shorter)\b|\b(notes?|piano notes?)\b.*\b(resize|shorten|lengthen|length|duration)\b/.test(q)) return 'note-resize'
  if (/\b(listen to|preview|audition|hear)\b.*\b(notes?|note edits?|changes?)\b|\b(notes?|note edits?)\b.*\b(listen|preview|audition|hear)\b/.test(q)) return 'note-listen'
  if (/\b(change|different|replace|choose|switch)\b/.test(q) && /\b(sound|instrument|tone)\b/.test(q) && !/\b(pitch|volume|mute|velocity|hear|silent)\b/.test(q)) return 'sound-choice'
  if (/\b(volume|mute|balance|mix|mixer|loud|quiet)\b/.test(q)) return 'mix'
  if (/\b(pitch|velocity)\b/.test(q)) return 'note'
  if (/\b(sound|hear|silent|audio|speaker|headphone)\b/.test(q)) return 'sound'
  if (/\b(chord|record|recording|midi keyboard|play piano)\b/.test(q)) return 'chord'
  if (/\b(note|pitch|velocity|length|timing|piano roll)\b/.test(q)) return 'note'
  if (/\b(drum|drums|kick|snare|hi.?hat|beat|channel rack)\b/.test(q)) return 'drums'
  if (/\b(repeat|duplicate|passage|longer|copy|arrange|playlist)\b/.test(q)) return 'repeat'
  if (/\b(save|export|download|reopen|wav|midi|flp)\b/.test(q)) return 'export'
  return null
}
export function stepsForTopic(topic: HelpTopic, w: CreationWorkspace): string[] {
  switch (topic) {
    case 'start': return [...(w.editor === 'piano' ? [] : ['piano-editor']), 'start-play']
    case 'tick': return ['term-tick']
    case 'beat': return ['term-beat']
    case 'bar': return ['term-bar']
    case 'velocity': return ['term-velocity']
    case 'sound-choice': return ['sound-clarify']
    case 'sound': return ['sound-test']
    case 'chord': return [...(w.editor === 'piano' ? [] : ['piano-editor']), 'chord-play', 'chord-record']
    case 'note': return [...(w.editor === 'piano' ? [] : ['piano-editor']), ...(w.selectedNote ? [] : ['note-select']), 'note-change']
    case 'note-delete': return [...(w.editor === 'piano' ? [] : ['piano-editor']), ...(w.selectedNote ? [] : ['note-select']), 'note-delete']
    case 'note-move': return [...(w.editor === 'piano' ? [] : ['piano-editor']), ...(w.selectedNote ? [] : ['note-select']), 'note-move']
    case 'note-resize': return [...(w.editor === 'piano' ? [] : ['piano-editor']), ...(w.selectedNote ? [] : ['note-select']), 'note-resize']
    case 'note-listen': return [...(w.editor === 'piano' ? [] : ['piano-editor']), 'note-listen']
    case 'drums': return [...(w.editor === 'drums' ? [] : ['drum-editor']), 'drum-change']
    case 'repeat': return ['repeat-bar']
    case 'mix': return ['mix-piano']
    case 'export': return ['save-project', 'export-project']
  }
}
export function stepCompleted(step: HelpStep, w: CreationWorkspace, observedAction: { sequence: number; type: HelpAction } | null, baseline: number): boolean {
  const actionDone = observedAction !== null && observedAction.sequence > baseline && observedAction.type === step.observes
  const contextDone = (step.id === 'piano-editor' && w.editor === 'piano') || (step.id === 'drum-editor' && w.editor === 'drums') || (step.id === 'note-select' && w.selectedNote)
  return actionDone || contextDone
}
export function validateSelection(value: unknown, w: CreationWorkspace): value is CreationMiraSelection {
  if (!exactObject(value, ['topic', 'stepIds']) || !Array.isArray(value.stepIds)) return false
  if (value.topic === null) return value.stepIds.length === 0
  if (!helpTopics.includes(value.topic as HelpTopic)) return false
  return JSON.stringify(value.stepIds) === JSON.stringify(stepsForTopic(value.topic as HelpTopic, w))
}
export function targetInContext(step: HelpStep, w: CreationWorkspace): boolean {
  return step.context === 'selected-note' ? w.editor === 'piano' && w.selectedNote : step.context === 'piano' ? w.editor === 'piano' : step.context === 'drums' ? w.editor === 'drums' && w.visibleDrumRows.length > 0 : true
}
export function authoredResponse(request: CreationMiraRequest, reason = 'local-help', transmission: CreationMiraResponse['transmission'] = 'not-sent'): CreationMiraResponse {
  const topic = classifyQuestion(request.question)
  return { version: 1, projectId: request.workspace.projectId, revision: request.workspace.revision, source: 'authored', reason, transmission, selection: { topic, stepIds: topic ? stepsForTopic(topic, request.workspace) : [] } }
}
export function validateCreationResponse(value: unknown, w: CreationWorkspace): value is CreationMiraResponse {
  return exactObject(value, ['version', 'projectId', 'revision', 'source', 'reason', 'selection', 'transmission']) && value.version === 1 && value.projectId === w.projectId && value.revision === w.revision && typeof value.source === 'string' && ['authored', 'live'].includes(value.source) && typeof value.reason === 'string' && value.reason.length < 100 && typeof value.transmission === 'string' && ['sent', 'not-sent'].includes(value.transmission) && validateSelection(value.selection, w)
}
