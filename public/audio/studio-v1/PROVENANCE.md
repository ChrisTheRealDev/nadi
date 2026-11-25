# NADI acoustic subset, sound version 1

2026-09-23 addition: nine sustained horn/trumpet files, 20,349,832 bytes. Exact sources, MIDI roots, checksums and pending listening gate: [Brass provenance](BRASS-SAMPLES.md). The historical twelve-file subset below is unchanged.

Retrieved 2026-09-19. Twelve original, unmodified WAV files; **14,363,912 bytes** total (about 13.7 MiB). NADI ships only this subset, not either full library. Runtime SHA-256 verification and MIDI root mappings are pinned in `src/creation/v4/sounds.ts`. The ingestion script is `scripts/fetch-studio-samples.ps1`.

## Strings

- Publisher: Versilian Studios, **VSCO 2 Community Edition**; recordings by Sam Gossner and Simon Dalzell, sample cutting by Elan Hickler / Soundemote.
- Licence: **CC0 1.0**, verified on [publisher page](https://versilian-studios.com/vsco-community/) and [pinned repository licence](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE).
- Source repository/version: `sgossner/VSCO-2-CE`, raw WAV commit `440300901dfe9275fd84e0b7763af1f8443ae62e`.
- Exact source directory: `Strings/Violin Section/susVib/`.
- Files: `VlnEns_susVib_G2_v2.wav`, `VlnEns_susVib_D3_v2.wav`, `VlnEns_susVib_A3_v2.wav`, `VlnEns_susVib_E4_v2.wav`, `VlnEns_susVib_B4_v2.wav`.
- Actual root MIDI notes **55, 62, 69, 76, 83**, verified against publisher `ViolinEnsSusVib.sfz` at SFZ commit `6dd651d55dde97fd4028699be9d4481f26917891`. VSCO filenames use a different octave label convention; do not infer MIDI roots from those filenames.
- Playback uses nearest-root pitch shifting and a sustain loop in the sampled body; single velocity layer, not the full orchestra/round-robin library. Sustain-loop seam and low/high transposition quality require listening on real speakers/headphones.

## Plucked Guitar

- Publisher: Karoryfer Samples, **Emilyguitar**.
- Licence: **CC0 1.0**, verified on [publisher free-sample page](https://shop.karoryfer.com/pages/free-samples). The publisher explicitly states older archives may retain a previous less-permissive licence but all listed free libraries, except Marie Ork, have been relicensed CC0. The repository's [current pinned licence](https://github.com/sfzinstruments/karoryfer.emilyguitar/blob/b4920dc662fd9cad6dcaccdeecffdd91c8725d8c/LICENSE) is also retained as source reference.
- Source repository/version: `sfzinstruments/karoryfer.emilyguitar`, commit `b4920dc662fd9cad6dcaccdeecffdd91c8725d8c` (publisher links v1.001 release; NADI pins exact repository bytes instead of a mutable release).
- Exact source directory: `notes/`.
- Files: `e2_mp_rr1.wav`, `a2_mp_rr1.wav`, `eb3_mp_rr1.wav`, `a3_mp_rr1.wav`, `eb4_mp_rr1.wav`, `a4_mp_rr1.wav`, `eb5_mp_rr1.wav`.
- MIDI roots **40, 45, 51, 57, 63, 69, 75**; matching SFZ natural note centers. Playback retains natural pluck decay, nearest-root pitch shifting and a single medium velocity/round-robin layer.

## Local integrity values

| File | SHA-256 |
|---|---|
| VlnEns_susVib_G2_v2.wav | c0b06a23f0245c042f0609dc0db704adc14bfc9ea8a34cb5c97d80096715a0e6 |
| VlnEns_susVib_D3_v2.wav | 77893dbf1ea1be8c40ad756d16b916298e6b1b0742495e9853e020375592357c |
| VlnEns_susVib_A3_v2.wav | 3fc4a9e22037643fce11e755da72c61c664893f83e637c24a7b5c2d3824ab986 |
| VlnEns_susVib_E4_v2.wav | 030c09a631ebbc7304fc0b47bb5c346cd646e7451d9fdc531870f2534c60d9e9 |
| VlnEns_susVib_B4_v2.wav | bdb85532f47e4ebd681f9617a415116e7e5aeb786dce2eeab5ab9b93c1b31644 |
| e2_mp_rr1.wav | 2cdfe97743f36ea4e16a7ffbff3ef8f200893bebd0dc9f9a5621dafcdecbe4fd |
| a2_mp_rr1.wav | 9688299f1462019634805c380c72a27ab4cad0402f298f4a8ba95e4c8a65ebaa |
| eb3_mp_rr1.wav | 2f5de9b90ddc9f558da9aab376f9c729fe5c2e805b562dc13d6f6196eebf871b |
| a3_mp_rr1.wav | 92881dc3afa984ef20dd405b13ed9713a649076f86eb0d683ffce8989912be93 |
| eb4_mp_rr1.wav | 81bcc53beb5209a2b67c30dccf8ffb8c376e9400abfb5de340c181359ad681c8 |
| a4_mp_rr1.wav | 2650004e015576a74f2e6a1e50af8b98f113df792a0f8607910c234529e7b346 |
| eb5_mp_rr1.wav | de16428ac68068329e3d2b5345c6a426c83b5f6db3338b83455711a720785d10 |

No project files embed these WAVs. Projects reference built-in sound version 1; WAV exports contain rendered audio; MIDI carries notes and GM hints, not these sound assets.
