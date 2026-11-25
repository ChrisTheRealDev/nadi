/** Live voice ownership mirrors ideaToNotes' FIFO note-off and sustained-instance rules.
 * Device identity is deliberately transient; saved raw idea events keep their v4 schema.
 */
export interface LiveInputScope { source: 'midi' | 'screen'; deviceId?: string; channel: number }
type Held = { id: string; pitch: number; channelKey: string }

export class LiveOccurrences {
  private serial = 0
  private held = new Map<string, Held[]>()
  private released: Held[] = []
  private pedal = new Set<string>()
  private channel(scope: LiveInputScope) { return JSON.stringify([scope.source, scope.deviceId ?? '', scope.channel]) }
  private pitch(scope: LiveInputScope, pitch: number) { return JSON.stringify([scope.source, scope.deviceId ?? '', scope.channel, pitch]) }

  noteOn(scope: LiveInputScope, pitch: number): string {
    const key = this.pitch(scope, pitch), queue = this.held.get(key) ?? []
    const id = `live-occurrence-${++this.serial}`
    queue.push({ id, pitch, channelKey: this.channel(scope) }); this.held.set(key, queue)
    return id
  }

  /** Returns the one voice to release, or null while pedal holds that occurrence. */
  noteOff(scope: LiveInputScope, pitch: number): string | null {
    const key = this.pitch(scope, pitch), queue = this.held.get(key)
    const note = queue?.shift()
    if (!queue?.length) this.held.delete(key)
    if (!note) return null
    if (this.pedal.has(note.channelKey)) { this.released.push(note); return null }
    return note.id
  }

  /** Remove an exact occurrence whose asynchronous audio preparation failed. */
  cancel(id: string): void {
    for (const [key, queue] of this.held) {
      const index = queue.findIndex(note => note.id === id)
      if (index < 0) continue
      queue.splice(index, 1)
      if (!queue.length) this.held.delete(key)
      return
    }
    this.released = this.released.filter(note => note.id !== id)
  }

  /** Controller 64 releases pedal-up occurrences; 120/123 panic only this source/device/channel. */
  controller(scope: LiveInputScope, controller: number, value: number): string[] {
    const channel = this.channel(scope)
    if (controller === 64) {
      if (value >= 64) { this.pedal.add(channel); return [] }
      this.pedal.delete(channel)
      const ids = this.released.filter(note => note.channelKey === channel).map(note => note.id)
      this.released = this.released.filter(note => note.channelKey !== channel)
      return ids
    }
    if (controller !== 120 && controller !== 123) return []
    return this.allNotesOff(scope)
  }

  allNotesOff(scope?: LiveInputScope): string[] {
    if (!scope) {
      const ids = [...this.held.values()].flat().map(note => note.id).concat(this.released.map(note => note.id))
      this.held.clear(); this.released = []; this.pedal.clear(); return ids
    }
    const channel = this.channel(scope), ids: string[] = []
    for (const [key, queue] of this.held) if (queue[0]?.channelKey === channel) { ids.push(...queue.map(note => note.id)); this.held.delete(key) }
    ids.push(...this.released.filter(note => note.channelKey === channel).map(note => note.id))
    this.released = this.released.filter(note => note.channelKey !== channel); this.pedal.delete(channel)
    return ids
  }
}
