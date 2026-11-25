import type { ScheduledNote } from './audio'
import type { EmotiveProject } from './courseProgress'
import { TICKS_PER_BEAT, TICKS_PER_BAR } from './melodyEvents'

export function buildProjectPlayback(
  project: EmotiveProject,
  startBar: number = 0,
  endBar: number = project.bars,
): { notes: ScheduledNote[]; duration: number; tailSeconds: number; startTick: number; endTick: number } {
  const projectBars = project.content.lengthTicks / TICKS_PER_BAR
  const start = Math.max(0, Math.min(projectBars - 1, Math.floor(startBar)))
  const end = Math.max(start + 1, Math.min(projectBars, Math.ceil(endBar)))
  const beatSeconds = 60 / project.content.bpm
  const barSeconds = beatSeconds * 4
  const sectionStartTick = start * TICKS_PER_BAR
  const sectionEndTick = end * TICKS_PER_BAR
  const notes: ScheduledNote[] = []

  project.content.clips.forEach((clip) => {
    const pattern = project.content.patterns[clip.patternId]
    if (!pattern) return
    pattern.notes.forEach((event) => {
      const channel = project.content.channels[event.channelId]
      if (!channel) return
      const clipVisibleStart = Math.max(event.startTick, clip.offsetTick)
      const clipVisibleEnd = Math.min(event.startTick + event.durationTicks, clip.offsetTick + clip.lengthTicks)
      if (clipVisibleEnd <= clipVisibleStart) return
      const projectStart = clip.startTick + clipVisibleStart - clip.offsetTick
      const projectEnd = clip.startTick + clipVisibleEnd - clip.offsetTick
      const audibleStart = Math.max(projectStart, sectionStartTick)
      const audibleEnd = Math.min(projectEnd, sectionEndTick)
      if (audibleEnd <= audibleStart) return
      notes.push({
        instanceId: `${clip.id}@${event.id}`,
        channelId: event.channelId,
        note: event.pitch,
        at: ((audibleStart - sectionStartTick) / TICKS_PER_BEAT) * beatSeconds,
        duration: Math.max(0.001, ((audibleEnd - audibleStart) / TICKS_PER_BEAT) * beatSeconds),
        velocity: Math.max(0, Math.min(1, event.velocity / 127)),
        channelGain: channel.gain / 100,
        channelMuted: channel.muted,
        reverbSend: channel.reverbSend / 100,
      })
    })
  })

  // Keep one fixed acknowledged render window. A dry or currently muted bus
  // can be changed during live preview, and export must use the same frozen
  // duration without truncating release/convolution state.
  const tailSeconds = 2.2
  return { notes: notes.sort((a, b) => a.at - b.at || a.note - b.note), duration: barSeconds * (end - start), tailSeconds, startTick: sectionStartTick, endTick: sectionEndTick }
}
