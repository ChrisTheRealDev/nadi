import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_ORIGIN, loadDemoEnvironment } from './config.mjs'

describe('v020 local server configuration', () => {
  it('defaults to its own loopback origin and works in a clean folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nadi-v020-config-'))
    expect(DEMO_ORIGIN).toBe('http://127.0.0.1:5237')
    expect(await loadDemoEnvironment(root, {})).toEqual({})
  })

  it('reads only release-local files, with process overrides taking precedence', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nadi-v020-config-'))
    const root = join(parent, 'v020')
    await mkdir(root)
    await writeFile(join(parent, '.env.local'), 'UNRELATED=ignored')
    await writeFile(join(root, 'demo-connection.json'), 'previously packaged configuration')
    await writeFile(join(root, '.env.local'), 'MIRA_PROVIDER=disabled\nEXAMPLE_MODE=local')
    await writeFile(join(root, '.env.tracking.local'), 'EXAMPLE_MODE=tracking')
    expect(await loadDemoEnvironment(root, { MIRA_PROVIDER: 'fixture' })).toEqual({
      MIRA_PROVIDER: 'fixture',
      EXAMPLE_MODE: 'tracking',
    })
  })
})
