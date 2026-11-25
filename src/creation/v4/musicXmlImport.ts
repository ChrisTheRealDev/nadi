import { assertStudioProject, defaultTrackProduction, isSoundId, makeStudioId, MAX_BARS, MAX_NOTES, MAX_TRACKS, SOUND_IDS, SOUND_LABELS, type PatternNote, type SoundId, type StudioProject } from './model'
import { defaultNotation, DEFAULT_MEASURE, DEFAULT_NOTE, DEFAULT_TRACK, type MeasureNotation, type NoteNotation } from './notationModel'
export interface MusicXmlImport { project:StudioProject; warnings:string[]; noteCount:number; partCount:number }
/** Parse only on explicit file selection. No external references, audio, or model calls are made. */
export function importMusicXml(xml:string,source:StudioProject,parser:DOMParser=new DOMParser()):MusicXmlImport {
  if(xml.length>10_000_000)throw new Error('MusicXML exceeds the 10 MB import limit.')
  if(/<!ENTITY/i.test(xml))throw new Error('XML entity declarations are not supported.')
  const doc=parser.parseFromString(xml,'application/xml')
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='score-partwise')throw new Error('Choose an uncompressed score-partwise MusicXML or XML file.')
  const warnings=new Set<string>(),project=structuredClone(source)
  project.version=6;project.notation=defaultNotation();project.patterns=[];project.clips=[];project.tracks=[]
  const notation=project.notation
  const unsupported=['lyric','grace','ornaments','technical','harmony','figured-bass','repeat','ending','octave-shift','wedge','pedal','staff-tuning','transpose > double']
  for(const selector of unsupported)if(doc.querySelector(selector))warnings.add(`${selector}: not imported; review the original score.`)
  const parts=Array.from(doc.documentElement.children).filter(e=>e.localName==='part')
  if(parts.length>MAX_TRACKS)throw new Error(`At most ${MAX_TRACKS} parts can be imported.`)
  let noteCount=0,extent=0,baseTempo:number|undefined
  const text=(parent:Element,selector:string,fallback='')=>parent.querySelector(selector)?.textContent?.trim()??fallback
  const number=(parent:Element,selector:string,fallback:number)=>Number(text(parent,selector,String(fallback)))
  for(const [partIndex,part] of parts.entries()) {
    const entry=Array.from(doc.querySelectorAll('score-part')).find(e=>e.getAttribute('id')===part.getAttribute('id'))
    const name=entry?text(entry,'part-name',`Part ${partIndex+1}`):`Part ${partIndex+1}`,instrument=entry?text(entry,'instrument-name'):''
    const sound:SoundId=isSoundId(instrument)?instrument:SOUND_IDS.find(s=>name.toLowerCase().includes(SOUND_LABELS[s].toLowerCase()))??'piano'
    if(!isSoundId(instrument)&&sound==='piano'&&!name.toLowerCase().includes('piano'))warnings.add(`${name}: instrument not identified; assigned Piano for review.`)
    const trackId=makeStudioId(),patternId=makeStudioId(),notes:PatternNote[]=[],ties=new Map<string,PatternNote>()
    project.tracks.push({id:trackId,name:name.slice(0,120)||'Imported part',color:['#56b89a','#d2a45c','#809dd2','#cb8277'][partIndex%4],soundId:sound,soundVersion:1,level:100,muted:false,hidden:false,...defaultTrackProduction()})
    let divisions=480,measureStart=0,meter:MeasureNotation={...DEFAULT_MEASURE},transpose=0,lastDynamic:NoteNotation['dynamic']='none'
    const measures=Array.from(part.children).filter(e=>e.localName==='measure')
    for(const [measureIndex,measure] of measures.entries()) {
      const attrs=measure.querySelector('attributes')
      if(attrs) {
        divisions=number(attrs,'divisions',divisions)
        if(!Number.isFinite(divisions)||divisions<=0)throw new Error('The score has invalid divisions.')
        meter={...meter,beats:number(attrs,'time > beats',meter.beats),beatType:number(attrs,'time > beat-type',meter.beatType) as MeasureNotation['beatType'],keyFifths:number(attrs,'key > fifths',meter.keyFifths),newPage:false,newSystem:false}
        if(attrs.querySelector('transpose'))transpose=number(attrs,'transpose > chromatic',0)+12*number(attrs,'transpose > octave-change',0)
        const clef=text(attrs,'clef > sign'),line=number(attrs,'clef > line',2)
        if(clef&&measureIndex>0&&notation.tracks[trackId])warnings.add(`${name}: mid-part clef changes are not yet preserved; the initial clef is used.`)
        if(clef&&!notation.tracks[trackId])notation.tracks[trackId]={...DEFAULT_TRACK,clef:clef==='F'?'bass':clef==='C'?line===4?'tenor':'alto':clef==='G'?'treble':'auto'}
      }
      const print=measure.querySelector('print');meter={...meter,newPage:print?.getAttribute('new-page')==='yes',newSystem:print?.getAttribute('new-system')==='yes'}
      if(partIndex===0) {
        let fifths=meter.keyFifths+(transpose*7)%12;while(fifths>7)fifths-=12;while(fifths< -7)fifths+=12
        notation.measures[measureIndex]={...meter,keyFifths:fifths}
      } else if(notation.measures[measureIndex]&&(notation.measures[measureIndex].beats!==meter.beats||notation.measures[measureIndex].beatType!==meter.beatType))throw new Error('Different simultaneous meters across parts are not supported.')
      let cursor=0,lastStart=0,furthest=0
      for(const child of Array.from(measure.children)) {
        if(child.localName==='direction') {
          const dynamic=child.querySelector('dynamics')?.firstElementChild?.localName
          if(dynamic&&['pp','p','mp','mf','f','ff'].includes(dynamic))lastDynamic=dynamic as NoteNotation['dynamic']
          const tempo=number(child,'sound[tempo]',NaN),attrTempo=Number(child.querySelector('sound')?.getAttribute('tempo'))
          const candidate=Number.isFinite(tempo)&&tempo>=30&&tempo<=300?tempo:attrTempo>=30&&attrTempo<=300?attrTempo:undefined
          if(candidate!==undefined){if(baseTempo===undefined){baseTempo=candidate;project.bpm=candidate}else if(baseTempo!==candidate)warnings.add('Tempo changes are not imported; playback uses the first tempo throughout.')}
        }
        if(child.localName==='backup'||child.localName==='forward') { cursor+=(child.localName==='backup'?-1:1)*number(child,'duration',0)*480/divisions;continue }
        if(child.localName!=='note'||child.querySelector('grace'))continue
        const rawDuration=number(child,'duration',0)*480/divisions,durationTicks=Math.round(rawDuration),startTick=measureStart+(child.querySelector('chord')?lastStart:cursor)
        if(!Number.isInteger(rawDuration)||!Number.isInteger(startTick))throw new Error('This score uses timing finer than NADI’s exact 480 PPQ grid. Import was stopped without changing the project.')
        if(durationTicks<=0)throw new Error('A note has no valid duration.')
        const rawVoice=number(child,'voice',1),staff=number(child,'staff',0) as 0|1|2,voice=Math.min(8,Math.max(1,rawVoice-(staff===2&&rawVoice>8?8:0)))
        if(rawVoice>16)warnings.add('Some additional overlapping voices are mapped to voice 8; sounding timing is preserved.')
        if(!child.querySelector('chord')){lastStart=cursor;cursor+=durationTicks}furthest=Math.max(furthest,cursor)
        if(child.querySelector('rest')){notation.rests.push({id:makeStudioId(),trackId,startTick,durationTicks,voice});continue}
        const step=text(child,'pitch > step'),octave=number(child,'pitch > octave',4),alter=number(child,'pitch > alter',0)
        const pitch=child.querySelector('unpitched')?sound==='kick'?36:sound==='hat'?42:38:({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step as 'C']??NaN)+(octave+1)*12+alter+transpose
        if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new Error('A pitch is invalid or outside the supported MIDI range.')
        const key=`${voice}:${staff}:${pitch}`,stop=!!child.querySelector('tie[type="stop"]'),begin=!!child.querySelector('tie[type="start"]'),previous=ties.get(key)
        if(stop&&previous&&previous.startTick+previous.durationTicks===startTick){previous.durationTicks+=durationTicks;if(!begin)ties.delete(key);continue}
        const note={id:makeStudioId(),pitch,startTick,durationTicks,velocity:90};notes.push(note);noteCount++;if(noteCount>MAX_NOTES)throw new Error('The score exceeds the note limit.')
        if(begin)ties.set(key,note)
        const actual=number(child,'time-modification > actual-notes',1),normal=number(child,'time-modification > normal-notes',1)
        const tuplet=actual===3&&normal===2?3:actual===5&&normal===4?5:1
        if(actual!==1&&tuplet===1)warnings.add('Some tuplet ratios are represented by exact note durations without their original bracket grouping.')
        const articulation=child.querySelector('articulations')?.firstElementChild?.localName??'none',slur=child.querySelector('slur')?.getAttribute('type')??'none'
        notation.notes[note.id]={...DEFAULT_NOTE,voice,staff:[0,1,2].includes(staff)?staff:0,dynamic:lastDynamic,tuplet,articulation:['staccato','tenuto','accent'].includes(articulation)?articulation as NoteNotation['articulation']:'none',slur:slur==='start'||slur==='stop'?slur:'none'};lastDynamic='none'
      }
      const expected=meter.beats*1920/meter.beatType
      if(measure.getAttribute('implicit')==='yes'&&furthest<expected)warnings.add('Pickup measures are padded to the selected meter; review their alignment.')
      measureStart+=Math.max(expected,furthest);extent=Math.max(extent,measureStart)
    }
    project.patterns.push({id:patternId,trackId,name:`${name.slice(0,95)} · imported`,lengthTicks:Math.max(1,measureStart),notes})
    project.clips.push({id:makeStudioId(),trackId,patternId,startTick:0})
  }
  if(!noteCount&&!notation.rests.length)throw new Error('The MusicXML file contains no supported notes or rests.')
  project.bars=Math.max(source.bars,Math.ceil(extent/1920))
  if(project.bars>MAX_BARS)throw new Error('The imported score exceeds the project length limit.')
  assertStudioProject(project)
  warnings.add('Original Idea Pad captures remain unchanged. Imported score parts replace the current arrangement only when you apply this preview.')
  return {project,warnings:[...warnings],noteCount,partCount:parts.length}
}
