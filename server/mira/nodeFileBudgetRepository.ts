import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isMiraBudgetLedger, type MiraBudgetLedger, type MiraBudgetRepository } from './budget'

export class NodeFileMiraBudgetRepository implements MiraBudgetRepository {
  private readonly lockPath: string

  constructor(private readonly ledgerPath: string) {
    if (!ledgerPath || ledgerPath.length > 1_000) throw new Error('Mira budget ledger path is invalid')
    this.lockPath = `${ledgerPath}.lock`
  }

  async transact<T>(operation: (current: MiraBudgetLedger | null) => { next: MiraBudgetLedger; result: T }): Promise<T> {
    await mkdir(dirname(this.ledgerPath), { recursive: true })
    const lock = await this.acquireLock()
    try {
      const current = await this.readUnlocked()
      const update = operation(current)
      if (!isMiraBudgetLedger(update.next)) throw new Error('Refusing to persist an invalid Mira budget ledger')
      const temporary = `${this.ledgerPath}.tmp-${randomSuffix()}`
      let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
      try {
        temporaryHandle = await open(temporary, 'wx', 0o600)
        await temporaryHandle.writeFile(JSON.stringify(update.next), 'utf8')
        await temporaryHandle.sync()
        await temporaryHandle.close()
        temporaryHandle = undefined
        await rename(temporary, this.ledgerPath)
        await syncDirectory(dirname(this.ledgerPath))
      } catch (error) {
        await temporaryHandle?.close().catch(() => undefined)
        await unlink(temporary).catch(() => undefined)
        throw error
      }
      return update.result
    } finally {
      await lock.close()
      await unlink(this.lockPath).catch(() => undefined)
    }
  }

  async read(): Promise<MiraBudgetLedger | null> {
    return this.readUnlocked()
  }

  private async readUnlocked(): Promise<MiraBudgetLedger | null> {
    try {
      const raw = await readFile(this.ledgerPath, 'utf8')
      if (raw.length > 10_000_000) throw new Error('Mira budget ledger is too large')
      const parsed = JSON.parse(raw) as unknown
      if (!isMiraBudgetLedger(parsed)) throw new Error('Mira budget ledger is invalid')
      return parsed
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  private async acquireLock(): Promise<Awaited<ReturnType<typeof open>>> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await open(this.lockPath, 'wx', 0o600)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    // A lock left by a crash is never guessed stale and deleted automatically: deny spend safely.
    throw new Error('Mira budget ledger is locked; live calls remain disabled until an owner inspects the lock')
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Some platforms (notably Windows) do not support opening/fsyncing a directory.
  // The ledger file itself is always flushed before atomic rename. Directory-metadata flush is best effort on platforms that expose it.
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // File flush + atomic replace remain the strongest portable guarantee available here.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function randomSuffix(): string {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  return `${bytes[0].toString(36)}-${bytes[1].toString(36)}`
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}
