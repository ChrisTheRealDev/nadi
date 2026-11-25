import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from './model'
import { expressionAt, hallImpulse, productionRouting, productionTail } from './productionAudio'

function harness() {
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const gains: (ReturnType<typeof node> & { gain: ReturnType<typeof param> })[] = []
  const context = {
    currentTime: 3, sampleRate: 1000,
    createGain: () => { const gain = { ...node(), gain: param() }; gains.push(gain); return gain },
    createStereoPanner: vi.fn(() => ({ ...node(), pan: param() })),
    createConvolver: vi.fn(() => ({ ...node(), buffer: null, normalize: true })),
    createBuffer: (_channels: number, length: number) => { const channels = [new Float32Array(length), new Float32Array(length)]; return { length, getChannelData: (channel: number) => channels[channel] } },
  }
  return { context: context as unknown as BaseAudioContext, mock: context, gains }
}

describe('shared production processing', () => {
  it('holds endpoints, interpolates exact positions, and defaults to neutral', () => {
    const points = [{ tick: 100, value: .2 }, { tick: 300, value: .8 }]
    expect(expressionAt([], 500)).toBe(1)
    expect(expressionAt(points, 0)).toBe(.2)
    expect(expressionAt(points, 200)).toBeCloseTo(.5)
    expect(expressionAt(points, 800)).toBe(.8)
  })
  it('uses one deterministic bounded stereo hall for multiple track sends', () => {
    const { context, mock } = harness(), routing = productionRouting(context, {} as AudioNode)
    const track = createStudioProject().tracks[0]; track.space = .5; track.pan = -.5
    routing.connect(context.createGain(), track, 0)
    routing.connect(context.createGain(), { ...track, id: 'second' }, 0)
    expect(mock.createConvolver).toHaveBeenCalledTimes(1)
    const a = hallImpulse(context), b = hallImpulse(context)
    expect(a.length).toBe(4000)
    expect(a.getChannelData(0)).toEqual(b.getChannelData(0))
    expect(a.getChannelData(0)).not.toEqual(a.getChannelData(1))
    routing.dispose()
  })
  it('preserves the legacy neutral path without creating production nodes', () => {
    const { context, mock } = harness(), routing = productionRouting(context, {} as AudioNode)
    const track = createStudioProject().tracks[0], input = context.createGain()
    expect(routing.connect(input, track, 0)).toBe(input)
    expect(mock.createStereoPanner).not.toHaveBeenCalled()
    expect(mock.createConvolver).not.toHaveBeenCalled()
    expect(productionTail([track])).toBe(.85)
  })
  it('schedules held-note expression from a seek position and can restart the same loop envelope', () => {
    const { context, gains } = harness(), routing = productionRouting(context, {} as AudioNode)
    const track = createStudioProject().tracks[0]; track.expression = [{ tick: 0, value: .2 }, { tick: 960, value: .8 }]
    routing.connect(context.createGain(), track, 480)
    const expression = gains[1].gain
    expect(expression.setValueAtTime).toHaveBeenLastCalledWith(.5, 3)
    routing.schedule(480, 1440, 4, 1 / 960)
    expect(expression.setValueAtTime).toHaveBeenLastCalledWith(.5, 4)
    expect(expression.linearRampToValueAtTime).toHaveBeenCalledWith(.8, 4.5)
    routing.schedule(0, 960, 6, 1 / 960)
    expect(expression.setValueAtTime).toHaveBeenLastCalledWith(.2, 6)
    routing.position(0)
    expect(expression.cancelScheduledValues).toHaveBeenLastCalledWith(3)
  })
  it('bounds wet render tails and excludes muted, silent or bypassed sends', () => {
    const track = createStudioProject().tracks[0]; track.space = .5
    expect(productionTail([track])).toBe(4.85)
    expect(productionTail([{ ...track, muted: true }])).toBe(.85)
    expect(productionTail([{ ...track, level: 0 }])).toBe(.85)
    expect(productionTail([{ ...track, spaceBypass: true }])).toBe(.85)
  })
})
