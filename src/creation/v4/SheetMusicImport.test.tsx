import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { SheetMusic } from './SheetMusicDialog'
import { createStudioProject } from './model'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as (() => void)[], cleanups: new Map<number, () => void>() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.index++, previous = hooks.values[index] as unknown[] | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.values[index] = deps
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.(); hooks.cleanups.delete(index)
        const cleanup = effect(); if (cleanup) hooks.cleanups.set(index, cleanup)
      })
    }
  },
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next }]
  },
}))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../useModalFocus', () => ({ useModalFocus: () => {} }))
vi.mock('./sheetMusic', () => ({ createSheetMusic: () => { throw new Error('No engraving in file-read test') } }))
vi.mock('./musicXmlImport', () => ({ importMusicXml: (xml: string, project: object) => ({ project: { ...project, name: xml }, warnings: [], noteCount: 1, partCount: 1 }) }))

type Element = ReactElement<{ children?: ReactNode; ref?: { current: unknown }; 'aria-label'?: string; onChange?: (event: unknown) => void; onClick?: () => void }>
const domNode = () => ({ replaceChildren() {}, appendChild() {}, remove() {}, querySelectorAll: () => [] })
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children)]
}
function deferred() {
  let resolve!: (value: string) => void
  const promise = new Promise<string>(done => { resolve = done })
  return { resolve, text: vi.fn(() => promise), size: 10 }
}
describe('MusicXML asynchronous file selection', () => {
  beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.effects = []; hooks.cleanups.clear(); vi.stubGlobal('document', { body: {}, getElementById: () => null, createElement: domNode }) })
  afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals() })
  function fixture() {
    const project = createStudioProject(), onChange = vi.fn<(project: unknown, label: string) => boolean>(() => true)
    let current = project
    const render = (next = current) => {
      current = next; hooks.index = 0
      const tree = SheetMusic({ project: current, onClose: vi.fn(), onChange })
      elements(tree).forEach(element => { if (typeof element.type === 'string' && element.props.ref) element.props.ref.current = domNode() })
      hooks.effects.splice(0).forEach(effect => effect())
      return tree
    }
    const select = (file: { size: number; text: () => Promise<string> }) => elements(render()).find(e => e.props['aria-label'] === 'Import MusicXML')!.props.onChange!({ target: { files: [file] }, currentTarget: { value: 'file' } })
    const apply = () => elements(render()).find(e => e.props.children === 'Replace score with imported XML')!.props.onClick!()
    return { select, apply, render, onChange, project }
  }
  it('keeps the newest file when an earlier read completes last', async () => {
    const f = fixture(), first = deferred(), second = deferred()
    f.select(first); f.select(second)
    second.resolve('second'); await Promise.resolve(); await Promise.resolve()
    first.resolve('first'); await Promise.resolve(); await Promise.resolve()
    f.apply(); expect(f.onChange.mock.calls[0][0]).toMatchObject({ name: 'second' })
  })
  it('rejects oversized files before reading their content', () => {
    const f = fixture(), file = { size: 10_000_001, text: vi.fn(() => Promise.resolve('oversized')) }
    f.select(file); expect(file.text).not.toHaveBeenCalled()
  })
  it('shows a file-read failure without offering to replace the score', async () => {
    const f = fixture()
    f.select({ size: 10, text: () => Promise.reject(new Error('File is no longer readable')) })
    await Promise.resolve(); await Promise.resolve()
    const tree = elements(f.render())
    expect(tree.some(e => e.props.children === 'File is no longer readable')).toBe(true)
    expect(tree.some(e => e.props.children === 'Replace score with imported XML')).toBe(false)
    expect(f.onChange).not.toHaveBeenCalled()
  })
  it('does not resurrect a cancelled preview when an older read finishes', async () => {
    const f = fixture(), first = deferred(), second = deferred()
    f.select(first); f.select(second)
    second.resolve('second'); await Promise.resolve(); await Promise.resolve()
    elements(f.render()).find(e => e.props.children === 'Cancel import')!.props.onClick!()
    first.resolve('first'); await Promise.resolve(); await Promise.resolve()
    expect(elements(f.render()).some(e => e.props.children === 'Replace score with imported XML')).toBe(false)
    expect(f.onChange).not.toHaveBeenCalled()
  })
  it('removes a completed preview when the project revision changes', async () => {
    const f = fixture(), file = deferred()
    f.select(file); file.resolve('valid'); await Promise.resolve(); await Promise.resolve()
    expect(elements(f.render()).some(e => e.props.children === 'Replace score with imported XML')).toBe(true)
    f.render({ ...f.project, revision: 1 })
    expect(elements(f.render()).some(e => e.props.children === 'Replace score with imported XML')).toBe(false)
    expect(f.onChange).not.toHaveBeenCalled()
  })
  it('ignores a pending read after project revision changes', async () => {
    const f = fixture(), file = deferred()
    f.select(file); f.render({ ...f.project, revision: 1 })
    file.resolve('outdated'); await Promise.resolve(); await Promise.resolve()
    expect(elements(f.render()).some(e => e.props.children === 'Replace score with imported XML')).toBe(false)
  })
  it('ignores a pending read after the dialog unmounts', async () => {
    const f = fixture(), file = deferred()
    f.select(file); hooks.cleanups.forEach(cleanup => cleanup()); hooks.cleanups.clear()
    const before = [...hooks.values]
    file.resolve('late'); await Promise.resolve(); await Promise.resolve()
    expect(hooks.values).toEqual(before)
    expect(f.onChange).not.toHaveBeenCalled()
  })
  it('applies a valid current preview only after explicit replacement', async () => {
    const f = fixture(), file = deferred()
    f.select(file); file.resolve('current'); await Promise.resolve(); await Promise.resolve()
    expect(f.onChange).not.toHaveBeenCalled()
    f.apply(); expect(f.onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: f.project.id, revision: 0, name: 'current' }), 'Imported MusicXML score')
  })
})
