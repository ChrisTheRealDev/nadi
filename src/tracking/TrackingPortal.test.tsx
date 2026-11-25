import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TrackingPortal from './TrackingPortal'

afterEach(() => vi.unstubAllGlobals())
function render(theme: string | null, unavailable = false) {
  vi.stubGlobal('window', { location: { hash: '#progress' }, get localStorage() {
    if (unavailable) throw new Error('Storage disabled')
    return { getItem: () => theme }
  } })
  vi.stubGlobal('navigator', { onLine: true })
  return renderToStaticMarkup(<TrackingPortal />)
}
describe('tracking shell initial state', () => {
  it.each(['light', 'eclipse', 'dark'])('restores supported theme %s', theme => {
    const html = render(theme)
    expect(html).toContain(`data-theme="${theme}"`)
    expect(html).toContain('Checking setup')
    expect(html).not.toContain('Alex')
    expect(html).not.toContain('Sam')
    expect(html).not.toContain('Shared checkpoints')
  })
  it('falls back to branded Eclipse for invalid or inaccessible preferences', () => {
    expect(render('invalid')).toContain('data-theme="eclipse"')
    expect(render(null, true)).toContain('data-theme="eclipse"')
  })
})
