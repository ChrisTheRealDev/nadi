import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAcknowledgedAuditionCompletionReceipt, type AuditionArtifactIdentity, type AuditionCompletionReceipt, type PlaybackReceipt, type ScheduledNote } from '../lib/audio'
import type { PianoPreset } from '../types'
import type { EmotiveProject } from '../lib/courseProgress'
import { buildProjectPlayback } from '../lib/projectAudio'
import { projectContentFingerprint } from '../lib/projectModel'
import { ToneTransportEngine } from '../lib/toneTransport'
import type { PianoAssetStatus } from '../lib/pianoSampleBank'

export type AudioStatus = 'idle' | 'ready' | 'unavailable'

export function useAudioEngine() {
  const epoch = useRef(0)
  const [transport] = useState(() => new ToneTransportEngine())
  const [status, setStatus] = useState<AudioStatus>('idle')
  const [assetStatus, setAssetStatus] = useState<PianoAssetStatus>('idle')
  const [preset, setPreset] = useState<PianoPreset>('warm')
  const nextRunId = useRef(1)

  useEffect(() => {
    transport.setInterruptionHandler(() => { epoch.current += 1 })
    return () => { transport.dispose() }
  }, [transport])

  const prepare = useCallback(async () => {
    setAssetStatus('loading')
    const ready = Boolean(await transport.prepareAssets())
    setAssetStatus(transport.assetStatus)
    setStatus(ready ? 'ready' : 'unavailable')
    return ready
  }, [transport])

  const run = useCallback(
    async (action: () => Promise<boolean>) => {
      try {
        const played = await action()
        setAssetStatus(transport.assetStatus)
        setStatus(played || transport.ready ? 'ready' : 'unavailable')
        return played
      } catch {
        setStatus('unavailable')
        transport.stopAll()
        return false
      }
    },
    [transport],
  )

  return useMemo(() => {
    const shape = preset === 'warm' ? 'triangle' : 'sine'
    const playProjectRange = async (project: EmotiveProject, startBar: number, endBar: number): Promise<PlaybackReceipt | undefined> => {
      const playback = buildProjectPlayback(project, startBar, endBar)
      const audioEpoch = ++epoch.current
      const runId = nextRunId.current++
      let receipt: PlaybackReceipt | undefined
      try {
        receipt = await transport.play({
          notes: playback.notes,
          bpm: project.content.bpm,
          meter: project.content.meter,
          duration: playback.duration,
          tailSeconds: playback.tailSeconds,
          projectId: project.id,
          projectRevision: project.revision,
          audioEpoch,
          runId,
          projectContentFingerprint: projectContentFingerprint(project.content),
          sequenceStartTick: playback.startTick,
          sequenceEndTick: playback.endTick,
          channels: Object.fromEntries(Object.entries(project.content.channels).map(([id, channel]) => [id, { gain: channel.gain, muted: channel.muted, reverbSend: channel.reverbSend }])),
        })
      } catch {
        transport.stop()
        setStatus('unavailable')
        return undefined
      }
      setStatus(receipt || transport.ready ? 'ready' : 'unavailable')
      return receipt && audioEpoch === epoch.current ? receipt : undefined
    }
    const invalidatePlayback = () => {
      epoch.current += 1
      transport.stop()
    }
    const invalidateReceiptOnly = () => { epoch.current += 1 }
    const audition = (notes: readonly ScheduledNote[], auditionShape: 'triangle' | 'sine' = shape) => {
      invalidatePlayback()
      return run(() => transport.playAudition(notes, 90, auditionShape))
    }
    const auditionReceipt = async (
      notes: readonly ScheduledNote[],
      bpm: number,
      timelineSeconds: number,
      artifact: AuditionArtifactIdentity,
      auditionShape: 'triangle' | 'sine' = shape,
    ): Promise<AuditionCompletionReceipt | undefined> => {
      const audioEpoch = ++epoch.current
      const runId = nextRunId.current++
      try {
        const receipt = await transport.playAuditionReceipt({ notes, bpm, meter: '4/4', timelineSeconds, audioEpoch, runId, artifact }, auditionShape)
        setAssetStatus(transport.assetStatus)
        setStatus(receipt || transport.ready ? 'ready' : 'unavailable')
        return receipt && audioEpoch === epoch.current ? receipt : undefined
      } catch {
        transport.stop()
        setStatus('unavailable')
        return undefined
      }
    }
    const metronomeNotes = (bars: number, bpm: number) => {
      const totalBeats = bars * 4
      return Array.from({ length: totalBeats }, (_, beat) => ({ note: beat % 4 === 0 ? 84 : 79, at: beat * (60 / bpm), duration: 0.09, velocity: beat % 4 === 0 ? 0.9 : 0.55 }))
    }
    return {
      status,
      assetStatus,
      preset,
      setPreset,
      ensureReady: prepare,
      retryPianoAssets: async () => {
        setAssetStatus('loading')
        const ready = Boolean(await transport.prepareAssets(true))
        setAssetStatus(transport.assetStatus)
        setStatus(ready ? 'ready' : 'unavailable')
        return ready
      },
      noteOn: (note: number, velocity?: number, owner?: string) => {
        invalidateReceiptOnly()
        return run(() => transport.noteOn(note, velocity, shape, owner))
      },
      noteOff: (note: number, owner?: string) => transport.noteOff(note, owner),
      trigger: (note: number, duration = 0.72, velocity = 0.78) =>
        audition([{ note, at: 0, duration, velocity }]),
      playChord: (notes: readonly number[], duration = 1.35) =>
        audition(notes.map((note) => ({ note, at: 0, duration, velocity: 0.72 }))),
      playPreset: (nextPreset: PianoPreset) => {
        const nextShape = nextPreset === 'warm' ? 'triangle' : 'sine'
        return audition([60, 64, 67].map((note) => ({ note, at: 0, duration: 1.25, velocity: nextPreset === 'warm' ? 0.68 : 0.82 })), nextShape)
      },
      playSeparated: (notes: readonly number[]) =>
        audition(notes.map((note, index) => ({ note, at: index * 0.56, duration: 0.48, velocity: 0.76 }))),
      playComparison: (mode: 'minor' | 'major') => {
        const chord = mode === 'minor' ? [57, 60, 64] : [57, 61, 64]
        return audition(chord.map((note) => ({ note, at: 0, duration: 1.6, velocity: 0.76 })))
      },
      playMetronome: async (bars = 1) => Boolean(await (() => {
        const boundedBars = Math.max(1, Math.min(4, Math.round(bars)))
        const bpm = 90
        return auditionReceipt(metronomeNotes(boundedBars, bpm), bpm, boundedBars * 4 * (60 / bpm), { kind: 'metronome', bars: boundedBars, beatsPerBar: 4 }, 'sine')
      })()),
      playMetronomeReceipt: (bars = 1, bpm = 90) => {
        const boundedBars = Math.max(1, Math.min(4, Math.round(bars)))
        return auditionReceipt(metronomeNotes(boundedBars, bpm), bpm, boundedBars * 4 * (60 / bpm), { kind: 'metronome', bars: boundedBars, beatsPerBar: 4 }, 'sine')
      },
      playAuditionArtifact: (request: { notes: readonly ScheduledNote[]; bpm: number; attemptId: string; generation: number; fingerprint: string; lengthTicks: number }) =>
        auditionReceipt(request.notes, request.bpm, (request.lengthTicks / 480) * (60 / request.bpm), {
          kind: 'artifact', attemptId: request.attemptId, generation: request.generation, fingerprint: request.fingerprint, lengthTicks: request.lengthTicks,
        }),
      playProject: (project: EmotiveProject) => {
        return playProjectRange(project, 0, project.bars)
      },
      playProjectSection: (project: EmotiveProject, startBar: number, endBar: number) => {
        return playProjectRange(project, startBar, endBar)
      },
      playDemo: (
        id: 'emotive' | 'guitar' | 'cinematic' | 'electronic',
      ) => audition(demoNotes[id], id === 'electronic' ? 'sine' : shape),
      stopAll: () => { epoch.current += 1; transport.stopAll() },
      invalidatePlayback,
      invalidateReceiptOnly,
      previewMix: (channelId: string, settings: { gain: number; muted: boolean; reverbSend: number }) => {
        invalidateReceiptOnly()
        return transport.previewMix(channelId, settings)
      },
      allNotesOff: () => { epoch.current += 1; transport.stopAll() },
      currentAudioEpoch: () => epoch.current,
      validateReceiptAgainstCurrentRender: (receipt: PlaybackReceipt) => receipt.audioEpoch === epoch.current,
      validateAuditionReceiptAgainstCurrentAudio: (receipt: AuditionCompletionReceipt) => isAcknowledgedAuditionCompletionReceipt(receipt) && receipt.audioEpoch === epoch.current,
    }
  }, [assetStatus, prepare, preset, run, status, transport])
}

const demoNotes: Record<'emotive' | 'guitar' | 'cinematic' | 'electronic', ScheduledNote[]> = {
  emotive: [{ note: 57, at: 0, duration: 1.25 }, { note: 64, at: 0.08, duration: 1.15 }, { note: 69, at: 0.2, duration: 0.42 }, { note: 72, at: 0.72, duration: 0.42 }, { note: 65, at: 1.45, duration: 1.15 }, { note: 60, at: 1.52, duration: 1.05 }, { note: 69, at: 1.63, duration: 0.45 }, { note: 67, at: 2.18, duration: 0.58 }],
  guitar: [{ note: 52, at: 0, duration: 0.44, velocity: 0.72 }, { note: 59, at: 0.22, duration: 0.44, velocity: 0.68 }, { note: 64, at: 0.44, duration: 0.52, velocity: 0.66 }, { note: 55, at: 1.05, duration: 0.44, velocity: 0.74 }, { note: 62, at: 1.27, duration: 0.44, velocity: 0.68 }, { note: 67, at: 1.49, duration: 0.62, velocity: 0.66 }, { note: 59, at: 2.18, duration: 0.72, velocity: 0.72 }],
  cinematic: [{ note: 45, at: 0, duration: 1.25, velocity: 0.82 }, { note: 57, at: 0, duration: 1.25, velocity: 0.68 }, { note: 60, at: 0.5, duration: 0.7, velocity: 0.66 }, { note: 43, at: 1.28, duration: 1.25, velocity: 0.88 }, { note: 55, at: 1.28, duration: 1.25, velocity: 0.72 }, { note: 62, at: 1.8, duration: 0.7, velocity: 0.7 }],
  electronic: [{ note: 69, at: 0, duration: 0.28, velocity: 0.58 }, { note: 76, at: 0.34, duration: 0.28, velocity: 0.62 }, { note: 72, at: 0.68, duration: 0.42, velocity: 0.56 }, { note: 81, at: 1.16, duration: 0.3, velocity: 0.64 }, { note: 76, at: 1.52, duration: 0.32, velocity: 0.58 }, { note: 79, at: 1.92, duration: 0.65, velocity: 0.6 }, { note: 64, at: 0, duration: 2.7, velocity: 0.3 }],
}
