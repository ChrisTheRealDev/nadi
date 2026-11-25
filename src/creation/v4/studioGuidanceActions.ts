import type { StudioHelpTopic } from './studioHelp'

/** Plain UI directions for registered IDs, shared by the provider prompt and shorthand recovery.
 * These describe controls only; they do not prescribe musical content or execute edits. */
export const STUDIO_CONTROL_ACTIONS: Record<StudioHelpTopic | 'choose-clip' | 'choose-melodic' | 'choose-track', string> = {
  add: 'Open Sounds.',
  sound: 'Open Track settings to find Sound.',
  record: 'Check Record to before pressing Record.',
  independent: 'Use Duplicate independently for a separate copy of the selected clip.',
  linked: 'Use Repeat linked only when you want later edits to affect both copies.',
  arrange: 'Drag the selected clip along its lane.',
  notes: 'With Draw selected, click an empty square in the piano grid.',
  delete: 'Choose Delete notes, Delete a clip or Delete a track under Things I can help with.',
  drums: 'Open Drums to choose the part you want to edit.',
  'select-chord': 'Press Select chord above the grid, then check how many notes are selected.',
  'move-notes': 'Drag the middle of a selected note block to move the selected notes.',
  'resize-notes': 'Drag the selected note’s right-edge handle to change its length.',
  volume: 'Adjust one track’s volume in the mixer.',
  pan: 'In Mixer, adjust Pan for your selected track.',
  space: 'In Mixer, adjust Space for your selected track.',
  expression: 'In Mixer, open Expression for your selected track.',
  listen: 'Press Test sound.',
  save: 'Open Export to choose NADI project (.nadi), Audio (.wav) or MIDI notes (.mid).',
  undo: 'Press Undo in the top toolbar.',
  'delete-note': 'Select the notes you want to remove, then press Delete selected.',
  'delete-clip': 'Check the selected clip in Arrangement, then press Delete clip.',
  'delete-track': 'Open Track settings and choose Delete track; check the confirmation before accepting.',
  reopen: 'Open Project, then choose Open saved project or Open .nadi / recovery JSON.',
  'missing-sound': 'Open Sounds and press Retry sound beside the failed sound’s name.',
  unlink: 'Press Make independent for the selected clip.',
  'choose-clip': 'Select a clip in Arrangement.',
  'choose-melodic': 'Choose a melodic instrument track in Track.',
  'choose-track': 'Choose the instrument track in Track.',
}

export function expandStudioActionShorthand(action: string, topic: StudioHelpTopic | null, stepIds: readonly string[], facts?: { trackKind: 'none' | 'melodic' | 'drums'; linkedUses: number }): string {
  // Do not rewrite free text, invent a guide, or repair mismatched provider targets.
  if (!topic || !stepIds.length || (action !== topic && !stepIds.includes(action))) return action
  if (stepIds[0] === 'delete-note' && facts?.trackKind === 'drums') return 'Click an existing drum hit to remove it.'
  if (stepIds[0] === 'notes' && facts?.trackKind === 'drums') return 'Open Drums to edit the selected percussion part.'
  if (stepIds[0] === 'drums' && facts?.trackKind !== 'drums') return 'Open Sounds and look for Drums.'
  if (stepIds[0] === 'unlink' && facts && facts.linkedUses <= 1) return 'This part is already independent; you can edit it directly.'
  return STUDIO_CONTROL_ACTIONS[stepIds[0] as keyof typeof STUDIO_CONTROL_ACTIONS] ?? action
}
