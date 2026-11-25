import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSetup } from './WorkspaceSetup'
import { DEFAULT_WORKSPACE_PREFERENCES } from './workspacePreferences'

describe('workspace setup initial surface', () => {
  it('introduces only the starting choice, without applying or modifying preferences', () => {
    const initial = { ...DEFAULT_WORKSPACE_PREFERENCES }
    const onApply = vi.fn(), onCancel = vi.fn()
    const html = renderToStaticMarkup(<WorkspaceSetup initial={initial} firstRun onApply={onApply} onCancel={onCancel} />)
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('How do you want to start?')
    expect(html).toContain('Simple piano')
    expect(html).toContain('Make a beat')
    expect(html).toContain('Full studio')
    expect(html).toContain('Start simple')
    expect(html).not.toContain('type="checkbox"')
    expect(initial).toEqual(DEFAULT_WORKSPACE_PREFERENCES)
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('provides Cancel for later edits instead of replacing saved preferences with defaults', () => {
    const initial = { ...DEFAULT_WORKSPACE_PREFERENCES, browser: true }
    const html = renderToStaticMarkup(<WorkspaceSetup initial={initial} firstRun={false} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(html).toContain('>Cancel</button>')
    expect(html).not.toContain('>Start simple</button>')
    expect(html).toContain('What should appear?')
    expect(html).toContain('Apply changes')
    expect(html).toContain('Choose positions')
    expect(html).toContain('Starting presets')
    expect(html.match(/type="checkbox"/g)).toHaveLength(5)
    expect(html).toContain('Hiding a panel never deletes your music')
    expect(initial.browser).toBe(true)
  })
})
