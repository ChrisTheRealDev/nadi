import { describe, expect, it } from 'vitest'
import { STUDIO_PANELS, WORKSPACE_V2_STORAGE_KEY, clampWorkspaceSplit, defaultWorkspaceV2, loadWorkspaceV2, saveWorkspaceV2, validateWorkspaceV2, workspaceReducer } from './workspacePreferencesV2'
describe('minimal workspace preferences', () => {
  it('starts with Notes only and leaves legacy preferences untouched', () => {
    const values = new Map([['nadi.workspace.v1', JSON.stringify({ version:1,browser:true,mira:true,playlist:true,mixer:true,keyboard:true,browserSide:'left',miraSide:'right',playlistPosition:'top',editor:'drums' })]])
    const storage = { getItem: (key:string) => values.get(key) ?? null, setItem:(key:string,value:string) => { values.set(key,value) } }
    const original = values.get('nadi.workspace.v1')
    expect(loadWorkspaceV2(storage)).toEqual(defaultWorkspaceV2(true))
    expect(saveWorkspaceV2(defaultWorkspaceV2(true),storage)).toBe(true)
    expect(values.get('nadi.workspace.v1')).toBe(original)
    expect(values.has(WORKSPACE_V2_STORAGE_KEY)).toBe(true)
  })
  it('never creates three slots or duplicate panels in any combination', () => {
    for (const first of STUDIO_PANELS) for (const second of STUDIO_PANELS) for (const third of STUDIO_PANELS) {
      let state = workspaceReducer(defaultWorkspaceV2(), { type:'open',panel:first })
      state = workspaceReducer(state, { type:'open',panel:second,alongside:true })
      state = workspaceReducer(state, { type:'open',panel:third,alongside:true })
      expect(validateWorkspaceV2(state)).toBe(true)
      expect(state.slots.length).toBeLessThanOrEqual(2)
      expect(state.active).toBe(third)
      expect(new Set(state.slots).size).toBe(state.slots.length)
    }
  })
  it('replaces the active slot, focuses existing panels and expands when closed', () => {
    let state = workspaceReducer(defaultWorkspaceV2(),{type:'open',panel:'mixer',alongside:true})
    state = workspaceReducer(state,{type:'activate',panel:'notes'})
    state = workspaceReducer(state,{type:'open',panel:'arrangement'})
    expect(state.slots).toEqual(['arrangement','mixer'])
    state = workspaceReducer(state,{type:'open',panel:'mixer'})
    expect(state.slots).toEqual(['arrangement','mixer'])
    state = workspaceReducer(state,{type:'close',panel:'mixer'})
    expect(state.active).toBe('arrangement')
    state = workspaceReducer(state,{type:'close',panel:'arrangement'})
    expect(state.active).toBe(null)
    expect(state.slots).toEqual([])
  })
  it('Mira and layout reset never require a work slot', () => {
    let state = workspaceReducer(defaultWorkspaceV2(),{type:'mira',open:true})
    state = workspaceReducer(state,{type:'open',panel:'ideas',alongside:true})
    expect(state.slots).toEqual(['notes','ideas'])
    expect(workspaceReducer(state,{type:'reset'})).toEqual(defaultWorkspaceV2(true))
  })
  it('rejects corrupt, unknown and inaccessible preferences', () => {
    for (const value of [{...defaultWorkspaceV2(),slots:['notes','notes']},{...defaultWorkspaceV2(),active:'drums'}, {...defaultWorkspaceV2(),split:Infinity},{...defaultWorkspaceV2(),extra:true}]) expect(validateWorkspaceV2(value)).toBe(false)
    expect(loadWorkspaceV2({getItem:()=>'{',setItem:()=>{}})).toEqual(defaultWorkspaceV2())
    expect(loadWorkspaceV2({getItem:()=>{throw Error('blocked')},setItem:()=>{}})).toEqual(defaultWorkspaceV2())
    expect(saveWorkspaceV2(defaultWorkspaceV2(),{getItem:()=>null,setItem:()=>{throw Error('blocked')}})).toBe(false)
  })
  it('clamps a visible split to the 420px panel minimum', () => {
    expect(clampWorkspaceSplit(.1,1000)*(1000-8)).toBe(420)
    expect((1-clampWorkspaceSplit(.9,1000))*(1000-8)).toBeCloseTo(420)
    expect(clampWorkspaceSplit(.8,600)).toBe(.5)
  })
})
