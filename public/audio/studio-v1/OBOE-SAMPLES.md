# Oboe subset and Sirens-study sounds — version 1

Retrieved 2026-09-23. Five original unmodified stereo PCM16 44.1kHz WAV files, 9,062,920 bytes. Publisher: Versilian Studios / Sam Gossner. Licence: CC0 1.0 Universal; the pinned upstream licence also covers this subset.

- Publisher: https://versilian-studios.com/vsco-community/
- Audio revision: https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e/Woodwinds/Oboe/Sus
- Licence: https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE
- Root pitches verified from `pitch_keycenter`: https://github.com/sgossner/VSCO-2-CE/blob/6dd651d55dde97fd4028699be9d4481f26917891/OboeSusNV.sfz

| File | Root MIDI | SHA-256 |
|---|---:|---|
| Oboe_Sus_A#2_v3_Main.wav | 58 | 78333824a35f1187a8d30e039ca1965113ee194cd9710afe2c3a1e9eb5a486b6 |
| Oboe_Sus_F3_v3_Main.wav | 65 | 58d69a9cb3cd71dae917b83afe2efc3dbee1ab6c1d330fe2c3faf89b269f673c |
| Oboe_Sus_D4_v3_Main.wav | 74 | d8ffaa22803a6238ae8c9d4664e9659e717916d70a2f2c48742f3eb519815497 |
| Oboe_Sus_A#4_v3_Main.wav | 82 | dc9a1faae5ccaea8aea2b67438b9efde2c1b1b7f422c97b70d493445e07009e8 |
| Oboe_Sus_F5_v3_Main.wav | 89 | 9c24e524a1c8fdaf82a5874c944db46de26ff8ce4a0eb209d3e12fd65634e2f3 |

Download reproduction: `scripts/fetch-studio-samples.ps1`. Runtime checks hashes before decode. No cropping, normalization or destructive processing. Nearest-root resampling, one velocity layer and sustained articulation only. Source filenames containing `A#` are shipped as `Asharp` (both A#2 and A#4) to avoid Vite treating decoded # as a URL fragment. Bytes and checksums are unchanged; the table records original upstream names.

Loop endpoints are stored with each hash in `sounds.ts`; `node scripts/inspect-brass-samples.mjs` measures candidate stereo waveform seams. Oboe endpoint RMS mismatch is approximately 0.0084–0.0216 full-scale. Real listening across pitches and long holds remains pending; these measurements do not prove inaudible seams. Oboe uses a 25ms attack/250ms release.

Ancient Reed — approximation uses these same oboe buffers, a quiet detuned triangle and octave sine. It is NOT an authentic aulos sample. Its 45ms attack/400ms release is separately versioned. Vocal Air — synthetic uses a sawtooth through three parallel formant filters plus a quiet sine, not recorded singers. Bronze Resonance — synthetic uses five inharmonic sine partials and a decaying envelope, not sampled ancient gongs. No soundtrack audio is bundled or extracted.

Space uses a deterministic procedurally generated stereo hall impulse with early reflections and a decaying diffuse tail, bounded at 4 seconds. This is not an acoustic recording. Playback, monitoring and WAV share the same processing graph. Human balance, pan, decay, loop seam and reference comparison remain pending.
