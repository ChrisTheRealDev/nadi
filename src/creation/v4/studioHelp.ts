import { isMelodicSound, type StudioProject } from './model'

export const STUDIO_HELP_TOPICS = {
  add: 'Add an instrument', sound: 'Change a sound', record: 'Record to a track',
  independent: 'Repeat independently', linked: 'Understand linked copies', arrange: 'Arrange clips',
  notes: 'Draw or change notes', delete: 'Delete a mistake', drums: 'Add drums',
  'select-chord': 'Select a chord', 'move-notes': 'Move selected notes', 'resize-notes': 'Lengthen a note',
  volume: 'Balance volume', listen: 'Hear my music', save: 'Save or download',
  pan: 'Place sound left or right', space: 'Add Space', expression: 'Shape a swell or fade',
  undo: 'Undo an action', 'delete-note': 'Delete notes', 'delete-clip': 'Delete a clip',
  'delete-track': 'Delete a track', reopen: 'Reopen a project', 'missing-sound': 'Missing instrument sound', unlink: 'Unlink this copy',
} as const
export type StudioHelpTopic = keyof typeof STUDIO_HELP_TOPICS
export interface StudioHelpAnswer { idea: string; action: string; differently: string; target: string | null }
export interface StudioHelpUiContext { noteSelection?: 'unknown' | 'none' | 'one' | 'multiple' }
/** Specific local fallback for the reported chord-selection obstacle, never presented as AI. */
export function studioQuestionAnswer(question: string, topic: StudioHelpTopic, project: StudioProject, trackId?: string | null, clipId?: string | null, ui?: StudioHelpUiContext): StudioHelpAnswer {
  const base = studioHelpAnswer(topic, project, trackId, clipId)
  if (['select-chord', 'move-notes', 'resize-notes'].includes(topic) && ['select-chord', 'note-body', 'note-resize'].includes(base.target ?? '') && ui?.noteSelection !== 'one' && ui?.noteSelection !== 'multiple') return {
    idea: 'Choose which note you want to work with first. Selecting a note does not change its music.',
    action: 'Click one existing note in the piano grid. If the part is empty, draw one note first.',
    differently: 'A note is a coloured block. Click its middle once; the selection controls will appear above the grid.', target: 'piano-roll',
  }
  if (topic === 'notes' && base.target === 'piano-roll' && /\b(chord|chords|multiple|several|together|select)\b/i.test(question) && /\b(move|moving|drag|select|selection|together)\b/i.test(question)) return {
    idea: 'A chord is several notes sounding together. Select the group first, then drag any selected note to move them together; their spacing stays the same.',
    action: 'Click one note, then press Select chord above the piano grid (also available under More). Check the selection count before dragging a note body.',
    differently: 'Use Select and drag a box around the three notes, or Shift-click each note. Select all chooses every note in this part. Drag the middle of a selected block, not its right-edge length handle. Undo reverses the whole move.',
    target: ui && ui.noteSelection !== 'one' && ui.noteSelection !== 'multiple' ? 'piano-roll' : 'select-chord',
  }
  return base
}
export function unsupportedStudioQuestion(question: string): boolean {
  return /\b(plugins?|vst|lyrics)\b/i.test(question) || /\b(import|upload)\b.*\b(samples?|audio|mp3|wav)\b/i.test(question)
}

const instrumentWords = /\b(instruments?|bass|strings|guitar|pad|piano|horn|trumpet|brass|oboe|reed|vocal air|bronze resonance|violin|viola|cello|flute|clarinet|bassoon|trombone|tuba|harp|timpani)\b/i
export function isAmbiguousInstrumentChange(question: string): boolean {
  return instrumentWords.test(question) && /\b(change|switch|replace)\b/i.test(question)
    && /\b(thing|stuff|something)\b/i.test(question)
    && !/\b(volume|mute|notes?|pitch|length|sound|with)\b/i.test(question)
}
/** Clarification has no target: do not assume adding a layer means replacing an existing sound. */
export function studioQuestionClarification(question: string): string | null {
  if (isAmbiguousInstrumentChange(question)) return 'Do you mean the instrument’s sound, its notes, or its volume?'
  if (requestsMusicalContent(question)) return 'I can explain the technique and help you use NADI, but I do not create melodies, chord progressions or drum patterns. What would you like help doing yourself?'
  if (instrumentWords.test(question) && !routeStudioQuestion(question) && !/\b(what is|what are|explain|difference|why)\b/i.test(question)) return 'Do you want to add another instrument track, change an existing track’s sound, or fix a sound you cannot hear?'
  return null
}
function requestsMusicalContent(question: string): boolean {
  return /\b(generate|compose|write|give|suggest|create)\b.*\b(tune|melody|song|chord progression|drum pattern|variation)\b/i.test(question)
    || /\b(give|suggest)\b.*\b(notes?|chords?|beats?)\b/i.test(question)
    || /\bmake (me|us)\b.*\b(tune|melody|song|beat|chords?)\b/i.test(question)
    || /\b(how (could|should) (this|it) continue|what notes? (should|could) (i|we) (play|use|add))\b/i.test(question)
}

/** Bounded authored routing, not an AI response or a claim to understand arbitrary requests. */
export function routeStudioQuestion(question: string): StudioHelpTopic | null {
  const text = question.trim().toLowerCase()
  if (isAmbiguousInstrumentChange(question)) return null
  if (unsupportedStudioQuestion(text) || requestsMusicalContent(text)) return null
  if (/\b(undo|undoing|revert|bring back)\b/.test(text)) return 'undo'
  if (/\b(unlink|make independent|separate (this|the|linked) cop)/.test(text)) return 'unlink'
  if (/\b(reopen|re-open|open.*project|load.*project|restore.*project)\b/.test(text)) return 'reopen'
  if (/\b(missing|failed|unavailable|retry|loading)\b.*\b(sound|sample|instrument)|\b(sound|sample|instrument)\b.*\b(missing|failed|unavailable|loading)\b/.test(text)) return 'missing-sound'
  if (/\b(delete|erase|remove)\b/.test(text)) {
    const objects = [['track', 'delete-track'], ['clip', 'delete-clip'], ['note', 'delete-note'], ['hit', 'delete-note']] as const
    const matches = [...new Set(objects.filter(([word]) => new RegExp(`\\b${word}s?\\b`).test(text)).map(([, topic]) => topic))]
    return matches.length === 1 ? matches[0] : 'delete'
  }
  if (/\b(independent|separate cop)/.test(text)) return 'independent'
  if (/\blink(ed)?\b/.test(text)) return 'linked'
  if (/\b(save|download|export|midi file|wav|nadi file)\b/.test(text)) return 'save'
  if (/\bmistake\b/.test(text)) return 'delete'
  if (/\b(select|selection)\b.*\b(chord|notes|together)|\b(chord|notes)\b.*\b(select|selection)\b/.test(text)) return 'select-chord'
  if (/\b(resize|lengthen|shorten|duration|longer|shorter)\b.*\b(note|notes|chord)|\b(note|notes|chord)\b.*\b(resize|lengthen|shorten|duration|longer|shorter)\b/.test(text)) return 'resize-notes'
  if (/\b(move|moving|drag|transpose)\b.*\b(note|notes|chord)|\b(note|notes|chord)\b.*\b(move|moving|drag|transpose)\b/.test(text)) return 'move-notes'
  if (/\b(record|recording|destination|midi keyboard)\b/.test(text)) return 'record'
  if (/\b(pan|panning|stereo position)\b/.test(text) || /\b(sound|instrument|track)\b.*\b(left|right)\b/.test(text)) return 'pan'
  if (/\b(reverb|space|hall)\b/.test(text)) return 'space'
  if (/\b(expression|swell|swells|fade|fading)\b/.test(text)) return 'expression'
  if (/\b(volume|mute|mix|balance|loud|quiet)\b/.test(text)) return 'volume'
  // Hearing failures take priority over instrument names: “cannot hear bass” is not Add bass.
  if (/\b(hear|listen|silent|silence|playback|no sound|loop)\b/.test(text)) return 'listen'
  if (/\b(what is|what are|explain|difference between)\b/.test(text)) return null
  if (/\b(drum|drums|kick|snare|hi.?hat)\b/.test(text) && /\b(add|place|draw|edit|change|make|use)\b/.test(text)) return 'drums'
  if (/\b(repeat|copy|paste|duplicate|arrange|arrangement|clip|clips|pattern)\b/.test(text)) return 'arrange'
  if (/\b(change|switch|replace)\b/.test(text) && (instrumentWords.test(text) || /\bsound\b/.test(text))) return 'sound'
  if (instrumentWords.test(text) && /\b(add|another|new track|underneath|layer)\b/.test(text)) return 'add'
  if (/\bsound\b/.test(text)) return 'listen'
  if (/\b(note|notes|chord|chords|draw|pitch|resize|lengthen|melody|start|begin)\b/.test(text)) return 'notes'
  return null
}

export function studioHelpAnswer(topic: StudioHelpTopic, project: StudioProject, selectedTrackId?: string | null, selectedClipId?: string | null): StudioHelpAnswer {
  const track = project.tracks.find(item => item.id === selectedTrackId)
  const clip = project.clips.find(item => item.id === selectedClipId && item.trackId === selectedTrackId)
  const pattern = project.patterns.find(item => item.id === clip?.patternId)
  const choose = { idea: 'No problem. First we need to choose which part you want to work on.', action: 'Select a clip in Arrangement.', differently: 'A clip is one block of music in your song. Selecting it tells the editor which notes you mean.', target: 'pattern-playlist' }
  switch (topic) {
    case 'undo': return { idea: 'Undo brings back the previous musical edit. It does not erase anything else, and your captured originals stay safe.', action: 'Press Undo in the top toolbar.', differently: 'If your last edit was a mistake, Undo reverses it. You can also use Ctrl+Z while not typing. Reloading clears session Undo.', target: 'undo' }
    case 'delete': return { idea: 'What would you like to remove: notes, one clip in the song, or an entire instrument track?', action: 'Choose Delete notes, Delete a clip or Delete a track under Things I can help with.', differently: 'A note is one sound; a clip is a placed part; a track contains an instrument’s parts. They are different kinds of deletion, so let’s choose which one you mean.', target: null }
    case 'delete-clip': return !clip ? choose : { idea: 'Deleting a clip removes only that placement in the song. Its reusable part and other placements remain.', action: 'Check the selected clip in Arrangement, then press Delete clip.', differently: 'The block disappears from this position; linked copies elsewhere are not deleted. Undo restores an accidental deletion.', target: 'pattern-playlist' }
    case 'delete-track': return !track ? choose : { idea: `Deleting “${track.name}” removes its parts and clips. Hide track only hides the lane and keeps its music.`, action: 'Open Track settings and choose Delete track. Check the confirmation before accepting.', differently: 'Use Hide if you only need more space. Delete track removes that whole instrument layer; Undo can restore it.', target: 'track-settings' }
    case 'reopen': return { idea: 'You can reopen a browser save or import an editable .nadi backup. A WAV file is audio, not the editable NADI project.', action: 'Open Project, then choose Open saved project or Open .nadi / recovery JSON.', differently: 'Saving and reopening are separate actions. Open saved project lists this browser’s saves; Open .nadi / recovery JSON loads a portable project file.', target: 'open-projects' }
    case 'missing-sound': return { idea: 'Sampled sounds need their local audio files to finish loading. Missing files never erase your notes, and MIDI download remains available.', action: 'Open Sounds and press Retry beside the failed sound’s name.', differently: 'Check the loading/error label. Retry fetches the same instrument files, not a substitute sound. I cannot hear your headphones or verify their output.', target: 'instrument-picker' }
    case 'unlink': return !clip ? choose : project.clips.filter(item => item.patternId === clip.patternId).length <= 1 ? { idea: 'This part already has only one placement; its edits do not affect another clip.', action: 'You can edit this part directly, or use Duplicate independently to make a new variation.', differently: 'There are no linked copies to separate. Make independent is only needed when multiple placements share this part.', target: 'pattern-context' } : { idea: 'Make independent gives only this selected clip its own notes or hits. Other linked clips keep their shared part.', action: `Press Make independent for the selected ${isMelodicSound(track!.soundId) ? 'Notes' : 'Drums'} clip.`, differently: 'Unlike Duplicate independently, this does not add another block. It separates the existing selected occurrence so you can change it safely.', target: 'make-independent' }
    case 'add': return { idea: 'A track is one instrument layer. You can add a new layer without changing your existing notes.', action: 'Open Sounds.', differently: 'Think of adding another player to your band. Each new track has its own notes and volume. The preview button only lets you listen; Add creates the track.', target: 'instrument-picker' }
    case 'sound': return track ? { idea: `You can give “${track.name}” another sound while keeping its notes.`, action: 'Open Track settings to find Sound.', differently: 'The notes say what to play. Sound chooses the voice playing them. Changing Sound is different from adding a new track.', target: 'track-settings' } : choose
    case 'record': return !track || !clip ? choose : !isMelodicSound(track.soundId) ? { idea: 'This is a drum track. Keyboard recording needs a melodic destination.', action: 'Choose a melodic instrument track in Track, such as piano or brass.', differently: 'For drums, place hits in the drum grid. For a keyboard performance, choose the instrument that should play your notes first.', target: 'track-controls' } : { idea: `Your keyboard will play “${track.name}”. The selected part is “${pattern?.name ?? 'this part'}”. Timing is kept as you play it.`, action: 'Check Record to before pressing Record.', differently: 'Recording is like writing into the selected musical notebook. Make sure the name beside Record to is the instrument you want. Play after the count-in, then use Keep recording.', target: 'record-destination' }
    case 'independent': return !clip ? choose : { idea: 'An independent repeat can be changed without changing the first version.', action: 'Use Duplicate independently for a separate copy of the selected clip.', differently: 'This makes a new musical part with its own notes. Ordinary duplication and copy/paste do not link your edits.', target: 'duplicate-independent' }
    case 'linked': return !clip ? choose : { idea: `${project.clips.filter(item => item.patternId === clip.patternId).length} placement(s) currently use “${pattern?.name}”. Linked placements share the same notes.`, action: 'Use Repeat linked only when you want later note edits to affect both copies.', differently: 'Independent copies are separate notebooks. Linked copies are two views of the same notebook. If a part is linked, Make independent separates only the selected placement.', target: 'repeat-linked' }
    case 'arrange': return !clip ? choose : { idea: 'Arrangement places musical parts in time. Moving a clip changes when it plays, not the notes inside it.', action: 'Drag the selected clip along its lane.', differently: 'Imagine sliding a block of music left or right on a timeline. Snap controls the landing points. Clip start is the precise alternative to dragging, and overlapping clips play together.', target: 'pattern-playlist' }
    case 'notes': return !clip || !track ? choose : !isMelodicSound(track.soundId) ? studioHelpAnswer('drums', project, selectedTrackId, selectedClipId) : { idea: 'The piano grid goes up for higher notes and right for later notes. You can compose by listening, one note at a time.', action: 'With Draw selected, click an empty square in the piano grid.', differently: 'A note is a small block: its height is the pitch, its left edge is when it starts, and its width is how long it lasts. Drag the block to move it; drag its right edge to lengthen it.', target: 'piano-roll' }
    case 'select-chord': return !clip || !track ? choose : !isMelodicSound(track.soundId) ? studioHelpAnswer('drums', project, selectedTrackId, selectedClipId) : { idea: 'A chord is several notes sounding together. Select the group before moving it.', action: 'Press Select chord above the grid, then check how many notes are selected.', differently: 'Select chord groups notes starting within one eighth of a beat of your chosen note. For a different group, use Select and drag a box, or Shift-click each note.', target: 'select-chord' }
    case 'move-notes': return !clip || !track ? choose : !isMelodicSound(track.soundId) ? studioHelpAnswer('drums', project, selectedTrackId, selectedClipId) : { idea: 'Moving up or down changes pitch; moving left or right changes when notes play. A selected group keeps its spacing.', action: 'Drag the middle of a selected note block. To move a whole chord, use Select chord first and check the selection count.', differently: 'Grab the body of the block, not its right-edge handle. All selected blocks move together. Undo reverses the completed move.', target: 'note-body' }
    case 'resize-notes': return !clip || !track ? choose : !isMelodicSound(track.soundId) ? studioHelpAnswer('drums', project, selectedTrackId, selectedClipId) : { idea: 'A note’s width is how long it lasts. A longer note holds its sound for more beats.', action: 'Drag the selected note’s right-edge handle to the right to lengthen it, or left to shorten it.', differently: 'The small handle at the right end changes this note’s length. Dragging its middle moves it instead. To give all selected notes the same length, use their group Length control.', target: 'note-resize' }
    case 'delete-note': return !clip ? choose : { idea: 'Mistakes are editable. Deleting a note does not require clearing the whole part.', action: isMelodicSound(track!.soundId) ? 'Right-click the note you want to remove.' : 'Click an existing drum hit to remove it.', differently: 'You can also use Erase. In the piano roll, Select plus Delete selected removes a group. Undo brings an accidental deletion back.', target: isMelodicSound(track!.soundId) ? 'piano-roll' : 'drum-timeline' }
    case 'drums': return !track || isMelodicSound(track.soundId) ? { idea: 'Drums are separate instrument tracks, so your melody stays untouched.', action: 'Open Sounds and look for Drums.', differently: 'Kick, Snare and Hi-hat each provide one kind of drum hit. Add the sound you want, then select its clip to edit hits.', target: 'instrument-picker' } : !clip ? choose : { idea: `You are editing “${track.name}”. Each filled step is one hit.`, action: 'Click an empty step to add a drum hit.', differently: 'Clicking a filled hit removes it. The left-to-right grid shows when each hit plays. Existing off-grid hits keep their original timing.', target: 'drum-timeline' }
    case 'volume': return { idea: 'Balancing means deciding which instruments should be easier to hear. Muting silences a track without deleting music.', action: 'Adjust one track’s volume in the mixer.', differently: 'Start by turning the loudest instrument down a little. Volume and Mute affect listening and WAV, while MIDI still keeps the musical notes.', target: 'track-mixer' }
    case 'pan': return !track ? choose : { idea: 'Pan places an instrument between the left and right speakers. It does not change the notes or when they play.', action: 'In Mixer, adjust Pan for your selected track.', differently: 'Centre keeps the sound in the middle. Move Pan left or right to choose its position; Undo reverses a completed adjustment.', target: 'track-pan' }
    case 'space': return !track ? choose : { idea: 'Space adds a shared hall-like reverberation: a lingering sound after the direct note. It does not change your notes.', action: 'In Mixer, adjust Space for your selected track.', differently: 'Space is the amount sent into the hall. Bypass Space lets you compare without erasing the setting. WAV includes the effect; MIDI does not reproduce it.', target: 'track-space' }
    case 'expression': return !track ? choose : { idea: 'Expression changes a track’s loudness over song time, including while a note is held. You choose the shape of the swell or fade.', action: 'In Mixer, open Expression for your selected track.', differently: 'The horizontal direction is song time; the vertical direction is gain. Draw points to shape a gradual change. An empty lane leaves the track at its normal level; this does not create notes.', target: 'track-expression' }
    case 'listen': return { idea: 'Let’s first check that the browser and your output device can make a sound. I cannot hear your audio or tell whether it is working.', action: 'Press Test sound.', differently: 'If you cannot hear the test, check your speakers or headphones, browser volume and the selected track’s Mute/volume. Missing sampled sounds show a Retry option. Play song listens to the arrangement; Preview notes auditions edits.', target: 'sound-status' }
    case 'save': return { idea: 'Save keeps the project in this browser. A .nadi download is your editable portable backup.', action: 'Open Export to choose NADI project (.nadi), Audio (.wav) or MIDI notes (.mid).', differently: '.nadi reopens the parts, clips and settings in NADI. WAV is finished audio. MIDI carries notes to another music app, not NADI’s exact sounds or mixer. Native FL Studio .flp export is not supported.', target: 'export' }
  }
}

export const STUDIO_OBSERVES: Record<StudioHelpTopic, readonly string[]> = {
  add: ['track-add'], sound: ['sound-changed'], record: ['record-started'], independent: ['clip-duplicated-independent', 'clips-duplicate'], linked: ['clip-repeated-linked'],
  arrange: ['clip-move', 'clips-move'], notes: ['note-changed'], delete: [], drums: ['drum-hit-changed'], volume: ['mix-changed'],
  pan: ['pan-changed'], space: ['space-changed'], expression: ['expression-changed'],
  'select-chord': ['chord-selected'], 'move-notes': ['notes-moved'], 'resize-notes': ['notes-resized'],
  listen: ['sound-tested'], save: ['project-saved', 'project-exported'], undo: ['undo'], 'delete-note': ['note-deleted'],
  'delete-clip': ['clip-delete', 'clips-delete'], 'delete-track': ['track-delete'], reopen: ['project-opened'], 'missing-sound': ['sound-retried'], unlink: ['clip-independent'],
}
export interface StudioObservedAction { sequence: number; type: string; projectId?: string; trackId?: string; clipId?: string; resultTrackId?: string; resultClipId?: string }
export interface StudioActionDestination { projectId: string; trackId?: string; clipId?: string }
export function observedStudioStep(topic: StudioHelpTopic, startSequence: number, observed?: StudioObservedAction, destination?: StudioActionDestination): boolean {
  if (!observed || observed.sequence <= startSequence || !STUDIO_OBSERVES[topic].includes(observed.type)) return false
  if (!destination) return true
  if (observed.projectId !== destination.projectId) return false
  const trackScoped = ['select-chord', 'move-notes', 'resize-notes', 'notes', 'delete-note', 'drums', 'unlink', 'arrange', 'delete-clip', 'sound', 'volume', 'pan', 'space', 'expression', 'record', 'independent', 'linked'].includes(topic)
  const clipScoped = ['select-chord', 'move-notes', 'resize-notes', 'notes', 'delete-note', 'drums', 'unlink', 'arrange', 'delete-clip', 'independent', 'linked'].includes(topic)
  return (!trackScoped || !destination.trackId || observed.trackId === destination.trackId)
    && (!clipScoped || !destination.clipId || observed.clipId === destination.clipId)
}
