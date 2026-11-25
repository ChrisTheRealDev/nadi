import { describe, expect, it } from 'vitest'
import { createTextIdea } from '../ideas'
import { createProject } from '../model'
import { packProject } from '../archive'
import { createStudioProject, decodeStudioProject, compileArrangement } from './model'
import { addTrack, duplicateClip, updatePatternNotes } from './operations'
import { applyEditorProjection, editorProjection, restoreGraphHistory } from './editorAdapter'
import { packStudioProject, unpackStudioProject } from './archive'

describe('v4 editor, archive and original-history boundaries', () => {
  it('metadata edits and note changes do not stretch a part to its sustained tail', () => {
    let project=createStudioProject()
    project=updatePatternNotes(project,project.patterns[0].id,[{id:'tail',pitch:60,startTick:7000,durationTicks:3000,velocity:80}])
    const pattern=project.patterns[0], before=editorProjection(project,pattern.trackId,pattern.id)
    expect(before.bars).toBe(6)
    const renamed=applyEditorProjection(project,pattern.id,before,{...before,name:'Renamed',bpm:100})
    expect(renamed.patterns).toEqual(project.patterns)
    expect(renamed.name).toBe('Renamed');expect(renamed.bpm).toBe(100)
    const moved=applyEditorProjection(project,pattern.id,before,{...before,notes:before.notes.map(note=>({...note,pitch:62}))})
    expect(moved.patterns[0].lengthTicks).toBe(pattern.lengthTicks)
    expect(moved.patterns[0].notes[0].durationTicks).toBe(3000)
    expect(()=>applyEditorProjection({...project,revision:1},pattern.id,before,before)).toThrow(/changed/)
  })
  it('projects only the selected part and never confuses two same-sound tracks', () => {
    let project=addTrack(createStudioProject(),'piano')
    project=updatePatternNotes(project,project.patterns[1].id,[{id:'precise',pitch:64,startTick:137,durationTicks:2111,velocity:81}])
    expect(editorProjection(project,project.tracks[0].id,project.patterns[0].id).notes).toEqual([])
    expect(editorProjection(project,project.tracks[1].id,project.patterns[1].id).notes[0]).toMatchObject({id:'precise',startTick:137,durationTicks:2111})
    expect(compileArrangement(project)).toHaveLength(1)
  })
  it('Undo preserves later captures without rewriting original content', () => {
    const first=createStudioProject(),current=addTrack(first,'synth-bass')
    const idea=createTextIdea('My exact idea','Original'); current.ideas=[idea];current.revision=2
    const restored=restoreGraphHistory(first,current)
    expect(restored.tracks).toEqual(first.tracks)
    expect(restored.ideas).toEqual([idea]); expect(restored.revision).toBe(3)
    const corrupt=structuredClone(restored);corrupt.ideas[0].createdAt+=1
    expect(()=>restoreGraphHistory(corrupt,current)).toThrow()
  })
  it('roundtrips patterns, copies and sounds, and imports legacy archives exactly', () => {
    let project=addTrack(createStudioProject(),'electric-piano')
    project=updatePatternNotes(project,project.patterns[1].id,[{id:'precise',pitch:64,startTick:137,durationTicks:2111,velocity:81}])
    project=duplicateClip(project,project.clips[1].id)
    expect(unpackStudioProject(packStudioProject(project))).toEqual(project)
    const legacy=createProject();legacy.notes=[{id:'old',instrument:'piano',pitch:67,startTick:37,durationTicks:480,velocity:80}]
    expect(unpackStudioProject(packProject(legacy))).toEqual(decodeStudioProject(legacy))
  })
})
