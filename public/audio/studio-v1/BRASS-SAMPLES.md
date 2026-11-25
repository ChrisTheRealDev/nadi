# Brass subset — sound version 1

Retrieved 2026-09-23. Nine original, unmodified stereo PCM16/44.1kHz WAVs, **20,349,832 bytes**. No full library is bundled.

Publisher: Versilian Studios / Sam Gossner, VSCO 2 Community Edition. Licence: **CC0 1.0 Universal**, verified directly against the pinned upstream LICENSE. Credit and publisher: https://versilian-studios.com/vsco-community/

Raw source revision: https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e

Licence: https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE

French Horn files are under `Brass/F Horn/sus/`; Trumpet files under `Brass/Trumpet/sus/`. MIDI roots were verified against **pitch_keycenter** in `FHornSus.sfz` and `TrumpetSus.sfz` at upstream SFZ revision `6dd651d55dde97fd4028699be9d4481f26917891`, not guessed from file octave names.

| File | MIDI root | SHA-256 |
|---|---:|---|
| MOHorn_sus_C1_v2_1.wav | 36 | 23b4446037378ea0145019a6f9902101e690c82d68e603d8070bec6fc6f3df1f |
| MOHorn_sus_F2_v2_1.wav | 53 | 2e487a49c834ff2d76aff1c9755875fc03013bf202b949a5c5fe354d0c2123c2 |
| MOHorn_sus_C3_v2_1.wav | 60 | c0c0b157dcde094c4417b7c165d645897cde9ea6d74247bbab0c0e75355e78c3 |
| MOHorn_sus_D4_v1_1.wav | 74 | 2866520e737f3826ee9f53693f148109a9cc2d2e54235db0b92f78b2c100b8f7 |
| Sum_SHTrumpet_sus_F2_v1_rr1.wav | 53 | abda84b86c7eb12a236e976230bbde9898c709f39ba992424b5426bf612c915b |
| Sum_SHTrumpet_sus_C3_v1_rr1.wav | 60 | fc49adedf0922c42583145eedd7ba4707cf97a92fb446b73bf160003190efebe |
| Sum_SHTrumpet_sus_G3_v1_rr1.wav | 67 | 949446498df4e1402f00023c91bd45c3b9a793ce8076a871b800e76ce144d4fa |
| Sum_SHTrumpet_sus_D4_v1_rr1.wav | 74 | fa4a3f77ead22cb58afdaa1732b9b6c8ec6033708ae339df6446a56c1b7cc8e9 |
| Sum_SHTrumpet_sus_A4_v1_rr1.wav | 81 | f720df13ae0eef9889692283a4ea9033ef4d4826ded3f47dbe81a0dd2585a3cf |

## Rendering and verification boundary

Exact loop endpoints live with each hash in `src/creation/v4/sounds.ts`. `node scripts/inspect-brass-samples.mjs` reproducibly measures stable-section loop candidates using stereo waveform matching. Endpoint RMS mismatch ranges approximately 0.0010–0.0139 full scale. This does **not** establish audible seam quality. Human listening for all root pitches, long holds, transposition, chords and balance remains pending.

Horn uses a 35ms envelope attack / 300ms release; trumpet 15ms / 220ms, retaining the samples' own natural attacks. These conservative v1 settings require real listening before claiming production-quality balance. No synthesis fallback is used. Nearest-root resampling and one sustained articulation/velocity layer are deliberate compact-library limits. Existing string/guitar loops and sound versions are unchanged.

Project schema remains v4, each sound uses soundVersion 1. Older NADI versions without these IDs will reject brass projects rather than substitute piano. MIDI programs are zero-based 60 (French Horn) and 56 (Trumpet); MIDI cannot carry these exact samples.

Download reproduction: `scripts/fetch-studio-samples.ps1`. Runtime verifies hashes before decode. Source files are not edited or normalized.
