import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { FirstBeatTutorial } from './FirstBeatTutorial'
import { createStudioProject } from './model'

// Exercise queued handlers from one render without a browser or extra DOM dependency.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next
    }]
  },
}))

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children)]
}
function button(tree: ReactNode, label: string) {
  const found = elements(tree).find(element => element.type === 'button' && element.props.children === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found.props
}

describe('tutorial rapid navigation and project changes', () => {
  beforeEach(() => { hooks.values = []; hooks.index = 0 })
  function fixture() {
    const project = createStudioProject(), before = structuredClone(project)
    const onOpen = vi.fn(), onReveal = vi.fn()
    const render = (current = project, disabled = false) => {
      hooks.index = 0
      return FirstBeatTutorial({ project: current, disabled, onOpen, onReveal })
    }
    const open = () => { button(render(), 'Show me the layout').onClick!(); return render() }
    return { project, before, onOpen, onReveal, render, open }
  }
  it('keeps queued Next and Back actions within the available tour pages', () => {
    const f = fixture()
    let tree = f.open()
    for (let i = 0; i < 6; i++) { button(tree, 'Next').onClick!(); tree = f.render() }
    const next = button(tree, 'Next').onClick!
    next(); next(); next()
    expect(() => { tree = f.render() }).not.toThrow()
    expect(button(tree, 'Try the practice activity')).toBeDefined()
    const back = button(tree, 'Back').onClick!
    for (let i = 0; i < 12; i++) back()
    expect(() => { tree = f.render() }).not.toThrow()
    expect(button(tree, 'Back').disabled).toBe(true)
    expect(f.project).toEqual(f.before)
  })
  it('lets practice be exited and restarted after changing projects without changing music', () => {
    const f = fixture()
    button(f.open(), 'Skip to practice').onClick!()
    button(f.render(), 'Practice in this project').onClick!()
    expect(f.onOpen).toHaveBeenCalledWith('sounds')
    const other = createStudioProject()
    button(f.render(other), 'Restart here').onClick!()
    button(f.render(other), 'Exit tutorial').onClick!()
    expect(button(f.render(other), 'Mira · Studio tutorial')).toBeDefined()
    expect(f.project).toEqual(f.before)
  })
})
