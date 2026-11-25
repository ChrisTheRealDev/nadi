import { compileArrangement, isMelodicSound, type StudioProject, type Track } from './model'
import { instrumentProfile, soundingToWrittenOffset } from './instrumentProfiles'
import { DEFAULT_NOTE, DEFAULT_TRACK, scoreMeasure, scoreMeasureTicks, type NoteNotation } from './notationModel'

export interface ScoreOptions { trackId?: string; grid: 1 | 60 | 120 | 240; spelling: 'sharps' | 'flats'; pitchMode?: 'concert' | 'written'; staffSize?: number }
interface ScoreNote { pitch: number; start: number; end: number; clipId: string; noteId: string; meta: NoteNotation; rest?: boolean }
interface Chord { start: number; end: number; notes: ScoreNote[] }
export interface ScoreMapping { voice: number; staffIndex: number; tick: number; pitch: number; clipId: string; noteId: string }
export interface ScoreResult { xml: string; noteCount: number; roundedNotes: number; bars: number; partCount: number; mapping: ScoreMapping[]; warnings: string[] }
const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
const durations: [number, string, boolean][] = [[1920,'whole',false],[1440,'half',true],[960,'half',false],[720,'quarter',true],[480,'quarter',false],[360,'eighth',true],[240,'eighth',false],[180,'16th',true],[120,'16th',false],[90,'32nd',true],[60,'32nd',false],[30,'64th',false]]
// Stored note limits do not bound notation: held notes split across measures,
// overlapping durations create voices, and each voice needs rests in every bar.
const MAX_SCORE_SYMBOLS = 20_000
const MAX_SCORE_VOICE_MEASURES = 8_192
const MAX_SCORE_SEARCH_STEPS = 250_000
const MAX_SCORE_CHORD_SCANS = 8_000_000
interface ScoreBudget { symbols: number; searches: number; voiceMeasures: number; chordScans: number }
function scoreTooComplex(): never {
  throw new RangeError('This score needs too much notation to display safely. Choose a single instrument part, or shorten held notes and reduce overlapping voices in a separate copy. Your composition is unchanged; you can still save .nadi or MIDI.')
}
function measureIndex(boundaries: number[], tick: number): number {
  let low = 0, high = boundaries.length - 1
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (boundaries[middle] <= tick) low = middle; else high = middle - 1 }
  return low
}
function pitchXml(pitch: number, spelling: ScoreOptions['spelling']) {
  const names = spelling === 'sharps' ? ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] : ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
  const name = names[((pitch % 12) + 12) % 12]
  return `<pitch><step>${name[0]}</step>${name.length > 1 ? `<alter>${name[1] === '#' ? 1 : -1}</alter>` : ''}<octave>${Math.floor(pitch / 12) - 1}</octave></pitch>`
}
function voicesFor(notes: ScoreNote[], budget: ScoreBudget): {voiceId:number;chords:Chord[]}[] {
  const groups = new Map<string, Chord>()
  for (const note of notes) { const key = `${note.meta.voice}:${note.start}:${note.end}:${note.rest ? 1 : 0}`; const chord = groups.get(key) ?? { start:note.start,end:note.end,notes:[] };chord.notes.push(note);groups.set(key,chord) }
  const voices: {voiceId:number;chords:Chord[]}[] = [], used=new Set(notes.map(n=>n.meta.voice))
  for (let explicit=1;explicit<=8;explicit++) {
    const subset: Chord[][]=[]
    for (const chord of [...groups.values()].filter(c=>c.notes[0].meta.voice===explicit).sort((a,b)=>a.start-b.start||b.end-a.end)) {
      chord.notes.sort((a,b)=>a.pitch-b.pitch);const voice=subset.find(v=>{if(++budget.searches>MAX_SCORE_SEARCH_STEPS)scoreTooComplex();return v[v.length-1].end<=chord.start})
      if(voice)voice.push(chord);else subset.push([chord])
    }
    for(const [index,chords] of subset.entries()){let voiceId=explicit;if(index){voiceId=1;while(used.has(voiceId)){if(++budget.searches>MAX_SCORE_SEARCH_STEPS)scoreTooComplex();voiceId++}used.add(voiceId)}voices.push({voiceId,chords})}
  }
  return voices.length ? voices : [{voiceId:1,chords:[]}]
}
function spanXml(start:number,end:number,chord:Chord|undefined,voice:number,staff:number,track:Track,options:ScoreOptions,mapping:ScoreMapping[],staffIndex:number,measureStart:number,groupRests:boolean,budget:ScoreBudget) {
  let xml=''
  while(start<end) {
    const meta=chord?.notes[0].meta??DEFAULT_NOTE,ratio=meta.tuplet===3?2/3:meta.tuplet===5?4/5:1,remaining=end-start
    // In simple meter, rests expose the beat: an offbeat gap first reaches
    // the next beat, and longer rests begin on their own metric boundary.
    const isRest=!chord||!!chord.notes[0]?.rest
    const metricRest=isRest&&groupRests&&(start-measureStart)%30===0&&(end-measureStart)%30===0
    const entry=durations.find(d=>Number.isInteger(d[0]*ratio)&&d[0]*ratio<=remaining
      &&(!metricRest||(!d[2]&&(start-measureStart)%d[0]===0)))
    const ticks=entry?entry[0]*ratio:remaining,type=entry?.[1]??'quarter',dot=entry?.[2]??false
    const actual=entry?meta.tuplet:480,normal=entry?meta.tuplet===3?2:meta.tuplet===5?4:1:ticks
    const tones:(ScoreNote|null)[]=chord?.notes[0]?.rest?[chord.notes[0]]:chord?.notes??[null]
    budget.symbols+=tones.length
    if(budget.symbols>MAX_SCORE_SYMBOLS)scoreTooComplex()
    const dynamic=chord?.notes.find(n=>n.meta.dynamic!=='none')?.meta.dynamic
    if(chord&&start===chord.start&&dynamic)xml+=`<direction><direction-type><dynamics><${dynamic}/></dynamics></direction-type><voice>${voice}</voice><staff>${staff}</staff></direction>`
    for(const [index,note] of tones.entries()) {
      const stop=!!chord&&!note?.rest&&start>chord.start,begin=!!chord&&!note?.rest&&start+ticks<chord.end,first=!chord||start===chord.start,last=!chord||start+ticks===chord.end,n=note?.meta??DEFAULT_NOTE
      const tied=`${stop?'<tied type="stop"/>':''}${begin?'<tied type="start"/>':''}`,slur=!note?.rest&&n.slur!=='none'&&(n.slur==='start'?first:last)?`<slur type="${n.slur}" number="1"/>`:'',art=!note?.rest&&n.articulation!=='none'&&first?`<articulations><${n.articulation}/></articulations>`:''
      const drum=track.soundId==='kick'?['F',4]:track.soundId==='snare'?['C',5]:['G',5]
      const tone=!note||note.rest?'<rest/>':isMelodicSound(track.soundId)?pitchXml(note.pitch,options.spelling):`<unpitched><display-step>${drum[0]}</display-step><display-octave>${drum[1]}</display-octave></unpitched>`
      xml+=`<note>${index?'<chord/>':''}${tone}<duration>${ticks}</duration>${stop?'<tie type="stop"/>':''}${begin?'<tie type="start"/>':''}<voice>${voice}</voice><type>${type}</type>${dot?'<dot/>':''}${actual!==1?`<time-modification><actual-notes>${actual}</actual-notes><normal-notes>${normal}</normal-notes></time-modification>`:''}<staff>${staff}</staff>${track.soundId==='hat'&&note?'<notehead>x</notehead>':''}${tied||slur||art?`<notations>${tied}${slur}${art}</notations>`:''}</note>`
      if(note&&!note.rest)mapping.push({voice,staffIndex,tick:start,pitch:note.pitch,clipId:note.clipId,noteId:note.noteId})
    }
    start+=ticks
  }
  return xml
}
/** Read-only score projection. Grid affects export only; exact mode preserves 480 PPQ timing. */
export function createSheetMusic(project:StudioProject,options:ScoreOptions={grid:120,spelling:'sharps'}):ScoreResult {
  if(![1,60,120,240].includes(options.grid))throw new Error('Unsupported notation grid.')
  const notation=project.notation,events=compileArrangement(project).filter(n=>!options.trackId||n.trackId===options.trackId)
  const rests=(notation?.rests??[]).filter(r=>!options.trackId||r.trackId===options.trackId)
  if(!events.length&&!rests.length)throw new Error('There are no arranged notes to notate. Add notes to a part placed in Arrangement first.')
  let roundedNotes=0
  const notes:(ScoreNote & {trackId:string})[]=events.map(n=>{const start=Math.min(project.bars*1920-options.grid,Math.round(n.startTick/options.grid)*options.grid),end=Math.min(project.bars*1920,Math.max(start+options.grid,Math.round((n.startTick+n.durationTicks)/options.grid)*options.grid));if(start!==n.startTick||end!==n.startTick+n.durationTicks)roundedNotes++;return {pitch:n.pitch,start,end,trackId:n.trackId,clipId:n.clipId,noteId:n.sourceNoteId,meta:{...DEFAULT_NOTE,...notation?.notes[n.sourceNoteId]}}})
  notes.push(...rests.map(r=>({pitch:0,start:r.startTick,end:r.startTick+r.durationTicks,trackId:r.trackId,clipId:'',noteId:r.id,meta:{...DEFAULT_NOTE,voice:r.voice,staff:1 as const},rest:true})))
  const extent=notes.reduce((end,n)=>Math.max(end,n.end),0),boundaries:number[]=[0]
  while(boundaries.at(-1)!<extent)boundaries.push(boundaries.at(-1)!+scoreMeasureTicks(project,boundaries.length-1))
  // Reject the minimum tied-note expansion before allocating XML or voice lists.
  let projectedSymbols=0
  for(const note of notes){projectedSymbols+=measureIndex(boundaries,note.end-1)-measureIndex(boundaries,note.start)+1;if(projectedSymbols>MAX_SCORE_SYMBOLS)scoreTooComplex()}
  const budget:ScoreBudget={symbols:0,searches:0,voiceMeasures:0,chordScans:0}
  const bars=boundaries.length-1,tracks=project.tracks.filter(t=>notes.some(n=>n.trackId===t.id)),mapping:ScoreMapping[]=[],warnings:string[]=[]
  let staffOffset=0
  const written=options.pitchMode==='written'||(!options.pitchMode&&!!options.trackId)
  const parts=tracks.map((track,partIndex)=>{
    const profile=instrumentProfile(track.soundId),config={...DEFAULT_TRACK,...notation?.tracks[track.id]},shift=written?soundingToWrittenOffset(profile):0,trackNotes=notes.filter(n=>n.trackId===track.id).map(n=>({...n,pitch:n.pitch+shift})),grand=profile.grandStaff
    const staffs=grand?[trackNotes.filter(n=>n.meta.staff===1||n.meta.staff===0&&n.pitch-shift>=config.staffSplit),trackNotes.filter(n=>n.meta.staff===2||n.meta.staff===0&&n.pitch-shift<config.staffSplit)]:[trackNotes],staffVoices=staffs.map(notes=>voicesFor(notes,budget))
    for(const voices of staffVoices){budget.voiceMeasures+=voices.length*bars;budget.chordScans+=voices.reduce((total,voice)=>total+voice.chords.length,0)*bars}
    if(budget.voiceMeasures>MAX_SCORE_VOICE_MEASURES||budget.chordScans>MAX_SCORE_CHORD_SCANS)scoreTooComplex()
    const custom={treble:{sign:'G',line:2},bass:{sign:'F',line:4},alto:{sign:'C',line:3},tenor:{sign:'C',line:4}}
    const clefs=staffs.map((_,i)=>{const c=grand?{sign:i?'F':'G',line:i?4:2}:config.clef==='auto'?profile.clef:custom[config.clef];return `<clef number="${i+1}"><sign>${c.sign}</sign>${c.sign==='percussion'?'':`<line>${c.line}</line>`}</clef>`}).join('')
    const transpose=written&&shift?`<transpose><diatonic>${profile.transpose.diatonic}</diatonic><chromatic>${profile.transpose.chromatic}</chromatic>${profile.transpose.octaveChange?`<octave-change>${profile.transpose.octaveChange}</octave-change>`:''}</transpose>`:''
    if(['synthetic','approximation','ensemble'].includes(profile.kind))warnings.push(`${track.name}: ${profile.assumption}`)
    let measures=''
    for(let bar=0;bar<bars;bar++) {
      const start=boundaries[bar],end=boundaries[bar+1],m=scoreMeasure(project,bar);let body='',voiceNumber=0
      staffVoices.forEach((voices,staffIndex)=>voices.forEach(({voiceId,chords:voice})=>{const number=voiceId+staffIndex*8;if(voiceNumber++)body+=`<backup><duration>${end-start}</duration></backup>`;let cursor=start;for(const chord of voice.filter(c=>c.end>start&&c.start<end)){const a=Math.max(start,chord.start),b=Math.min(end,chord.end);if(cursor<a)body+=spanXml(cursor,a,undefined,number,staffIndex+1,track,options,mapping,staffOffset+staffIndex,start,m.beatType===4&&m.beats<=4,budget);body+=spanXml(a,b,chord,number,staffIndex+1,track,options,mapping,staffOffset+staffIndex,start,m.beatType===4&&m.beats<=4,budget);cursor=b}if(cursor<end)body+=spanXml(cursor,end,undefined,number,staffIndex+1,track,options,mapping,staffOffset+staffIndex,start,m.beatType===4&&m.beats<=4,budget)}))
      let fifths=m.keyFifths+(written?(shift*7)%12:0);while(fifths>7)fifths-=12;while(fifths< -7)fifths+=12
      const previous = bar > 0 ? scoreMeasure(project, bar - 1) : undefined
      const keyChanged = !previous || previous.keyFifths !== m.keyFifths
      const meterChanged = !previous || previous.beats !== m.beats || previous.beatType !== m.beatType
      measures+=`<measure number="${bar+1}">${m.newPage||m.newSystem?`<print${m.newPage?' new-page="yes"':' new-system="yes"'}/>`:''}<attributes>${bar===0?'<divisions>480</divisions>':''}${keyChanged?`<key><fifths>${fifths}</fifths></key>`:''}${meterChanged?`<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>`:''}${bar===0?`<staves>${staffs.length}</staves>${clefs}${transpose}`:''}</attributes>${bar===0&&partIndex===0?`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${project.bpm}</per-minute></metronome></direction-type><sound tempo="${project.bpm}"/></direction>`:''}${body}${bar===bars-1?'<barline location="right"><bar-style>light-heavy</bar-style></barline>':''}</measure>`
    }
    staffOffset+=staffs.length;return `<part id="P${partIndex+1}">${measures}</part>`
  }).join('')
  const title=options.trackId?`${project.name} — ${tracks[0].name}`:project.name
  const xml=`<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work><identification><creator type="composer">NADI · ${written?'Written':'Concert'} pitch</creator></identification><defaults><scaling><millimeters>${options.staffSize??7}</millimeters><tenths>40</tenths></scaling></defaults><part-list>${tracks.map((t,i)=>`<score-part id="P${i+1}"><part-name>${escapeXml(t.name)}</part-name><part-abbreviation>${escapeXml(t.name.slice(0,12))}</part-abbreviation><score-instrument id="I${i+1}"><instrument-name>${t.soundId}</instrument-name></score-instrument></score-part>`).join('')}</part-list>${parts}</score-partwise>`
  return {xml,noteCount:events.length,roundedNotes,bars,partCount:tracks.length,mapping,warnings}
}

/** Rendered unisons must never silently resolve to another source note.
 * Ambiguous same-voice overlaps remain available in the explicit note list. */
export function scoreSourceLookup(mapping: ScoreMapping[]) {
  const sources = new Map<string, ScoreMapping | null>()
  for (const source of mapping) {
    const key = `${source.staffIndex}:${source.voice}:${source.tick}:${source.pitch}`
    sources.set(key, sources.has(key) ? null : source)
  }
  return sources
}
