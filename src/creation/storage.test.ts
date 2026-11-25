import { describe, expect, it } from 'vitest'
import { createDefaultMix, createProject } from './model'
import { CreationStorageError, CreationStore, CREATION_DATABASE_NAME } from './storage'

// Deterministic IDB transaction harness: writes are staged until completion;
// abort discards them. Browser regression additionally exercises real IndexedDB.
function memoryFactory(seed: unknown, active = 'legacy') {
  const tables = new Map<string, Map<string, unknown>>([
    ['projects', new Map([[active, structuredClone(seed)]])],
    ['meta', new Map([['last-active-project-id', active]])],
  ])
  const database = {
    close() {},
    transaction(names: string | string[], mode: string) {
      const staged = new Map(Array.from(tables, ([name, table]) => [name, new Map(table)]))
      let pending = 0
      let aborted = false
      const transaction = {
        oncomplete: undefined as undefined | (() => void),
        onabort: undefined as undefined | (() => void),
        abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()) },
        objectStore(name: string) {
          expect(typeof names === 'string' ? [names] : names).toContain(name)
          const table = staged.get(name)!
          const request = (read: () => unknown) => {
            pending++
            const result = { result: undefined as unknown, onsuccess: undefined as undefined | (() => void) }
            queueMicrotask(() => {
              if (!aborted) { result.result = structuredClone(read()); result.onsuccess?.() }
              pending--
              queueMicrotask(() => {
                if (aborted || pending !== 0) return
                if (mode === 'readwrite') staged.forEach((value, key) => tables.set(key, value))
                transaction.oncomplete?.()
              })
            })
            return result
          }
          return {
            get: (key: string) => request(() => table.get(key)),
            getAll: () => request(() => [...table.values()]),
            put: (value: unknown, key: string) => request(() => { table.set(key, structuredClone(value)); return key }),
          }
        },
      }
      return transaction
    },
  }
  const factory = {
    open(name: string, version: number) {
      expect(name).toBe('nadi-creation-v1'); expect(version).toBe(1)
      const request = { result: database, onsuccess: undefined as undefined | (() => void) }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  } as unknown as IDBFactory
  return { factory, tables }
}

describe('creation storage', () => {
  it('loads/lists/activates legacy v1 without durable migration, then CAS saves v3', async () => {
    const project = createProject(); project.id = 'legacy'; project.revision = 7
    project.notes = [{ id: 'recording', instrument: 'piano', pitch: 60, startTick: 37, durationTicks: 7021, velocity: 73 }]
    const { mix: _mix, ideas: _ideas, ...base } = project
    expect(_mix).toEqual(createDefaultMix())
    expect(_ideas).toEqual([])
    const legacy = { ...base, version: 1 }
    const { factory, tables } = memoryFactory(legacy)
    const store = new CreationStore(factory)
    expect(await store.load()).toEqual({ ...project, mix: createDefaultMix() })
    expect(await store.list()).toEqual([project])
    await store.activate(project.id, 7)
    expect(tables.get('projects')?.get(project.id)).toEqual(legacy)
    const saved = { ...project, revision: 8 }
    saved.mix.hat = { level: 27, muted: true }
    await store.save(saved, 7)
    expect(tables.get('projects')?.get(project.id)).toEqual(saved)
    await expect(store.save(saved, 7)).rejects.toMatchObject({ code: 'conflict' })
    expect(await store.load()).toEqual(saved)
    store.close()
  })

  it('refuses corrupt legacy reads and cannot overwrite them with a purported revision match', async () => {
    const project = createProject(); project.id = 'legacy'; project.revision = 8
    const corrupt = { ...project, version: 1 } // v1 must not contain v2 mix
    const { factory, tables } = memoryFactory(corrupt)
    const store = new CreationStore(factory)
    await expect(store.load()).rejects.toMatchObject({ code: 'corrupt' })
    await expect(store.list()).rejects.toMatchObject({ code: 'corrupt' })
    await expect(store.activate(project.id, 8)).rejects.toMatchObject({ code: 'corrupt' })
    await expect(store.save({ ...project, revision: 9 }, 8)).rejects.toMatchObject({ code: 'corrupt' })
    expect(tables.get('projects')?.get(project.id)).toEqual(corrupt)
    store.close()
  })
  it('uses a dedicated database and fails closed when IndexedDB is unavailable', async () => {
    expect(CREATION_DATABASE_NAME).toBe('nadi-creation-v1')
    const store = new CreationStore(undefined)

    await expect(store.load()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(store.list()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(store.save(createProject(), null)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(store.activate('project-1', 0)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('rejects invalid and non-successor revisions before opening storage', async () => {
    const store = new CreationStore(undefined)
    const project = createProject()
    project.revision = 2

    await expect(store.save(project, 0)).rejects.toMatchObject({ code: 'conflict' })
    project.revision = 0
    await expect(store.save(project, -1)).rejects.toBeInstanceOf(CreationStorageError)
    await expect(store.activate('', 0)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('constructs safely when browser policy makes the IndexedDB getter throw', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    try {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        get: () => { throw new DOMException('Access denied', 'SecurityError') },
      })

      const store = new CreationStore()
      await expect(store.load()).rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original)
      else Reflect.deleteProperty(globalThis, 'indexedDB')
    }
  })
})
