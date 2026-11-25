import { noteName } from '../model'
import { applyScoreCommand } from './notationCommands'
import type { StudioProject } from './model'
import type { ScoreMapping } from './sheetMusic'

/** Staff steps preserve the written accidental, then convert back to sounding MIDI. */
export function moveWrittenPitch(pitch: number, steps: number, flats: boolean) {
  const naturals = [0, 2, 4, 5, 7, 9, 11]
  const pc = pitch % 12
  let degree = naturals.findIndex(n => n === pc), alter = 0
  if (degree < 0) { degree = naturals.findIndex(n => n === pc + (flats ? 1 : -1)); alter = flats ? -1 : 1 }
  const absolute = Math.floor(pitch / 12) * 7 + degree + steps
  return Math.floor(absolute / 7) * 12 + naturals[((absolute % 7) + 7) % 7] + alter
}

export function bindScoreDrag(target: HTMLElement | SVGElement, options: {
  source: ScoreMapping; project: StudioProject; staffStep: () => number; pixelsPerBeat: () => number; flats: boolean
  commit: (project: StudioProject, label: string) => boolean; status: (text: string) => void
}) {
  const { source, project } = options
  let cleanup = () => {}, suppressClick = false
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.shiftKey) return
    const clip = project.clips.find(c => c.id === source.clipId)
    const note = project.patterns.find(p => p.id === clip?.patternId)?.notes.find(n => n.id === source.noteId)
    if (!clip || !note) return
    cleanup(); event.preventDefault()
    const x = event.clientX, y = event.clientY
    let moved = false, pitch = note.pitch, tick = note.startTick
    const ghost = document.createElement('div'); ghost.className = 'nadi-score-drag-preview'; ghost.setAttribute('role', 'status')
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      const dx = e.clientX - x, dy = e.clientY - y
      if (Math.hypot(dx, dy) < 4 && !moved) return
      moved = true
      const steps = Math.round(-dy / Math.max(2, options.staffStep()))
      pitch = note.pitch + moveWrittenPitch(source.pitch, steps, options.flats) - source.pitch
      tick = note.startTick + Math.round(dx / Math.max(16, options.pixelsPerBeat()) * 4) * 120
      ghost.textContent = `${noteName(Math.max(0, Math.min(127, pitch)))} · beat ${(clip.startTick + tick) / 480 + 1}${pitch < 0 || pitch > 127 || tick < 0 ? ' · outside range' : ''}`
      ghost.style.left = `${Math.max(8, Math.min(innerWidth - 260, e.clientX + 16))}px`; ghost.style.top = `${Math.max(8, Math.min(innerHeight - 55, e.clientY - 40))}px`
      if (!ghost.isConnected) document.body.appendChild(ghost)
      target.classList.add('is-dragging'); e.preventDefault()
    }
    const cancel = () => { cleanup(); options.status('Drag cancelled. The score is unchanged.') }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      suppressClick = moved; cleanup()
      if (!moved || pitch === note.pitch && tick === note.startTick) return
      try {
        const next = applyScoreCommand(project, { type: 'update', selection: [{ clipId: clip.id, noteId: note.id }], linked: false, patch: { pitch, startTick: tick } })
        if (options.commit(next, 'Dragged score note')) options.status('Note moved. Undo is available.')
      } catch (error) { options.status(`${error instanceof Error ? error.message : 'That position is unavailable.'} The score is unchanged.`) }
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() } }
    cleanup = () => { ghost.remove(); target.classList.remove('is-dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel) }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel)
  }
  const click = (e: MouseEvent) => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false } }
  target.style.touchAction = 'none'; target.classList.add('is-editable')
  target.addEventListener('pointerdown', down as EventListener); target.addEventListener('click', click as EventListener, true)
  return {
    cancel: () => { cleanup(); suppressClick = false },
    dispose: () => { cleanup(); target.removeEventListener('pointerdown', down as EventListener); target.removeEventListener('click', click as EventListener, true) },
  }
}
