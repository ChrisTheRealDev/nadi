import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from './model'
import { ExpressionLane, ProductionControls } from './ProductionControls'
import { expressionEntryPoint } from './expressionEditing'

describe('production control destinations and safe numeric entry', () => {
  it('places track identity directly on every registered production target', () => {
    const track = createStudioProject().tracks[0]; track.id = 'intended-track'
    const onCommit = vi.fn(), onPreview = vi.fn()
    const html = renderToStaticMarkup(<ProductionControls track={track} bars={4} active onCommit={onCommit} onPreview={onPreview} />)
    for (const target of ['track-pan', 'track-space', 'track-expression']) expect(html).toContain(`data-help-target="${target}" data-help-track-id="intended-track"`)
    expect(html).toContain('Pan, Space &amp; Expression')
    expect(onCommit).not.toHaveBeenCalled(); expect(onPreview).not.toHaveBeenCalled()
  })
  it('inactive expression controls cannot submit hidden edits', () => {
    const track = createStudioProject().tracks[0]; track.expression = [{ tick: 73, value: .2 }]
    const html = renderToStaticMarkup(<ExpressionLane track={track} bars={4} active={false} onCommit={vi.fn()} />)
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)]
    expect(buttons.length).toBeGreaterThan(3)
    for (const button of buttons) expect(button[0]).toContain('disabled=""')
  })
  it('preserves chosen beat precision while rejecting stale bars and invalid drafts', () => {
    expect(expressionEntryPoint(3, 1.275, 37, 80)).toEqual({ tick: 3972, value: .37 })
    expect(() => expressionEntryPoint(80, 1, 50, 4)).toThrow()
    expect(() => expressionEntryPoint(0, 1, 50, 4)).toThrow()
    expect(() => expressionEntryPoint(1, 5, 50, 4)).toThrow()
    expect(() => expressionEntryPoint(1, NaN, 50, 4)).toThrow()
    expect(() => expressionEntryPoint(1, 1, 50.5, 4)).toThrow()
  })
})
