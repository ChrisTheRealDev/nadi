import { open, unlink } from 'node:fs/promises'

const keys = ['version', 'codeHash', 'expiresAt', 'cohortId', 'sessionId']
/** Node-only adapter; the authorization handler remains independently typechecked WebCrypto. */
export class NodeFileGroqPairingRepository {
  constructor(filename) {
    if (typeof filename !== 'string' || !filename || filename.length > 1000) throw new Error('Invalid pairing path')
    this.filename = filename
  }
  async read() {
    let handle
    try {
      handle = await open(this.filename, 'r')
      if ((await handle.stat()).size > 2048) throw new Error('Invalid pairing record')
      return JSON.parse(await handle.readFile('utf8'))
    } catch (error) { if (error?.code === 'ENOENT') return null; throw new Error('Pairing record unavailable') }
    finally { await handle?.close() }
  }
  async consume(expected) {
    const lockPath = `${this.filename}.lock`, lock = await open(lockPath, 'wx', 0o600)
    try {
      const current = await this.read()
      if (!current || typeof current !== 'object' || Array.isArray(current) || Object.keys(current).length !== keys.length || keys.some(key => current[key] !== expected[key])) return false
      await unlink(this.filename)
      return true
    } finally { await lock.close(); await unlink(lockPath) }
  }
}
