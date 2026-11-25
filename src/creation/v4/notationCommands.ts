import { assertStudioProject, compileArrangement, makeStudioId, MAX_BARS, type PatternNote, type StudioProject } from './model'
import { defaultNotation, DEFAULT_NOTE, scoreMeasure, scoreMeasureStartTick, scoreMeasureTicks, type MeasureNotation, type NoteNotation, type NotationState } from './notationModel'

type Notated = StudioProject & { notation?: NotationState }
export interface ScoreSelection { clipId: string; noteId: string }
export type ScoreCommand =
  | { type: 'update'; selection: ScoreSelection[]; patch: Partial<Omit<PatternNote, 'id'>>; notation?: Partial<NoteNotation>; linked?: boolean }
  | { type: 'delete' | 'rest'; selection: ScoreSelection[]; linked?: boolean }
  | { type: 'add'; clipId: string; notes: Omit<PatternNote, 'id'>[]; perNoteNotation?: NoteNotation[]; notation?: Partial<NoteNotation>; linked?: boolean }
  | { type: 'add-rest'; trackId: string; startTick: number; durationTicks: number; voice: number }
  | { type: 'tie'; selection: ScoreSelection[] }
  | { type: 'slur'; selection: ScoreSelection[] }
  | { type: 'measure'; index: number; patch: Partial<MeasureNotation> }
  | { type: 'insert-measure'; index: number }
  | { type: 'delete-measure'; index: number }

/** Cleanup is necessary when the piano roll or arrangement removes source notes. */
export function pruneNotation<T extends Notated>(project: T): T {
  if (!project.notation) return project
  const notes = new Set(project.patterns.flatMap(p => p.notes.map(n => n.id))), tracks = new Set(project.tracks.map(t => t.id))
  project.notation.notes = Object.fromEntries(Object.entries(project.notation.notes).filter(([id]) => notes.has(id)))
  project.notation.tracks = Object.fromEntries(Object.entries(project.notation.tracks).filter(([id]) => tracks.has(id)))
  project.notation.rests = project.notation.rests.filter(r => tracks.has(r.trackId) && r.startTick + r.durationTicks <= project.bars * 1920)
  const coverage = new Map<string, {start:number;end:number}[]>()
  for(const note of compileArrangement(project)) {
    const key=`${note.trackId}:${project.notation.notes[note.sourceNoteId]?.voice??1}`, spans=coverage.get(key)??[]
    spans.push({start:note.startTick,end:note.startTick+note.durationTicks});coverage.set(key,spans)
  }
  for(const [key,spans] of coverage) {
    const merged:{start:number;end:number}[]=[]
    for(const span of spans.sort((a,b)=>a.start-b.start)){const last=merged.at(-1);if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);else merged.push({...span})}
    coverage.set(key,merged)
  }
  const seen=new Set<string>()
  project.notation.rests=project.notation.rests.flatMap(rest=>{
    const spans=coverage.get(`${rest.trackId}:${rest.voice}`)??[], end=rest.startTick+rest.durationTicks
    let cursor=rest.startTick, low=0, high=spans.length
    while(low<high){const middle=(low+high)>>>1;if(spans[middle].end<=cursor)low=middle+1;else high=middle}
    const pieces:{start:number;end:number}[]=[]
    for(let i=low;i<spans.length&&spans[i].start<end;i++){if(cursor<spans[i].start)pieces.push({start:cursor,end:Math.min(end,spans[i].start)});cursor=Math.max(cursor,spans[i].end)}
    if(cursor<end)pieces.push({start:cursor,end})
    return pieces.flatMap((piece,index)=>{const key=`${rest.trackId}:${rest.voice}:${piece.start}:${piece.end}`;if(seen.has(key))return [];seen.add(key);return [{...rest,id:index?makeStudioId():rest.id,startTick:piece.start,durationTicks:piece.end-piece.start}]})
  })
  return project
}
export function applyScoreCommand(source: StudioProject, command: ScoreCommand): StudioProject {
  assertStudioProject(source)
  const project: Notated = structuredClone(source)
  project.notation ??= defaultNotation()
  const notation = project.notation
  // Root validation owns the version migration. This command explicitly upgrades only when notation is edited.
  Object.assign(project, { version: 6 })
  const finish = () => { pruneNotation(project); assertStudioProject(project); return project }
  if (command.type === 'add-rest') {
    if (compileArrangement(project).some(n => n.trackId === command.trackId && (notation.notes[n.sourceNoteId]?.voice ?? 1) === command.voice && n.startTick < command.startTick + command.durationTicks && n.startTick + n.durationTicks > command.startTick)) throw new Error('This voice already contains notes here. Select those notes and choose Make rest first.')
    notation.rests.push({id:makeStudioId(),trackId:command.trackId,startTick:command.startTick,durationTicks:command.durationTicks,voice:command.voice})
    return finish()
  }
  if (command.type === 'measure') {
    if (!Number.isInteger(command.index) || command.index < 0 || command.index >= 8192) throw new Error('Choose an existing score measure.')
    while (notation.measures.length <= command.index) notation.measures.push(scoreMeasure(project, notation.measures.length))
    notation.measures[command.index] = { ...notation.measures[command.index], ...command.patch }
    return finish()
  }
  if (command.type === 'insert-measure' || command.type === 'delete-measure') return editMeasure(project, command.index, command.type === 'insert-measure')
  const mappings = new Map<string, Map<string, string>>()
  const detach = (clipId: string, linked = false) => {
    const clip = project.clips.find(c => c.id === clipId)
    if (!clip) throw new Error('Select an arranged part first.')
    let pattern = project.patterns.find(p => p.id === clip.patternId)!
    if (!linked && !mappings.has(clipId) && project.clips.filter(c => c.patternId === pattern.id).length > 1) {
      const map = new Map<string, string>()
      pattern = { ...pattern, id: makeStudioId(), name: `${pattern.name.slice(0, 105)} · score copy`, notes: pattern.notes.map(n => {
        const id = makeStudioId(); map.set(n.id, id)
        if (notation.notes[n.id]) notation.notes[id] = { ...notation.notes[n.id] }
        return { ...n, id }
      }) }
      project.patterns.push(pattern); clip.patternId = pattern.id; mappings.set(clipId, map)
    }
    return { clip, pattern }
  }
  if (command.type === 'add') {
    const { pattern, clip } = detach(command.clipId, command.linked)
    for (const [index, note] of command.notes.entries()) {
      if (note.startTick < 0 || note.startTick >= pattern.lengthTicks || note.startTick + note.durationTicks + clip.startTick > project.bars * 1920) throw new Error('The new note must fit inside the part and project.')
      const id = makeStudioId(); pattern.notes.push({ ...note, id })
      if (command.notation || command.perNoteNotation?.[index]) notation.notes[id] = { ...DEFAULT_NOTE, ...command.notation, ...command.perNoteNotation?.[index] }
    }
  } else {
    const selected = command.selection.map(s => {
      const { clip, pattern } = detach(s.clipId, 'linked' in command && command.linked)
      const id = mappings.get(s.clipId)?.get(s.noteId) ?? s.noteId
      const note = pattern.notes.find(n => n.id === id)
      if (!note) throw new Error('That note no longer exists. Select the current note.')
      return { clip, pattern, note }
    })
    if (command.type === 'tie') {
      if (selected.length !== 2) throw new Error('Select two consecutive notes of the same pitch to tie.')
      const [a, b] = selected.sort((a, b) => a.note.startTick - b.note.startTick)
      if (a.pattern.id !== b.pattern.id || a.note.pitch !== b.note.pitch || a.note.startTick + a.note.durationTicks !== b.note.startTick) throw new Error('A tie needs consecutive notes of the same pitch in one part.')
      a.note.durationTicks += b.note.durationTicks; b.pattern.notes = b.pattern.notes.filter(n => n.id !== b.note.id)
    } else if (command.type === 'slur') {
      if (selected.length < 2) throw new Error('Select at least two notes for a slur.')
      const ordered = selected.sort((a, b) => a.clip.startTick + a.note.startTick - b.clip.startTick - b.note.startTick)
      for (const [index, s] of ordered.entries()) notation.notes[s.note.id] = { ...DEFAULT_NOTE, ...notation.notes[s.note.id], slur: index === 0 ? 'start' : index === ordered.length - 1 ? 'stop' : 'none' }
    } else for (const { note, pattern, clip } of selected) {
      if (command.type === 'update') {
        Object.assign(note, command.patch)
        if (note.startTick < 0 || note.startTick >= pattern.lengthTicks || note.startTick + note.durationTicks + clip.startTick > project.bars * 1920) throw new Error('The edited note must fit inside the part and project.')
        if (command.notation) notation.notes[note.id] = { ...DEFAULT_NOTE, ...notation.notes[note.id], ...command.notation }
      } else {
        pattern.notes = pattern.notes.filter(n => n.id !== note.id)
        if (command.type === 'rest') notation.rests.push({ id: makeStudioId(), trackId: clip.trackId, startTick: clip.startTick + note.startTick, durationTicks: note.durationTicks, voice: notation.notes[note.id]?.voice ?? 1 })
      }
    }
  }
  return finish()
}

/** Explicit structural edit. Flatten placed repetitions only; preserve unplaced drafts and original captures. */
function editMeasure(project: Notated, index: number, insert: boolean): StudioProject {
  if (!Number.isInteger(index) || index < 0 || index >= 8192) throw new Error('Choose a valid score measure.')
  const notation = project.notation!, start = scoreMeasureStartTick(project, index), length = scoreMeasureTicks(project, index), oldEnd = project.bars * 1920
  if (start >= oldEnd) throw new Error('Choose a measure inside the composition.')
  const end = insert ? oldEnd + length : oldEnd - length
  if (end <= 0 || Math.ceil(end / 1920) > MAX_BARS) throw new Error('The measure operation exceeds the project length limits.')
  const events = compileArrangement(project), placedIds = new Set(project.clips.map(c => c.patternId)), oldNotes = { ...notation.notes }
  project.patterns = project.patterns.filter(p => !placedIds.has(p.id)); project.clips = []
  project.bars = Math.ceil(end / 1920)
  for (const track of project.tracks) {
    const id = makeStudioId(), notes: PatternNote[] = []
    for (const e of events.filter(e => e.trackId === track.id)) {
      let a = e.startTick, b = a + e.durationTicks
      if (insert) { if (a >= start) a += length; if (b > start) b += length }
      else { if (a >= start && b <= start + length) continue; a = a >= start + length ? a - length : Math.min(a, start); b = b >= start + length ? b - length : Math.min(b, start) }
      if (b <= a) continue
      const noteId = makeStudioId(); notes.push({ id: noteId, pitch: e.pitch, startTick: a, durationTicks: b - a, velocity: e.velocity })
      if (oldNotes[e.sourceNoteId]) notation.notes[noteId] = { ...oldNotes[e.sourceNoteId] }
    }
    project.patterns.push({ id, trackId: track.id, name: `${track.name.slice(0, 95)} · edited score`, lengthTicks: project.bars * 1920, notes })
    project.clips.push({ id: makeStudioId(), trackId: track.id, patternId: id, startTick: 0 })
  }
  while (notation.measures.length <= index) notation.measures.push(scoreMeasure(project, notation.measures.length))
  if (insert) notation.measures.splice(index, 0, { ...scoreMeasure(project, index), newSystem: false, newPage: false }); else notation.measures.splice(index, 1)
  notation.rests = notation.rests.flatMap(r => {
    let a = r.startTick, b = a + r.durationTicks
    if (insert) { if (a >= start) a += length; if (b > start) b += length }
    else { a = a >= start + length ? a - length : Math.min(a, start); b = b >= start + length ? b - length : Math.min(b, start) }
    return b > a ? [{ ...r, startTick: a, durationTicks: b - a }] : []
  })
  pruneNotation(project); assertStudioProject(project); return project
}
