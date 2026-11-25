type Output = Pick<MIDIOutput, 'send'>
type Route = { output: Output; projectId: string; trackId: string; channel: number; onFailure?: () => void }
type Edge = { at: number; pitch: number; velocity: number; fallback?: () => void }

/** Cancellable note queue for browsers without MIDIOutput.clear(). */
export class ExternalMidi {
  private route?: Route
  private live = new Map<string, number>()
  private pending: Edge[] = []
  private sounding = new Uint32Array(128)
  private horizon = 0
  private timer?: ReturnType<typeof setTimeout>

  setRoute(output?: Output, projectId?: string, trackId?: string, channel?: number, onFailure?: () => void) {
    if (this.route && this.route.output === output && this.route.projectId === projectId && this.route.trackId === trackId && this.route.channel === channel) {
      this.route.onFailure = onFailure
      return
    }
    this.stop()
    this.route = output && projectId && trackId && typeof channel === 'number' && Number.isInteger(channel) && channel >= 1 && channel <= 16
      ? { output, projectId, trackId, channel, onFailure } : undefined
  }

  trackFor(projectId?: string) {
    return this.route?.projectId === projectId ? this.route?.trackId : undefined
  }

  schedule(pitch: number, velocity: number, at: number, end: number, fallback?: () => void) {
    if (!this.route || end <= at) return false
    this.pending.push({ at, pitch, velocity, fallback }, { at: end, pitch, velocity: 0 })
    return true
  }

  flush(horizon: number) {
    if (!this.route) return
    this.horizon = horizon
    // Off before On at the same timestamp re-attacks adjacent notes. Truly
    // overlapping occurrences share the pitch until the last one releases.
    this.pending.sort((a, b) => a.at - b.at || Number(a.velocity > 0) - Number(b.velocity > 0))
    this.drain()
  }

  noteOn(key: string, pitch: number, velocity: number) {
    if (!this.drain()) return false
    try {
      this.deliver({ at: performance.now(), pitch, velocity })
      this.live.set(key, pitch)
      return true
    } catch { this.fail(0); return false }
  }

  noteOff(key: string) {
    const pitch = this.live.get(key)
    if (pitch === undefined || !this.drain()) return
    this.live.delete(key)
    try { this.deliver({ at: performance.now(), pitch, velocity: 0 }) } catch { this.fail(0) }
  }

  silenceKeys() {
    if (!this.live.size || !this.drain()) return
    const at = performance.now()
    try {
      for (const pitch of this.live.values()) this.deliver({ at, pitch, velocity: 0 })
      this.live.clear()
    } catch { this.fail(0) }
  }

  stop() {
    this.cancelTimer()
    if (this.route) {
      for (let pitch = 0; pitch < this.sounding.length; pitch++) {
        if (this.sounding[pitch] === 0) continue
        try { this.send(false, pitch, 0) } catch { /* disconnected output */ }
      }
    }
    this.pending = []; this.live.clear(); this.sounding.fill(0); this.horizon = 0
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private drain() {
    if (!this.route) return false
    this.cancelTimer()
    const now = performance.now()
    let delivered = 0
    try {
      for (const edge of this.pending) {
        if (edge.at > now || edge.at >= this.horizon) break
        this.deliver(edge)
        delivered++
      }
    } catch { this.fail(delivered); return false }
    if (delivered) this.pending.splice(0, delivered)
    const next = this.pending[0]
    if (next && next.at < this.horizon) this.timer = setTimeout(() => this.drain(), Math.ceil(Math.max(0, next.at - performance.now())))
    return true
  }

  private fail(delivered: number) {
    const pending = this.pending.slice(delivered)
    const onFailure = this.route?.onFailure
    this.stop(); this.route = undefined
    for (const edge of pending) edge.fallback?.()
    onFailure?.()
  }

  private deliver(edge: Edge) {
    const previous = this.sounding[edge.pitch]
    const next = Math.max(0, previous + (edge.velocity ? 1 : -1))
    if (previous === 0 && next > 0) this.send(true, edge.pitch, edge.velocity, edge.at)
    else if (previous > 0 && next === 0) this.send(false, edge.pitch, 0, edge.at)
    this.sounding[edge.pitch] = next
  }

  private send(on: boolean, pitch: number, velocity: number, at?: number) {
    const route = this.route!
    route.output.send([(on ? 0x90 : 0x80) | (route.channel - 1), pitch, velocity], at)
  }
}
