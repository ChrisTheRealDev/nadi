export interface MiraBudgetEntry {
  requestId: string
  amountMicrousd: number
  reservedAt: string
  state: 'reserved' | 'settled' | 'uncertain' | 'overshoot'
}

export interface MiraBudgetLedger {
  version: 1
  capMicrousd: number
  entries: MiraBudgetEntry[]
}

export interface MiraBudgetRepository {
  transact<T>(operation: (current: MiraBudgetLedger | null) => { next: MiraBudgetLedger; result: T }): Promise<T>
  read(): Promise<MiraBudgetLedger | null>
}

export interface MiraBudgetReservation {
  ok: true
  requestId: string
  reservedMicrousd: number
  remainingMicrousd: number
}

export class DurableMiraBudget {
  constructor(
    private readonly repository: MiraBudgetRepository,
    private readonly capMicrousd: number,
  ) {
    if (!Number.isSafeInteger(capMicrousd) || capMicrousd <= 0) throw new Error('A positive durable Mira spend cap is required')
  }

  async reserve(requestId: string, amountMicrousd: number, reservedAt: string): Promise<MiraBudgetReservation | { ok: false }> {
    if (!identifier(requestId) || !Number.isSafeInteger(amountMicrousd) || amountMicrousd <= 0) return { ok: false }
    return this.repository.transact<MiraBudgetReservation | { ok: false }>((stored) => {
      const current = normalize(stored, this.capMicrousd)
      if (current.entries.some((entry) => entry.requestId === requestId)) return { next: current, result: { ok: false } as const }
      if (current.entries.length >= 100_000) return { next: current, result: { ok: false } as const }
      // Any known actual cost above its reserved bound disproves the configured
      // request bound. Keep the whole pilot fail-closed until an owner repairs it.
      if (current.entries.some((entry) => entry.state === 'overshoot')) return { next: current, result: { ok: false } as const }
      const used = sumEntries(current.entries)
      if (amountMicrousd > current.capMicrousd - used) return { next: current, result: { ok: false } as const }
      const next: MiraBudgetLedger = {
        ...current,
        entries: [...current.entries, { requestId, amountMicrousd, reservedAt, state: 'reserved' }],
      }
      return {
        next,
        result: {
          ok: true,
          requestId,
          reservedMicrousd: amountMicrousd,
          remainingMicrousd: next.capMicrousd - used - amountMicrousd,
        } as const,
      }
    })
  }

  async settle(requestId: string, knownActualMicrousd?: number): Promise<void> {
    await this.repository.transact((stored) => {
      const current = normalize(stored, this.capMicrousd)
      const next: MiraBudgetLedger = {
        ...current,
        entries: current.entries.map((entry) => {
          if (entry.requestId !== requestId || entry.state !== 'reserved') return entry
          if (knownActualMicrousd !== undefined && Number.isSafeInteger(knownActualMicrousd) && knownActualMicrousd >= 0) {
            return {
              ...entry,
              amountMicrousd: knownActualMicrousd,
              state: knownActualMicrousd <= entry.amountMicrousd ? 'settled' as const : 'overshoot' as const,
            }
          }
          return { ...entry, state: 'uncertain' as const }
        }),
      }
      return { next, result: undefined }
    })
  }

  async snapshot(): Promise<MiraBudgetLedger> {
    return normalize(await this.repository.read(), this.capMicrousd)
  }
}

export class MemoryMiraBudgetRepository implements MiraBudgetRepository {
  private ledger: MiraBudgetLedger | null = null
  private queue: Promise<void> = Promise.resolve()

  async transact<T>(operation: (current: MiraBudgetLedger | null) => { next: MiraBudgetLedger; result: T }): Promise<T> {
    let resolveResult: (value: T) => void = () => undefined
    let rejectResult: (reason: unknown) => void = () => undefined
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    this.queue = this.queue.then(() => {
      const update = operation(this.ledger ? cloneLedger(this.ledger) : null)
      this.ledger = cloneLedger(update.next)
      resolveResult(update.result)
    }).catch(rejectResult)
    return result
  }

  async read(): Promise<MiraBudgetLedger | null> {
    await this.queue
    return this.ledger ? cloneLedger(this.ledger) : null
  }
}

export function isMiraBudgetLedger(value: unknown): value is MiraBudgetLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<MiraBudgetLedger>
  if (record.version !== 1 || !Number.isSafeInteger(record.capMicrousd) || Number(record.capMicrousd) <= 0 || Number(record.capMicrousd) > Number.MAX_SAFE_INTEGER ||
      !Array.isArray(record.entries) || record.entries.length > 100_000) return false
  const ids = new Set<string>()
  let total = 0
  for (const rawEntry of record.entries as unknown[]) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return false
    const entry = rawEntry as Partial<MiraBudgetEntry>
    if (!identifier(entry.requestId) || ids.has(entry.requestId) || !Number.isSafeInteger(entry.amountMicrousd) ||
        Number(entry.amountMicrousd) < 0 || typeof entry.reservedAt !== 'string' || entry.reservedAt.length > 40 ||
        !['reserved', 'settled', 'uncertain', 'overshoot'].includes(String(entry.state))) return false
    ids.add(entry.requestId)
    total += Number(entry.amountMicrousd)
    if (!Number.isSafeInteger(total)) return false
  }
  return true
}

function normalize(stored: MiraBudgetLedger | null, configuredCap: number): MiraBudgetLedger {
  if (!stored) return { version: 1, capMicrousd: configuredCap, entries: [] }
  if (!isMiraBudgetLedger(stored)) throw new Error('Mira budget ledger is invalid')
  return { ...cloneLedger(stored), capMicrousd: configuredCap }
}

function cloneLedger(ledger: MiraBudgetLedger): MiraBudgetLedger {
  return { ...ledger, entries: ledger.entries.map((entry) => ({ ...entry })) }
}

function sumEntries(entries: readonly MiraBudgetEntry[]): number {
  let sum = 0
  for (const entry of entries) {
    sum += entry.amountMicrousd
    if (!Number.isSafeInteger(sum)) return Number.MAX_SAFE_INTEGER
  }
  return sum
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,96}$/.test(value)
}
