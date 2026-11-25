import { describe, expect, it } from 'vitest'
import type { FirstSoundProgress, InputSource } from '../types'
import {
  canCompleteFirstSound,
  createInitialFirstSoundProgress,
  firstSoundReducer,
  inputPracticeComplete,
  midiCheckComplete,
  normalizeFirstSoundProgress,
  type FirstSoundAction,
} from './firstSound'

function reduce(
  progress: FirstSoundProgress,
  actions: FirstSoundAction[],
): FirstSoundProgress {
  return actions.reduce(firstSoundReducer, progress)
}

function noteCycle(
  phase: 'practice' | 'check',
  note: number,
  source: InputSource,
): FirstSoundAction[] {
  return [
    { type: 'NOTE_ON', phase, note, source },
    { type: 'AUDIO_SIGNAL', phase, source },
    { type: 'NOTE_OFF', phase, note, source },
  ]
}

function reachPractice(sourceConnected = false) {
  return reduce(createInitialFirstSoundProgress('t0'), [
    { type: 'START_SETUP' },
    {
      type: 'MIDI_STATUS',
      connected: sourceConnected,
      deviceName: sourceConnected ? 'Test MIDI' : undefined,
    },
    { type: 'AUDIO_READY', ready: true },
    { type: 'CONTINUE_TO_PRACTICE' },
  ])
}

describe('environment status updates', () => {
  it('preserves object identity when MIDI and audio status are unchanged', () => {
    const progress = createInitialFirstSoundProgress('initial')

    const sameMidi = firstSoundReducer(progress, {
      type: 'MIDI_STATUS',
      connected: false,
    })
    const sameAudio = firstSoundReducer(progress, {
      type: 'AUDIO_READY',
      ready: false,
    })

    expect(sameMidi).toBe(progress)
    expect(sameAudio).toBe(progress)
    expect(progress.updatedAt).toBe('initial')
  })
})

function reachCheck() {
  let progress = reachPractice(true)
  progress = reduce(progress, [
    ...noteCycle('practice', 57, 'midi'),
    ...noteCycle('practice', 60, 'midi'),
    ...noteCycle('practice', 64, 'midi'),
    { type: 'CONFIRM_SILENCE', phase: 'practice', now: 'practice-done' },
    { type: 'GO_CHOOSE' },
    { type: 'HEARD_PRESET', preset: 'warm' },
    { type: 'HEARD_PRESET', preset: 'clear' },
    { type: 'CHOOSE_PRESET', preset: 'warm' },
    { type: 'GO_CHECK' },
  ])
  return progress
}

describe('Session 1 First Sound progress', () => {
  it('does not leave setup until browser audio is ready', () => {
    let progress = createInitialFirstSoundProgress('t0')
    progress = reduce(progress, [
      { type: 'START_SETUP' },
      { type: 'CONTINUE_TO_PRACTICE' },
    ])
    expect(progress.stage).toBe('connect')
    expect(progress.audioReady).toBe(false)
  })

  it('requires matching releases, audio signals, and quiet confirmation', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      { type: 'NOTE_ON', phase: 'practice', note: 57, source: 'screen' },
      { type: 'AUDIO_SIGNAL', phase: 'practice', source: 'screen' },
      { type: 'NOTE_ON', phase: 'practice', note: 60, source: 'screen' },
      { type: 'AUDIO_SIGNAL', phase: 'practice', source: 'screen' },
      { type: 'NOTE_ON', phase: 'practice', note: 64, source: 'screen' },
      { type: 'AUDIO_SIGNAL', phase: 'practice', source: 'screen' },
    ])
    expect(inputPracticeComplete(progress.practice)).toBe(false)
    expect(progress.practice.held).toHaveLength(3)

    progress = reduce(progress, [
      { type: 'NOTE_OFF', phase: 'practice', note: 57, source: 'screen' },
      { type: 'NOTE_OFF', phase: 'practice', note: 60, source: 'screen' },
      { type: 'NOTE_OFF', phase: 'practice', note: 64, source: 'screen' },
    ])
    expect(inputPracticeComplete(progress.practice)).toBe(false)
    progress = firstSoundReducer(progress, {
      type: 'CONFIRM_SILENCE',
      phase: 'practice',
      now: 'quiet',
    })
    expect(inputPracticeComplete(progress.practice)).toBe(true)
  })

  it('allows fallback practice but never treats it as MIDI verification', () => {
    let progress = reachPractice()
    progress = reduce(progress, [
      ...noteCycle('practice', 57, 'screen'),
      ...noteCycle('practice', 60, 'computer'),
      ...noteCycle('practice', 64, 'screen'),
      { type: 'CONFIRM_SILENCE', phase: 'practice' },
      { type: 'GO_CHOOSE' },
      { type: 'HEARD_PRESET', preset: 'warm' },
      { type: 'HEARD_PRESET', preset: 'clear' },
      { type: 'CHOOSE_PRESET', preset: 'clear' },
      { type: 'GO_CHECK' },
      ...noteCycle('check', 57, 'screen'),
      ...noteCycle('check', 60, 'computer'),
      ...noteCycle('check', 64, 'screen'),
      { type: 'CONFIRM_SILENCE', phase: 'check' },
      { type: 'FINALIZE' },
    ])
    expect(progress.stage).toBe('check')
    expect(progress.check.completedCycles).toBe(0)
    expect(midiCheckComplete(progress.check)).toBe(false)
    expect(canCompleteFirstSound(progress)).toBe(false)
    expect(progress.checkpoint).toBeUndefined()
  })

  it('creates First Signal only after three MIDI press-release cycles', () => {
    let progress = reachCheck()
    progress = reduce(progress, [
      ...noteCycle('check', 57, 'midi'),
      ...noteCycle('check', 60, 'midi'),
      ...noteCycle('check', 64, 'midi'),
      { type: 'CONFIRM_SILENCE', phase: 'check', now: 'quiet' },
    ])
    expect(midiCheckComplete(progress.check)).toBe(true)
    expect(canCompleteFirstSound(progress)).toBe(true)

    progress = firstSoundReducer(progress, { type: 'FINALIZE', now: 'done' })
    expect(progress.stage).toBe('evidence')
    expect(progress.checkpoint).toEqual({
      name: 'first-signal-complete',
      savedAt: 'done',
    })
  })

  it('blocks finalisation when the MIDI keyboard disconnects', () => {
    let progress = reachCheck()
    progress = reduce(progress, [
      ...noteCycle('check', 57, 'midi'),
      ...noteCycle('check', 60, 'midi'),
      ...noteCycle('check', 64, 'midi'),
      { type: 'CONFIRM_SILENCE', phase: 'check' },
      { type: 'MIDI_STATUS', connected: false },
      { type: 'FINALIZE' },
    ])
    expect(progress.stage).toBe('check')
    expect(canCompleteFirstSound(progress)).toBe(false)
  })

  it('keeps completed quiet evidence when an idle device resets', () => {
    const progress = reachCheck()
    const next = firstSoundReducer(progress, { type: 'CANCEL_HELD' })

    expect(next.practice.silenceConfirmedAt).toBe(
      progress.practice.silenceConfirmedAt,
    )
    expect(inputPracticeComplete(next.practice)).toBe(true)
  })

  it('downgrades corrupt evidence that skips required practice', () => {
    const injected = {
      ...createInitialFirstSoundProgress('t0'),
      stage: 'evidence',
      midi: { connected: true, deviceName: 'Fake MIDI' },
      checkpoint: { name: 'first-signal-complete', savedAt: 'fake' },
      check: {
        ...createInitialFirstSoundProgress('t0').check,
        noteOns: 3,
        noteOffs: 3,
        completedCycles: 3,
        midiCycles: 3,
        audioSignals: 3,
        silenceConfirmedAt: 'fake',
        completedAt: 'fake',
      },
    }
    const normalised = normalizeFirstSoundProgress(injected, 'fallback')
    expect(normalised.stage).toBe('practice')
    expect(normalised.checkpoint).toBeUndefined()
    expect(canCompleteFirstSound(normalised)).toBe(false)
  })
})
