import type { MiraRequestDto, MiraResponseDto } from './contracts'

export interface MiraAdapter {
  ask(request: MiraRequestDto): Promise<MiraResponseDto>
}

export interface MiraReportState {
  visible: false
  livePaused: true
  response: null
  supervisorInstruction: 'Please show this to your supervisor. Nothing was sent automatically.'
}

export type MiraTransmissionState = MiraResponseDto['privacy']['transmission']

interface AuthoredHelpEntry {
  id: string
  lesson: string
  objectiveTerms: string[]
  observation: string
  intentionConnection: string
  help: Record<MiraRequestDto['attempt']['support'], string>
  question: string
}

export function createAuthoredMiraAdapter(options: { requestId?: () => string } = {}): MiraAdapter {
  const requestId = options.requestId ?? (() => `local-${Date.now().toString(36)}`)
  return {
    ask: async (request) => authoredMiraResponse(request, requestId()),
  }
}

export function authoredMiraResponse(
  request: MiraRequestDto,
  requestId: string,
  category: MiraResponseDto['category'] = 'authored-local',
  transmission: MiraTransmissionState = 'not-sent',
): MiraResponseDto {
  const entry = findAuthoredHelp(request)
  const selected = request.project.selectedArtifactIds.length
  const supportNote = request.attempt.support === 'example'
    ? 'The example is support, so clear it and make a fresh retry in your own project before any independent check.'
    : request.attempt.support === 'none'
      ? 'You can ask for a nudge, cue, or example without losing credit.'
      : `This attempt remains honestly labelled as using a ${request.attempt.support}.`
  return {
    version: 1,
    source: 'authored',
    category,
    requestId,
    liveStatus: 'not-attempted',
    content: {
      observation: boundText(selected
        ? `${entry.observation} You have ${selected} selected project ${selected === 1 ? 'item' : 'items'}.`
        : entry.observation, 280),
      intentionConnection: request.intention
        ? boundText(`${entry.intentionConnection} Use your stated intention to decide whether the result fits.`, 280)
        : entry.intentionConnection,
      nextStep: boundText(`${entry.help[request.attempt.support]} ${supportNote}`, 280),
      question: entry.question,
      proposal: null,
    },
    report: reportControl(),
    privacy: {
      transmission,
      notice: privacyNotice(transmission),
    },
    budget: null,
  }
}

export function authoredSafeRedirect(requestId: string): MiraResponseDto {
  return {
    version: 1,
    source: 'authored',
    category: 'filtered',
    requestId,
    liveStatus: 'not-attempted',
    content: {
      observation: 'Let’s pause the online studio help here.',
      intentionConnection: 'Mira is limited to music-learning support and cannot safely handle this topic.',
      nextStep: 'Please show this screen to your supervisor or another trusted adult now.',
      question: null,
      proposal: null,
    },
    report: reportControl(),
    privacy: {
      transmission: 'not-sent',
      notice: 'The local safety check stopped this request before it was sent to an online AI provider.',
    },
    budget: null,
  }
}

export const AUTHORED_MIRA_HELP: readonly AuthoredHelpEntry[] = [
  help('s1-signal', 'session-1', ['signal', 'audio', 'no-sound'], 'A sound check separates the browser signal from the keyboard connection.', 'Setup trouble is not a learner failure.', 'Check whether the browser audio indicator changes when you press the on-screen key.', 'Try the on-screen key first. If it works, check the MIDI connection state separately.', 'Play three press-and-release cycles, then wait two quiet seconds and watch both indicators.', 'Example: an on-screen key can confirm browser sound, but only a physical MIDI press confirms the keyboard. Now repeat the check fresh with your own input.', 'Which indicator changes: browser audio, MIDI input, both, or neither?'),
  help('s1-hardware', 'session-1', ['hardware', 'midi', 'keyboard'], 'A connected label and a completed physical key cycle are different facts.', 'The goal is to know which part of the signal path is working.', 'Look for one Note On and its matching Note Off from the physical keyboard.', 'Release every held key, reconnect once if needed, then try one key again.', 'Complete three physical press-release cycles without using the on-screen fallback.', 'Example: press middle C on the physical keyboard, release it fully, and confirm both events. Then clear that example and retry with a different key.', 'Did the app see both the press and the release?'),
  help('s2-pulse', 'session-2', ['pulse', 'downbeat', 'bar'], 'Pulse is the steady spacing; the downbeat is beat one of the bar.', 'Feeling that boundary makes later clip placement easier.', 'Tap along and notice which tap feels like the start of a group of four.', 'Count “1 2 3 4” and give 1 a slightly clearer accent.', 'Tap one full group of four, pause, then make a fresh bar without copying the recorded taps.', 'Example: count one accented “1” followed by three even beats. Stop the example, then perform a new bar yourself.', 'Which tap tells you a new bar began?'),
  help('s3-am', 'session-3', ['am', 'a-minor', 'ace', 'triad', 'repair'], 'A minor uses A, C, and E together; register may change but the pitch names stay.', 'Rebuilding the notes helps connect the sound to the chord shape.', 'Find A first, then look for C and E above it.', 'Check the three pitch names rather than judging only by hand shape.', 'Remove the wrong pitch, then rebuild A–C–E as a fresh attempt.', 'Example: preview A, C, and E together, clear the preview, then rebuild all three notes without the example.', 'Which of A, C, or E is missing or replaced?'),
  help('s4-chords', 'session-4', ['f', 'c', 'g', 'chord', 'repair'], 'F, C, and G major each use three specific pitch names.', 'Comparing their shared notes makes chord changes easier to understand.', 'Name the root first, then find its third and fifth.', 'Use F–A–C, C–E–G, or G–B–D for the requested chord.', 'Remove the mismatching pitch and reconstruct the whole requested chord fresh.', 'Example: preview the requested three pitch names, clear them, then build the chord again without the example.', 'What is the root of the chord you are repairing?'),
  help('s5-clips', 'session-5', ['clip', 'move', 'resize', 'duplicate', 'unique', 'repair'], 'Clip placement changes when material plays; pattern content changes what every linked clip contains.', 'Keeping placement and content separate prevents surprising edits.', 'Check whether you mean to move the clip, change its length, or change its notes.', 'A duplicate can share its pattern; use Make Unique before changing only one copy.', 'Undo the mismatched edit, choose the correct clip operation, then verify its start and length.', 'Example: duplicate a clip and observe the shared-pattern label, undo it, then perform the requested operation fresh.', 'Should this change affect one clip placement or every clip sharing the pattern?'),
  help('s6-phrase', 'session-6', ['phrase', 'intention', 'chord-tone', 'space', 'revise', 'answer'], 'A phrase can use chord tones, repeated ideas, and silence; note density is not a quality score.', 'Your intention should guide whether a note feels settled, tense, busy, or spacious.', 'Listen for one note or rest that most affects your intention.', 'Try changing only one pitch, onset, duration, or rest before comparing.', 'Make a one-bar answer, listen to before and after, then choose Keep or Revise.', 'Example: preview one chord tone on a strong beat and leave a rest after it. Clear the example, then create a fresh one-bar answer.', 'After comparing, do you want to keep this version or revise one thing?'),
  help('s7-variation', 'session-7', ['variation', 'identify', 'a-prime'], 'A′ stays recognisably related to A while changing at least one audible feature.', 'The learner—not Mira—decides which change supports the intended shape.', 'Compare A and A′ and listen for pitch, rhythm, register, velocity, or space.', 'Name one feature that stays and one that changes.', 'Choose one audible difference, make it, then identify it after a full comparison.', 'Example: preview a shorter final note in A′, clear it, then make and identify your own fresh variation.', 'What stayed the same, and what can you hear changing?'),
  help('s8-expression', 'session-8', ['velocity', 'gain', 'reverb', 'peak', 'mix', 'repair'], 'Velocity changes a note’s performance; channel gain changes the whole layer; reverb changes the sense of space.', 'Separating those controls helps you make an intentional mix repair.', 'Identify whether the issue belongs to one note, a whole layer, or the room sound.', 'Use velocity for one note, gain for a channel, and reverb send for space; a sample peak meter is not proof of human audibility or true peak.', 'Make one bounded mix repair, listen again, and compare the measured sample peak without claiming more than it shows.', 'Example: preview one lower note velocity, clear it, then make a fresh repair with the control that matches the issue.', 'Is the change about one note, the whole layer, or the space around it?'),
  help('transfer-am-f', 'transfer', ['am-f', 'two-bar', 'transfer'], 'The transfer starts blank: bar one is A minor and bar two is F major.', 'Building it fresh checks whether the chord relationship transfers beyond the lesson example.', 'Start with the roots A in bar one and F in bar two.', 'Complete A–C–E in bar one and F–A–C in bar two.', 'Build both bars from blank, then inspect their bar boundaries before listening.', 'Example: preview the six pitch names by bar, clear the example, then construct both bars fresh.', 'Which notes are shared by A minor and F major?'),
  help('fl-transfer', 'fl-studio', ['midi', 'json', 'wav', 'import', 'route', 'gain'], 'MIDI carries note timing and velocity, not the NADI instrument or reverb.', 'Knowing the file boundary prevents a successful import from being mistaken for a finished transfer.', 'Choose JSON for exact project data, MIDI for notes, or WAV for rendered audio.', 'After MIDI import, find the notes, place the pattern, route the instrument, and set gain in FL Studio.', 'Import the frozen revision, make one new FL edit, route it, set gain, and verify the audible result manually.', 'Example: locate the imported pattern and its notes, then make a different fresh edit yourself before the check.', 'Which part must you rebuild in FL Studio because MIDI cannot carry it?'),
]

function help(
  id: string,
  lesson: string,
  objectiveTerms: string[],
  observation: string,
  intentionConnection: string,
  none: string,
  nudge: string,
  cue: string,
  example: string,
  question: string,
): AuthoredHelpEntry {
  return { id, lesson, objectiveTerms, observation, intentionConnection, help: { none, nudge, cue, example }, question }
}

function findAuthoredHelp(request: MiraRequestDto): AuthoredHelpEntry {
  const lessonMatches = AUTHORED_MIRA_HELP.filter((entry) => entry.lesson === request.lessonId)
  const objective = request.objectiveId.toLowerCase()
  return lessonMatches.find((entry) => entry.objectiveTerms.some((term) => objective.includes(term))) ??
    lessonMatches[0] ?? genericHelp
}

const genericHelp = help(
  'generic',
  'generic',
  [],
  'This local help uses only the lesson facts shown on screen.',
  'One small listen-and-compare step can keep the learner in control.',
  'Select the relevant note, clip, or channel and name what you notice.',
  'Focus on one relevant control and predict what it will change.',
  'Try one bounded change, listen, then choose Keep or Revise.',
  'Preview one lesson example, clear it, and make a fresh attempt in your own material.',
  'What is the smallest change you want to hear?',
)

function privacyNotice(transmission: MiraTransmissionState): string {
  if (transmission === 'sent') return 'The bounded request reached the online AI path. Standard provider abuse-monitoring retention may apply; store:false is not Zero Data Retention.'
  if (transmission === 'unknown') return 'The online request started, but delivery could not be confirmed. Standard provider abuse-monitoring retention may apply if it arrived.'
  return 'This response was selected from authored local help. No question or project context was sent to an online AI provider.'
}

function boundText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function clearMiraResponseForReport(): MiraReportState {
  return {
    visible: false,
    livePaused: true,
    response: null,
    supervisorInstruction: 'Please show this to your supervisor. Nothing was sent automatically.',
  }
}

export function reportControl(): MiraResponseDto['report'] {
  return {
    available: true,
    label: 'Hide this and show your supervisor',
    instruction: 'This hides the response on this screen. Please show this to your supervisor; nothing is sent automatically.',
  }
}
