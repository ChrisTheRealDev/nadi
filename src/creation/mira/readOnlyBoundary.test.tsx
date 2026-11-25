import { describe, expect, expectTypeOf, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreationMira, type CreationMiraProps } from './CreationMira'
import { helpSteps } from './registry'

describe('creation adviser boundary', () => {
  it('has no project, editing, generation or playback callback in its public interface', () => {
    expectTypeOf<keyof CreationMiraProps>().toEqualTypeOf<'open' | 'workspace' | 'observedAction' | 'onClose' | 'onRevealTarget'>()
    expectTypeOf<CreationMiraProps['onRevealTarget']>().toEqualTypeOf<((target: string) => void) | undefined>()
    expect(Object.values(helpSteps).some(step => 'example' in step || 'execute' in step || 'proposal' in step)).toBe(false)
  })
  it('clearly distinguishes advice from audio analysis or composition', () => {
    const html = renderToStaticMarkup(<CreationMira open workspace={{ projectId: 'test', revision: 0, editor: 'piano', selectedBar: 0, hasPianoNotes: false, hasDrumHits: false, selectedNote: false, visibleDrumRows: [], mutedInstruments: [], saved: false }} observedAction={null} onClose={() => {}} />)
    expect(html).toContain('Read-only advice')
    expect(html).toContain('I have not listened to your audio')
    expect(html).not.toContain('Show an example')
  })
})
