import { describe, expect, it } from 'vitest'
import { practiceProgress } from './practiceProgress'
import { TICKS_PER_BAR } from './model'
const q = TICKS_PER_BAR / 4
const notes = (ticks: number[]) => ticks.map(startTick => ({ startTick }))
describe('tutorial target beat', () => {
 it('rejects four arbitrary hits', () => expect(practiceProgress(notes([0,q/4,q/2,3*q/4])).complete).toBe(false))
 it('accepts the four exact targets', () => expect(practiceProgress(notes([0,q,2*q,3*q]))).toEqual({matched:4,extra:0,complete:true}))
 it('requires removal of extra hits', () => expect(practiceProgress(notes([0,q/4,q,2*q,3*q]))).toEqual({matched:4,extra:1,complete:false}))
 it('ignores later bars and rejects duplicates', () => { expect(practiceProgress(notes([0,q,2*q,TICKS_PER_BAR])).matched).toBe(3); expect(practiceProgress(notes([0,0,q,2*q,3*q])).complete).toBe(false) })
})
