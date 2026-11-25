import { SOUND_LABELS, type SoundId } from './model'

export interface InstrumentProfile {
  readonly label: string
  readonly kind: 'acoustic' | 'ensemble' | 'synthetic' | 'approximation' | 'unpitched'
  readonly clef: { readonly sign: 'G' | 'F' | 'C' | 'percussion'; readonly line: number }
  readonly grandStaff: boolean
  /** MusicXML written-to-sounding interval. Project notes always store sounding pitch. */
  readonly transpose: { readonly chromatic: number; readonly diatonic: number; readonly octaveChange?: number }
  readonly pitchedPercussion: boolean
  /** Reference sounding MIDI range, not an absolute limit or a beginner's comfortable range. */
  readonly soundingRange?: readonly [number, number]
  readonly conventionalSingleLine: boolean
  readonly assumption: string
  readonly sources: readonly string[]
}

const academy = 'https://www.vsl.co.at/academy/'
const treble = { sign: 'G', line: 2 } as const
const bass = { sign: 'F', line: 4 } as const
const base: InstrumentProfile = {
  label: '', kind: 'acoustic', clef: treble, grandStaff: false,
  transpose: { chromatic: 0, diatonic: 0 }, pitchedPercussion: false,
  conventionalSingleLine: false, assumption: '', sources: [],
}
function profile(sound: SoundId, overrides: Partial<InstrumentProfile>): InstrumentProfile {
  const value = { ...base, label: SOUND_LABELS[sound], ...overrides }
  Object.freeze(value.clef); Object.freeze(value.transpose); Object.freeze(value.sources)
  if (value.soundingRange) Object.freeze(value.soundingRange)
  return Object.freeze(value)
}

/** Reviewed 2026-09-26 against VSL Instrumentology, not the sample-library key maps.
 * Orchestral reference ranges are deliberately advisory: extensions and specialist techniques exist.
 * Bb trumpet range is the C-trumpet reference lowered by a whole tone for the selected Bb profile.
 */
export const INSTRUMENT_PROFILES: Readonly<Record<SoundId, InstrumentProfile>> = Object.freeze({
  piano: profile('piano', { grandStaff: true, soundingRange: [21, 108], assumption: 'Standard 88-key piano; extended keyboards differ.', sources: ['https://www.yamaha.com/yamahapianofinder/'] }),
  kick: profile('kick', { kind: 'unpitched', clef: { sign: 'percussion', line: 2 }, assumption: 'Bass drum; MIDI pitch does not specify a tuned drum pitch.' }),
  snare: profile('snare', { kind: 'unpitched', clef: { sign: 'percussion', line: 2 }, assumption: 'Snare drum; no pitched range check.' }),
  hat: profile('hat', { kind: 'unpitched', clef: { sign: 'percussion', line: 2 }, assumption: 'Hi-hat; no pitched range check.' }),
  'electric-piano': profile('electric-piano', { kind: 'synthetic', grandStaff: true, assumption: 'Electronic keyboard; physical key count and transposition depend on the performer.' }),
  'synth-bass': profile('synth-bass', { kind: 'synthetic', clef: bass, assumption: 'Synthesized sound; choose the real performer separately.' }),
  strings: profile('strings', { kind: 'ensemble', grandStaff: true, assumption: 'Combined string ensemble; assign individual players before checking a live performance.' }),
  'soft-pad': profile('soft-pad', { kind: 'synthetic', grandStaff: true, assumption: 'Electronic pad; no acoustic instrument is implied.' }),
  'plucked-guitar': profile('plucked-guitar', { transpose: { chromatic: 0, diatonic: 0, octaveChange: -1 }, assumption: 'Guitar written one octave above sounding pitch. Tuning, frets, fingering and chord reach need performer review.', sources: ['https://open.yousician.com/guitartuna/'] }),
  'french-horn': profile('french-horn', { label: 'Horn in F', soundingRange: [35, 77], conventionalSingleLine: true, transpose: { chromatic: -7, diatonic: -4 }, assumption: 'One horn in F using conventional single-note playing; extensions and specialist techniques require review.', sources: [academy + 'brass/horn-f'] }),
  trumpet: profile('trumpet', { label: 'Trumpet in B♭', soundingRange: [52, 82], conventionalSingleLine: true, transpose: { chromatic: -2, diatonic: -1 }, assumption: 'One B♭ trumpet; sounding range derived from the C-trumpet reference. High notes depend strongly on the player.', sources: [academy + 'brass/trumpet-c'] }),
  oboe: profile('oboe', { soundingRange: [58, 91], conventionalSingleLine: true, assumption: 'One modern oboe; extended techniques need performer review.', sources: [academy + 'woodwinds/oboe'] }),
  'ancient-reed': profile('ancient-reed', { kind: 'approximation', assumption: 'A timbral approximation, not a specified historical instrument or tuning.' }),
  'vocal-air': profile('vocal-air', { kind: 'synthetic', assumption: 'Synthetic vocal sound; it does not specify an individual singer’s range.' }),
  'bronze-resonance': profile('bronze-resonance', { kind: 'synthetic', assumption: 'Synthetic resonance; it does not specify a tuned acoustic instrument.' }),
  violin: profile('violin', { soundingRange: [55, 105], assumption: 'Standard violin reference; harmonics, double stops and fingering need review.', sources: [academy + 'strings/violin'] }),
  viola: profile('viola', { kind: 'ensemble', clef: { sign: 'C', line: 3 }, soundingRange: [48, 93], assumption: 'Viola section; simultaneous notes may be divided among players.', sources: [academy + 'strings/viola'] }),
  cello: profile('cello', { kind: 'ensemble', clef: bass, soundingRange: [36, 81], assumption: 'Cello section; simultaneous notes may be divided among players. Harmonics can extend the reference range.', sources: [academy + 'strings/cello'] }),
  'double-bass': profile('double-bass', { clef: bass, transpose: { chromatic: 0, diatonic: 0, octaveChange: -1 }, soundingRange: [28, 67], assumption: 'Standard four-string bass, lowest E1; extensions and five-string instruments can play lower.', sources: [academy + 'strings/double-bass'] }),
  flute: profile('flute', { soundingRange: [60, 98], conventionalSingleLine: true, assumption: 'One concert flute with C footjoint; B3 needs a B footjoint and the highest register needs an experienced player.', sources: [academy + 'woodwinds/concert-flute'] }),
  clarinet: profile('clarinet', { label: 'Clarinet in B♭', soundingRange: [50, 94], conventionalSingleLine: true, transpose: { chromatic: -2, diatonic: -1 }, assumption: 'One B♭ clarinet; the upper reference range is advanced, and other clarinets transpose differently.', sources: [academy + 'woodwinds/clarinet'] }),
  bassoon: profile('bassoon', { clef: bass, soundingRange: [34, 77], conventionalSingleLine: true, assumption: 'One standard bassoon; upper notes and low-A extensions require performer review.', sources: [academy + 'woodwinds/bassoon'] }),
  trombone: profile('trombone', { clef: bass, soundingRange: [40, 77], conventionalSingleLine: true, assumption: 'One tenor trombone, ordinary non-pedal range; valves, pedal notes and specialist techniques differ.', sources: [academy + 'brass/tenor-trombone'] }),
  tuba: profile('tuba', { clef: bass, soundingRange: [26, 67], conventionalSingleLine: true, assumption: 'One bass tuba reference; tuba sizes and players have different practical ranges.', sources: [academy + 'brass/bass-tuba'] }),
  harp: profile('harp', { grandStaff: true, soundingRange: [23, 104], assumption: 'Concert double-action pedal harp; pedal changes, enharmonics and reach are not checked.', sources: [academy + 'strings/harp'] }),
  timpani: profile('timpani', { clef: bass, pitchedPercussion: true, soundingRange: [36, 61], assumption: 'Range across several timpani sizes, not one drum. Available drums, retuning and hand coordination need review.', sources: [academy + 'percussion/timpani'] }),
})

export function instrumentProfile(sound: SoundId): InstrumentProfile { return INSTRUMENT_PROFILES[sound] }
export function soundingToWrittenOffset(profile: InstrumentProfile): number {
  return 0 - profile.transpose.chromatic - 12 * (profile.transpose.octaveChange ?? 0)
}
