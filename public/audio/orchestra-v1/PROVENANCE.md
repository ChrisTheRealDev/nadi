# Orchestral sample subset, version 1

These are genuine, unmodified recordings from **Versilian Studios' VSCO 2 Community Edition**, published by Sam Gossner. Publisher and project: [VSCO Community Edition](https://versilian-studios.com/vsco-community/). The upstream **CC0 1.0 Universal** license is included verbatim in `LICENSE.txt`.

- Audio revision: [`440300901dfe9275fd84e0b7763af1f8443ae62e`](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e).
- Mapping revision: [`6dd651d55dde97fd4028699be9d4481f26917891`](https://github.com/sgossner/VSCO-2-CE/tree/6dd651d55dde97fd4028699be9d4481f26917891).
- License source: [pinned upstream LICENSE](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE).
- Every exact source URL, upstream Git blob SHA-1, local SHA-256, byte count, SFZ SHA-256, source velocity region and volume, WAV format, duration, and loop measurement is recorded in `manifest.json`.
- Exact pinned SFZ files are retained under `source-mappings/` for root-note auditing. Roots come from `pitch_keycenter`, never from filename octave conventions.

## Coverage

| Sound ID | Recording | Root MIDI notes | Mapping |
| --- | --- | --- | --- |
| violin | Solo violin, vibrato sustain | 57, 72, 88 | SViolinVib.sfz |
| viola | Viola section, vibrato sustain | 48, 65, 79 | ViolaEnsSusVib.sfz |
| cello | Cello section, vibrato sustain | 36, 53, 67 | CelloEnsSusVib.sfz |
| double-bass | Solo contrabass, vibrato sustain | 30, 42, 59 | ContrabassSusVB.sfz |
| flute | Flute, non-vibrato sustain | 60, 76, 93 | FluteSusNV.sfz |
| clarinet | Clarinet, long sustain | 50, 70, 86 | ClarinetSus.sfz |
| bassoon | Bassoon, sustain | 34, 48, 69 | BassoonSus.sfz |
| trombone | Tenor trombone, sustain | 34, 50, 65 | TromboneSus.sfz |
| tuba | Tuba, sustain | 29, 46, 62 | TubaSus.sfz |
| harp | Harp, plucked natural decay | 35, 52, 69, 86 | Harp.sfz |
| timpani | Timpani, single hit natural decay | 42, 49, 54 | Timpani.sfz |

The 34 WAVs total **68,509,364 bytes (68.5 MB / 65.3 MiB)**. This is slightly above the initial approximate 60 MB target to preserve full source stereo recordings and natural tails. No downsampling, cropping, gain normalization, or audio transcoding has been applied. Local names use the instrument ID and verified MIDI root; bytes match upstream exactly.

This is a compact sample set: intermediate pitches are transposed from nearby roots, and one source velocity layer/round-robin is used per root. It does not reproduce the complete upstream SFZ instrument, dynamic layers, articulations, amplitude compensation, or round-robin behavior. Viola and cello are ensemble recordings; violin and double-bass are solo recordings.

Playback `gain` is a measured per-root calibration: `min(64, 0.35 / peak)`, using the exact peak across **every PCM frame and channel**. The factor is limited to 64 (about 36 dB boost) and is applied by the player without changing WAV bytes. It intentionally replaces source SFZ volume for this single-layer sketch preset; `sfzVolumeDb` preserves the inherited source volume for auditing. Most calibrated raw peaks reach 0.35 before the instrument envelope, note velocity, and mix gain. Timpani root 42 remains below that target because it reaches the boost ceiling; the instrument preview uses root 49. Peak calibration does not guarantee equal perceived loudness, and listening balance remains pending.

## Reproduction and validation

From the project directory, run `node scripts/fetch-orchestra-samples.mjs --plan` to inspect the selection, then `node scripts/fetch-orchestra-samples.mjs` to download and regenerate the manifest and TypeScript registry. The script rejects selections above 70 MB, verifies each source Git blob hash and byte count before accepting a file, and records a local SHA-256. Existing WAVs are reused only if they still match their pinned upstream blob.

The selection uses the nearest available SFZ root to each configured target, prefers the region covering velocity 80, and then chooses the smaller exact source recording on ties. Harp receives a fourth root to cover its broad range. Source files and mappings are immutable revisions.

Sustain loop positions are **measured candidates**, using the existing brass inspection technique: compare waveform neighborhoods in every channel within the central sustain, retain the initial attack, and avoid the last second of the source tail. `seamRms` is a numerical waveform difference, not a perceptual quality score. Sustained entries request a 20 ms `loopCrossfadeSeconds` in-memory playback crossfade before loop end toward the waveform immediately preceding loop start, to reduce abrupt wrapping. This processing does not modify the shipped source files. Harp and timpani have no loop endpoints or crossfade and keep their natural decay. PCM structure, hashes, root mappings, non-silence, and loop bounds can be checked automatically; **audible loop quality, tuning, balance, and instrument realism still require listening in the application**. No listening validation is claimed here.
