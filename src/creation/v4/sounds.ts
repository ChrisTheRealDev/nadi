import { SOUND_LABELS, type SoundId } from './model'
import { ORCHESTRA_SAMPLES } from './orchestraSamples'

export interface SoundPreset { id: SoundId; name: string; category: 'Keys' | 'Bass' | 'Strings' | 'Pads' | 'Guitar' | 'Brass' | 'Woodwinds' | 'Voices' | 'Textures' | 'Drums' | 'Orchestral Percussion'; sampled: boolean; program: number; previewPitch: number }
export const ORCHESTRA_IDS = ['violin', 'viola', 'cello', 'double-bass', 'flute', 'clarinet', 'bassoon', 'trombone', 'tuba', 'harp', 'timpani'] as const
const orchestraPresets: SoundPreset[] = ORCHESTRA_IDS.map((id, index) => ({
  id, name: SOUND_LABELS[id], sampled: true,
  category: index < 4 || id === 'harp' ? 'Strings' : index < 7 ? 'Woodwinds' : index < 9 ? 'Brass' : 'Orchestral Percussion',
  program: [40, 41, 42, 43, 73, 71, 70, 57, 58, 46, 47][index],
  previewPitch: [69, 60, 48, 36, 72, 65, 48, 53, 36, 60, 49][index],
}))
export const SOUNDS: readonly SoundPreset[] = [
  { id: 'piano', name: SOUND_LABELS.piano, category: 'Keys', sampled: true, program: 0, previewPitch: 60 },
  { id: 'electric-piano', name: SOUND_LABELS['electric-piano'], category: 'Keys', sampled: false, program: 4, previewPitch: 60 },
  { id: 'synth-bass', name: SOUND_LABELS['synth-bass'], category: 'Bass', sampled: false, program: 38, previewPitch: 40 },
  { id: 'strings', name: SOUND_LABELS.strings, category: 'Strings', sampled: true, program: 48, previewPitch: 69 },
  { id: 'soft-pad', name: SOUND_LABELS['soft-pad'], category: 'Pads', sampled: false, program: 89, previewPitch: 60 },
  { id: 'plucked-guitar', name: SOUND_LABELS['plucked-guitar'], category: 'Guitar', sampled: true, program: 24, previewPitch: 60 },
  { id: 'french-horn', name: SOUND_LABELS['french-horn'], category: 'Brass', sampled: true, program: 60, previewPitch: 60 },
  { id: 'trumpet', name: SOUND_LABELS.trumpet, category: 'Brass', sampled: true, program: 56, previewPitch: 67 },
  { id: 'oboe', name: SOUND_LABELS.oboe, category: 'Woodwinds', sampled: true, program: 68, previewPitch: 69 },
  { id: 'ancient-reed', name: SOUND_LABELS['ancient-reed'], category: 'Woodwinds', sampled: true, program: 68, previewPitch: 62 },
  { id: 'vocal-air', name: SOUND_LABELS['vocal-air'], category: 'Voices', sampled: false, program: 54, previewPitch: 60 },
  { id: 'bronze-resonance', name: SOUND_LABELS['bronze-resonance'], category: 'Textures', sampled: false, program: 14, previewPitch: 48 },
  ...(['kick', 'snare', 'hat'] as const).map((id, i) => ({ id, name: SOUND_LABELS[id], category: 'Drums' as const, sampled: false, program: 0, previewPitch: [36, 38, 42][i] })),
  ...orchestraPresets,
]
export function soundById(id: SoundId): SoundPreset { return SOUNDS.find(sound => sound.id === id)! }
export function isSampledSound(id: SoundId): boolean { return soundById(id).sampled }
export function isAcousticSound(id: SoundId): boolean { return id !== 'piano' && isSampledSound(id) }

// Per-sound version-1 envelopes. Existing string/guitar behavior is intentionally unchanged.
export function acousticEnvelope(id: SoundId) {
  switch (id) {
    case 'strings': return { attack: .08, release: .8, gain: 2 }
    case 'plucked-guitar': return { attack: .003, release: .4, gain: 1.2 }
    case 'french-horn': return { attack: .035, release: .3, gain: 1.25 }
    case 'trumpet': return { attack: .015, release: .22, gain: 1 }
    case 'oboe': return { attack: .025, release: .25, gain: 1.2 }
    case 'ancient-reed': return { attack: .045, release: .4, gain: .85 }
    case 'violin': case 'viola': return { attack: .06, release: .5, gain: 1.2 }
    case 'cello': case 'double-bass': return { attack: .07, release: .55, gain: 1.2 }
    case 'flute': case 'clarinet': case 'bassoon': return { attack: .025, release: .25, gain: 1.1 }
    case 'trombone': case 'tuba': return { attack: .04, release: .35, gain: 1 }
    case 'harp': return { attack: .003, release: .8, gain: 1 }
    case 'timpani': return { attack: .002, release: .6, gain: .8 }
    default: throw new Error('No acoustic envelope registered for this sound.')
  }
}

// Candidate loops measured in the stable section of each exact source file; see BRASS-SAMPLES.md.
export const BRASS_SAMPLES = [
  ['french-horn',36,'MOHorn_sus_C1_v2_1.wav','23b4446037378ea0145019a6f9902101e690c82d68e603d8070bec6fc6f3df1f',1.392517006802721,3.206485260770975],
  ['french-horn',53,'MOHorn_sus_F2_v2_1.wav','2e487a49c834ff2d76aff1c9755875fc03013bf202b949a5c5fe354d0c2123c2',1.500544217687075,10.184172335600907],
  ['french-horn',60,'MOHorn_sus_C3_v2_1.wav','c0c0b157dcde094c4417b7c165d645897cde9ea6d74247bbab0c0e75355e78c3',1.5206802721088435,8.893832199546486],
  ['french-horn',74,'MOHorn_sus_D4_v1_1.wav','2866520e737f3826ee9f53693f148109a9cc2d2e54235db0b92f78b2c100b8f7',1.5194104308390022,5.761632653061224],
  ['trumpet',53,'Sum_SHTrumpet_sus_F2_v1_rr1.wav','abda84b86c7eb12a236e976230bbde9898c709f39ba992424b5426bf612c915b',1.5010884353741496,8.75235827664399],
  ['trumpet',60,'Sum_SHTrumpet_sus_C3_v1_rr1.wav','fc49adedf0922c42583145eedd7ba4707cf97a92fb446b73bf160003190efebe',1.5208616780045352,10.639750566893424],
  ['trumpet',67,'Sum_SHTrumpet_sus_G3_v1_rr1.wav','949446498df4e1402f00023c91bd45c3b9a793ce8076a871b800e76ce144d4fa',1.5137868480725623,11.952403628117914],
  ['trumpet',74,'Sum_SHTrumpet_sus_D4_v1_rr1.wav','fa4a3f77ead22cb58afdaa1732b9b6c8ec6033708ae339df6446a56c1b7cc8e9',1.5010884353741496,11.447460317460317],
  ['trumpet',81,'Sum_SHTrumpet_sus_A4_v1_rr1.wav','f720df13ae0eef9889692283a4ea9033ef4d4826ded3f47dbe81a0dd2585a3cf',1.5007256235827664,10.048321995464853],
].map(([soundId, rootMidi, file, sha256, loopStart, loopEnd]) => ({ soundId: soundId as SoundId, rootMidi: Number(rootMidi), url: `/audio/studio-v1/${file}`, sha256: String(sha256), loopStart: Number(loopStart), loopEnd: Number(loopEnd) }))

export const OBOE_SAMPLES = [
  [58, 'Oboe_Sus_A#2_v3_Main.wav', '78333824a35f1187a8d30e039ca1965113ee194cd9710afe2c3a1e9eb5a486b6', 1.5192290249433107, 9.434081632653061],
  [65, 'Oboe_Sus_F3_v3_Main.wav', '58d69a9cb3cd71dae917b83afe2efc3dbee1ab6c1d330fe2c3faf89b269f673c', 1.5, 6.815396825396825],
  [74, 'Oboe_Sus_D4_v3_Main.wav', 'd8ffaa22803a6238ae8c9d4664e9659e717916d70a2f2c48742f3eb519815497', 1.5068934240362812, 6.748707482993197],
  [82, 'Oboe_Sus_A#4_v3_Main.wav', 'dc9a1faae5ccaea8aea2b67438b9efde2c1b1b7f422c97b70d493445e07009e8', 1.5001814058956917, 6.138072562358277],
  [89, 'Oboe_Sus_F5_v3_Main.wav', '9c24e524a1c8fdaf82a5874c944db46de26ff8ce4a0eb209d3e12fd65634e2f3', 1.521768707482993, 6.839478458049887],
].map(([rootMidi, file, sha256, loopStart, loopEnd]) => ({ soundId: 'oboe' as SoundId, rootMidi: Number(rootMidi), url: `/audio/studio-v1/${String(file).replace('#', 'sharp')}`, sha256: String(sha256), loopStart: Number(loopStart), loopEnd: Number(loopEnd) }))

export interface AcousticSampleDefinition { soundId: SoundId; rootMidi: number; url: string; sha256: string; loopStart?: number; loopEnd?: number; gain?: number; loopCrossfadeSeconds?: number }
export const ACOUSTIC_SAMPLES: AcousticSampleDefinition[] = [
  ['strings', 55, 'VlnEns_susVib_G2_v2.wav', 'c0b06a23f0245c042f0609dc0db704adc14bfc9ea8a34cb5c97d80096715a0e6'],
  ['strings', 62, 'VlnEns_susVib_D3_v2.wav', '77893dbf1ea1be8c40ad756d16b916298e6b1b0742495e9853e020375592357c'],
  ['strings', 69, 'VlnEns_susVib_A3_v2.wav', '3fc4a9e22037643fce11e755da72c61c664893f83e637c24a7b5c2d3824ab986'],
  ['strings', 76, 'VlnEns_susVib_E4_v2.wav', '030c09a631ebbc7304fc0b47bb5c346cd646e7451d9fdc531870f2534c60d9e9'],
  ['strings', 83, 'VlnEns_susVib_B4_v2.wav', 'bdb85532f47e4ebd681f9617a415116e7e5aeb786dce2eeab5ab9b93c1b31644'],
  ['plucked-guitar', 40, 'e2_mp_rr1.wav', '2cdfe97743f36ea4e16a7ffbff3ef8f200893bebd0dc9f9a5621dafcdecbe4fd'],
  ['plucked-guitar', 45, 'a2_mp_rr1.wav', '9688299f1462019634805c380c72a27ab4cad0402f298f4a8ba95e4c8a65ebaa'],
  ['plucked-guitar', 51, 'eb3_mp_rr1.wav', '2f5de9b90ddc9f558da9aab376f9c729fe5c2e805b562dc13d6f6196eebf871b'],
  ['plucked-guitar', 57, 'a3_mp_rr1.wav', '92881dc3afa984ef20dd405b13ed9713a649076f86eb0d683ffce8989912be93'],
  ['plucked-guitar', 63, 'eb4_mp_rr1.wav', '81bcc53beb5209a2b67c30dccf8ffb8c376e9400abfb5de340c181359ad681c8'],
  ['plucked-guitar', 69, 'a4_mp_rr1.wav', '2650004e015576a74f2e6a1e50af8b98f113df792a0f8607910c234529e7b346'],
  ['plucked-guitar', 75, 'eb5_mp_rr1.wav', 'de16428ac68068329e3d2b5345c6a426c83b5f6db3338b83455711a720785d10'],
].map(([soundId, rootMidi, file, sha256]) => ({ soundId: soundId as SoundId, rootMidi: Number(rootMidi), url: `/audio/studio-v1/${file}`, sha256: String(sha256), loopStart: undefined as number | undefined, loopEnd: undefined as number | undefined })).concat(BRASS_SAMPLES, OBOE_SAMPLES, [...ORCHESTRA_SAMPLES])
