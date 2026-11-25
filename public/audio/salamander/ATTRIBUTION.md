# Salamander Grand Piano subset

These 21 FLAC files are a deliberately reduced browser mapping derived from
**Salamander Grand Piano v3** by **Alexander Holm**.

- Upstream SFZ repository: https://github.com/sfzinstruments/SalamanderGrandPiano
- Original library archive: https://archive.org/details/SalamanderGrandPianoV3
- License: Creative Commons Attribution 3.0 Unported. See `LICENSE-CC-BY-3.0.txt`.

NADI uses seven sampled roots (C3, F-sharp 3, C4, F-sharp 4, C5,
F-sharp 5, and C6) and three distinct source velocity recordings (`v5`, `v9`,
and `v13`). This is an adaptation of the upstream 16-velocity, minor-third
mapping; it is not represented as the complete original instrument.

The upstream velocity regions associate `v5` with MIDI velocities 44–46,
`v9` with 65–72, and `v13` with 97–104. NADI maps the wider browser input
range onto these three retained timbral layers and applies mixer gain
separately from velocity selection.
