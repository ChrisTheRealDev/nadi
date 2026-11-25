import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { NodeFileGroqPairingRepository } from './nodeGroqPairingRepository.mjs'

it('compares private pairing file atomically and never consumes a replacement record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nadi-adult-pair-test-')), file = join(directory, 'groq-pairing.json')
  try {
    const repo = new NodeFileGroqPairingRepository(file)
    const original = { version: 1, codeHash: 'a'.repeat(64), expiresAt: 1900000, cohortId: 'adult-demo', sessionId: 'original-session' }
    const replacement = { ...original, sessionId: 'replacement-session' }
    await writeFile(file, JSON.stringify(replacement)); expect(await repo.consume(original)).toBe(false); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(replacement)
    const results = await Promise.allSettled([repo.consume(replacement), repo.consume(replacement)])
    expect(results.filter(result => result.status === 'fulfilled' && result.value === true)).toHaveLength(1)
    expect(await repo.read()).toBeNull()
  } finally {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('nadi-adult-pair-test-')) throw new Error('Unexpected temporary test directory')
    await rm(target, { recursive: true, force: true })
  }
})
