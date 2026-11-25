/** One capture has one input owner. Null explicitly means screen-only, never first-MIDI-wins. */
export function acceptsIdeaCaptureInput(pinnedDeviceId: string | null, source: 'midi' | 'screen', eventDeviceId?: string): boolean {
  return pinnedDeviceId === null ? source === 'screen' : source === 'midi' && eventDeviceId === pinnedDeviceId
}
