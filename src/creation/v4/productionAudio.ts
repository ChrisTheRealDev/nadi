import type { Track } from './model'

export const HALL_TAIL_SECONDS = 4
export const VOICE_TAIL_SECONDS = .85
export function productionTail(tracks: readonly Track[]) {
  return VOICE_TAIL_SECONDS + (tracks.some(track => !track.muted && track.level > 0 && track.space > 0 && !track.spaceBypass) ? HALL_TAIL_SECONDS : 0)
}

/** Absolute-song-tick gain envelope: hold endpoint values; interpolate between points. */
export function expressionAt(points: Track['expression'], tick: number): number {
  if (!points.length) return 1
  if (tick <= points[0].tick) return points[0].value
  let previous = points[0]
  for (const point of points) {
    if (point.tick > tick) return previous.value + (point.value - previous.value) * (tick - previous.tick) / (point.tick - previous.tick)
    previous = point
  }
  return previous.value
}

/** Procedurally generated, deterministic stereo hall IR. No external copyrighted recording. */
export function hallImpulse(context: BaseAudioContext) {
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * HALL_TAIL_SECONDS), context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel); let seed = 19087 + channel * 3911, smooth = 0
    for (let i = 0; i < data.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0
      smooth = smooth * .55 + (seed / 4294967296 * 2 - 1) * .45
      const time = i / context.sampleRate
      data[i] = time < .02 ? 0 : smooth * Math.exp(-time * 2.3) * Math.min(1, (time - .02) / .06) * .075
    }
    for (const [delay, gain] of [[.031, .23], [.047, .16], [.071, .11], [.113, .07]]) data[Math.floor((delay + channel * .003) * context.sampleRate)] += gain
  }
  return buffer
}

/** One hall per output graph; channel gain remains the stable voice input. */
export function productionRouting(context: BaseAudioContext, destination: AudioNode) {
  type Route = { input: GainNode; expression: GainNode; pan: StereoPannerNode; send: GainNode; track: Track }
  const routes = new Map<string, Route>()
  let hall: ConvolverNode | undefined
  const getHall = () => {
    if (!hall) { hall = context.createConvolver(); hall.normalize = false; hall.buffer = hallImpulse(context); hall.connect(destination) }
    return hall
  }
  const connect = (input: GainNode, track: Track, tick: number) => {
    let route = routes.get(track.id)
    const active = track.pan !== 0 || track.space !== 0 || track.expression.length > 0
    if (!route && !active) return input
    if (!route) {
      input.disconnect()
      const expression = context.createGain(), pan = context.createStereoPanner(), send = context.createGain()
      input.connect(expression); expression.connect(pan); pan.connect(destination); pan.connect(send)
      route = { input, expression, pan, send, track }; routes.set(track.id, route)
    }
    route.track = track
    route.pan.pan.setValueAtTime(track.pan, context.currentTime)
    route.send.gain.setValueAtTime(track.spaceBypass ? 0 : track.space * .45, context.currentTime)
    route.send.disconnect()
    if (track.space > 0 && !track.spaceBypass) route.send.connect(getHall())
    route.expression.gain.cancelScheduledValues(context.currentTime)
    route.expression.gain.setValueAtTime(expressionAt(track.expression, tick), context.currentTime)
    return route.pan
  }
  const remove = (id: string) => {
    const route = routes.get(id)
    if (route) { route.expression.disconnect(); route.pan.disconnect(); route.send.disconnect(); routes.delete(id) }
  }
  const position = (tick: number) => {
    for (const route of routes.values()) { route.expression.gain.cancelScheduledValues(context.currentTime); route.expression.gain.setValueAtTime(expressionAt(route.track.expression, tick), context.currentTime) }
  }
  const schedule = (startTick: number, endTick: number, at: number, secondsPerTick: number) => {
    for (const route of routes.values()) {
      const param = route.expression.gain, points = route.track.expression
      param.setValueAtTime(expressionAt(points, startTick), at)
      for (const point of points) if (point.tick > startTick && point.tick < endTick) param.linearRampToValueAtTime(point.value, at + (point.tick - startTick) * secondsPerTick)
      param.linearRampToValueAtTime(expressionAt(points, endTick), at + (endTick - startTick) * secondsPerTick)
    }
  }
  return { connect, remove, position, schedule, dispose: () => { for (const id of routes.keys()) remove(id); hall?.disconnect(); hall = undefined } }
}
