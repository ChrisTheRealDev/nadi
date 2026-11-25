import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

export const DEMO_HOST = '127.0.0.1'
export const DEMO_PORT = 5237
export const DEMO_ORIGIN = 'http://' + DEMO_HOST + ':' + DEMO_PORT

/** Both local runtimes read only release-local server configuration. */
export async function loadDemoEnvironment(root = process.cwd(), overrides = process.env) {
  const values = {}
  for (const filename of ['.env.local', '.env.tracking.local']) {
    try { Object.assign(values, parseEnv(await readFile(resolve(root, filename), 'utf8'))) }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot load server configuration ' + filename + '.')
    }
  }
  return { ...values, ...overrides }
}
