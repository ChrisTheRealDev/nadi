import type { PlaybackReceipt } from '../lib/audio'
import type { EmotiveProject } from '../lib/courseProgress'
import { projectContentFingerprint } from '../lib/projectModel'

/** Test-only receipt. Production code must obtain receipts from ToneTransportEngine. */
export function createMockPlaybackReceipt(
  project: EmotiveProject,
  sequenceEndTick: number,
  overrides: Partial<PlaybackReceipt> = {},
): PlaybackReceipt {
  return {
    projectId: project.id,
    projectRevision: project.revision,
    audioEpoch: 1,
    runId: 1,
    renderState: 'tone-transport-acknowledged',
    assetSet: 'tone-synth-fallback-v1',
    projectContentFingerprint: projectContentFingerprint(project.content),
    renderConfiguration: {
      bpm: project.content.bpm,
      meter: project.content.meter,
      scheduledNoteCount: 0,
      tailSeconds: 2.2,
      masterGain: 0.22,
      voice: { kind: 'tone-synth-fallback', oscillator: 'triangle', releaseSeconds: 1 },
      reverb: { kind: 'deterministic-convolution', impulseSeconds: 1.2, preDelaySeconds: 0 },
      channels: Object.fromEntries(Object.entries(project.content.channels).map(([id, channel]) => [id, { gain: channel.gain, muted: channel.muted, reverbSend: channel.reverbSend }])),
    },
    sequenceStartTick: 0,
    sequenceEndTick,
    acknowledgedAt: 'mocked-render-acknowledgement',
    ...overrides,
  }
}
