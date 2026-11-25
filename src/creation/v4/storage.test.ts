import { describe, expect, it } from 'vitest'
import { createProject as createLegacy } from '../model'
import { createStudioProject, decodeStudioProject } from './model'
import { StudioStore } from './storage'
// Deterministic IDB transaction harness: writes are staged until completion;
// abort discards them. Browser regression additionally exercises real IndexedDB.
function memoryFactory(seed: unknown, active = 'legacy', failBackup = false) {
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
            getAllKeys: () => request(() => [...table.keys()]),
            put: (value: unknown, key: string) => {
              if (failBackup && key.startsWith('pre-v')) throw new Error('Backup storage full')
              return request(() => { table.set(key, structuredClone(value)); return key })
            },
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


describe('v4 storage and exact upgrade backup', () => {
  it.each(['load', 'activate', 'save'] as const)('rejects a valid project stored under another identity during %s without changing any durable bytes', async operation => {
    const project = createStudioProject(); project.id = 'actual-id'
    const { factory, tables } = memoryFactory(project, 'wrong-key')
    const before = structuredClone(tables), store = new StudioStore(factory)
    const request = operation === 'load' ? store.load()
      : operation === 'activate' ? store.activate('wrong-key', 0)
        : store.save({ ...project, id: 'wrong-key', revision: 1 }, 0)
    await expect(request).rejects.toMatchObject({ code: 'corrupt' })
    expect(tables).toEqual(before)
  })
  it('captures the save before waiting for the database and isolates later load mutations', async () => {
    const project = createStudioProject(); project.id = 'snapshot'
    const { factory } = memoryFactory(project, project.id), store = new StudioStore(factory)
    const successor = { ...structuredClone(project), revision: 1, name: 'Save-time name' }
    const expected = structuredClone(successor), saving = store.save(successor, 0)
    successor.name = 'Caller changed while pending'; successor.patterns[0].name = 'Caller pattern'
    await saving
    const loaded = (await store.load())!
    expect(loaded).toEqual(expected)
    loaded.patterns[0].name = 'Mutated read result'
    expect(await store.load()).toEqual(expected)
  })
  it('rejects invalid and stale revision requests without touching the active project or outbox', async () => {
    const project = createStudioProject(); project.id = 'revision-test'; project.revision = 7
    const { factory, tables } = memoryFactory(project, project.id), store = new StudioStore(factory)
    const before = structuredClone(tables)
    for (const expected of [null, -1, NaN, Infinity, 1.5, 6, 8]) {
      const revision = expected === null ? 0 : expected + 1
      await expect(store.save({ ...project, revision }, expected)).rejects.toBeDefined()
      expect(tables).toEqual(before)
    }
    await expect(store.activate(project.id, 6)).rejects.toMatchObject({ code: 'conflict' })
    expect(tables).toEqual(before)
  })
  it('commits musical save and its outbox entry atomically', async () => {
    const project = createStudioProject(); project.id = 'atomic'
    const { factory, tables } = memoryFactory(project, project.id)
    const store = new StudioStore(factory, { onSaved: (meta, snapshot) => meta.put({ project: snapshot, mutationId: 'stable' }, 'sync:atomic:1') })
    await store.save({ ...project, revision: 1 }, 0)
    expect(tables.get('meta')!.get('sync:atomic:1')).toEqual({ project: { ...project, revision: 1 }, mutationId: 'stable' })
    expect((tables.get('projects')!.get('atomic') as typeof project).revision).toBe(1)
  })
  it('retains the previous musical save if durable outbox creation fails', async () => {
    const project = createStudioProject(); project.id = 'atomic'
    const { factory, tables } = memoryFactory(project, project.id)
    const store = new StudioStore(factory, { onSaved: () => { throw new Error('Outbox quota failure') } })
    await expect(store.save({ ...project, revision: 1 }, 0)).rejects.toMatchObject({ code: 'write-failed' })
    expect(tables.get('projects')!.get('atomic')).toEqual(project)
  })
  it('isolates malformed siblings and identity mismatches without changing raw records', async () => {
    const project = createStudioProject(); project.id = 'healthy'
    const { factory, tables } = memoryFactory(project, 'healthy'), store = new StudioStore(factory)
    tables.get('projects')!.set('broken', { version: 4, notes: 'bad' })
    tables.get('projects')!.set('wrong-key', structuredClone(project))
    const before = structuredClone(tables), entries = await store.listEntries()
    expect(entries.healthy).toEqual([project])
    expect(entries.invalid.map(item => item.key)).toEqual(['broken', 'wrong-key'])
    expect(entries.invalid[0].raw).toEqual({ version: 4, notes: 'bad' })
    expect(await store.list()).toEqual([project])
    expect(tables).toEqual(before)
  })
  it('load is read-only; first successful successor save atomically retains the raw old project', async () => {
    const legacy=createLegacy(); legacy.id='legacy'; legacy.revision=7;
    legacy.notes=[{id:'held',instrument:'piano',pitch:64,startTick:137,durationTicks:2111,velocity:81}];
    const {factory,tables}=memoryFactory(legacy), store=new StudioStore(factory);
    const next=await store.load(); expect(next).toEqual(decodeStudioProject(legacy));
    expect(tables.get('projects')?.get('legacy')).toEqual(legacy);
    expect(await store.recoveryCopy('legacy')).toBeUndefined();
    await store.save({...next!,revision:8},7);
    expect(await store.recoveryCopy('legacy')).toEqual(legacy);
    expect(tables.get('projects')?.get('legacy')).toEqual({...next,revision:8});
    await store.save({...next!,name:'new name',revision:9},8);
    expect(await store.recoveryCopy('legacy')).toEqual(legacy);
    await expect(store.save({...next!,revision:9},8)).rejects.toMatchObject({code:'conflict'});
    expect((await store.load())?.name).toBe('new name');
  });
  it('stale revisions cannot create a backup or overwrite music', async () => {
    const legacy=createLegacy(); legacy.id='legacy'; legacy.revision=4;
    const {factory,tables}=memoryFactory(legacy),store=new StudioStore(factory);
    const next=decodeStudioProject(legacy);
    await expect(store.save({...next,revision:4},3)).rejects.toMatchObject({code:'conflict'});
    expect(tables.get('projects')?.get('legacy')).toEqual(legacy);
    expect(await store.recoveryCopy('legacy')).toBeUndefined();
  });
  it('v5 projects do not create misleading legacy backups', async () => {
    const project=createStudioProject();project.id='legacy';
    const {factory}=memoryFactory(project),store=new StudioStore(factory);
    await store.save({...project,revision:1},0);
    expect(await store.recoveryCopy(project.id)).toBeUndefined();
    expect(await store.list()).toEqual([{...project,revision:1}]);
  });
  it('backs up an exact v4 source once, preserving any older pre-v4 recovery copy', async () => {
    const project = createStudioProject(); project.id = 'legacy'; project.revision = 8
    project.patterns[0].notes = [{ id: 'exact', pitch: 60, startTick: 137, durationTicks: 2501, velocity: 73 }]
    const raw = { ...project, version: 4, tracks: project.tracks.map(track => Object.fromEntries(Object.entries(track).filter(([key]) => !['pan', 'space', 'spaceBypass', 'expression'].includes(key)))) }
    const { factory, tables } = memoryFactory(raw), store = new StudioStore(factory)
    const older = createLegacy(); tables.get('meta')!.set('pre-v4:legacy', older)
    expect(await store.load()).toEqual(project)
    expect(tables.get('projects')!.get('legacy')).toEqual(raw)
    await store.save({ ...project, revision: 9 }, 8)
    expect(await store.recoveryCopy('legacy')).toEqual(raw)
    expect(await store.recoveryCopy('legacy', 4)).toEqual(older)
    await store.save({ ...project, revision: 10, name: 'Changed' }, 9)
    expect(await store.recoveryCopy('legacy')).toEqual(raw)
  })
  it('aborts the whole upgrade when the exact recovery copy cannot be stored', async () => {
    const legacy = createLegacy(); legacy.id = 'legacy'
    const { factory, tables } = memoryFactory(legacy, 'legacy', true), store = new StudioStore(factory)
    const before = structuredClone(tables)
    await expect(store.save({ ...decodeStudioProject(legacy), revision: 1 }, 0)).rejects.toMatchObject({ code: 'write-failed' })
    expect(tables).toEqual(before)
  })
  it('preserves validated imported old JSON under the new copy identity in its first save', async () => {
    const source = createLegacy(); source.id = 'source'
    const project = { ...decodeStudioProject(source), id: 'import-copy', revision: 0 }
    const { factory, tables } = memoryFactory(createStudioProject()), store = new StudioStore(factory)
    const raw = structuredClone(source)
    const save = store.save(project, null, raw)
    raw.name = 'later mutation must not affect saved backup'
    await save
    expect(await store.recoveryCopy(project.id)).toEqual(source)
    expect(await store.recoveryCopy(project.id, 4)).toEqual(source)
    expect(tables.get('projects')!.get(project.id)).toEqual(project)
    await expect(store.save({ ...project, revision: 1 }, 0, source)).rejects.toMatchObject({ code: 'corrupt' })
    await expect(store.save({ ...project, id: 'bad' }, null, { ...source, notes: 'invalid' })).rejects.toMatchObject({ code: 'corrupt' })
    expect(tables.get('projects')!.has('bad')).toBe(false)
  })
});
