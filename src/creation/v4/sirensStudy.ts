import { assertStudioProject, createStudioProject, defaultTrackProduction, makeStudioId, SOUND_LABELS, TICKS_PER_BAR, type SoundId, type StudioProject } from './model'

/** Empty working grid, NOT a transcription or a claim about the reference tempo. */
export function createSirensStudy(): StudioProject {
  const project = createStudioProject()
  project.name = 'Sirens — study'; project.bpm = 120; project.bars = 80
  const sounds: SoundId[] = ['ancient-reed', 'oboe', 'vocal-air', 'bronze-resonance']
  project.tracks = sounds.map((soundId, index) => ({ id: makeStudioId(), name: SOUND_LABELS[soundId], soundId, soundVersion: 1, color: ['#64bd98','#c6b476','#9b9dcd','#cd9170'][index], level: 75, muted: false, hidden: false, ...defaultTrackProduction() }))
  project.patterns = project.tracks.map(track => ({ id: makeStudioId(), trackId: track.id, name: `${track.name} · blank study`, lengthTicks: 80 * TICKS_PER_BAR, notes: [] }))
  project.clips = project.patterns.map(pattern => ({ id: makeStudioId(), trackId: pattern.trackId, patternId: pattern.id, startTick: 0 }))
  assertStudioProject(project)
  return project
}
