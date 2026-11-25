import { describe, expect, it, vi } from 'vitest'
import { PendingCommands, IndexedPendingCommands, type PendingCommand, type PendingCommandStorage, type CommandRejection } from './submissions'
import { validTrackingCommand, validateCommandResult, type TrackingCommand } from './commands'
import { TrackingRequestError, type TrackingClient } from './client'

const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002', S='20000000-0000-4000-8000-000000000001', G='30000000-0000-4000-8000-000000000001'
const command = (): TrackingCommand => ({kind:'goal-create',payload:{submissionId:S,learnerId:B,title:'Explore a rhythm',description:'Try a short idea.'}})
class MemoryStore implements PendingCommandStorage {
  records = new Map<string,PendingCommand>()
  async list(actorId:string) { return structuredClone([...this.records.values()].filter(r=>r.actorId===actorId)) }
  async add(r:PendingCommand) { const key=`${r.actorId}/${r.id}`; const existing=this.records.get(key); if(existing && JSON.stringify(existing.command)!==JSON.stringify(r.command)) throw new Error('conflict'); this.records.set(key,structuredClone(r)) }
  async remove(actorId:string,id:string) { this.records.delete(`${actorId}/${id}`) }
  async reject(actorId:string,id:string,rejection:CommandRejection|undefined) { const r=this.records.get(`${actorId}/${id}`)!;if(rejection)r.rejection=rejection;else delete r.rejection }
}
function client() {
  let active=true
  return {
    sessionGuard:vi.fn(() => { const guard=()=>{if(!active)throw new Error('Account changed')}; guard(); return guard }),
    command:vi.fn(async()=>({id:G,version:0})), submission:vi.fn(async()=>({found:true,result:{id:G,version:0}})),
    workspace:vi.fn(async()=>({disclosureAccepted:true})), signOut:()=>{active=false},
  }
}
type ClientMock = ReturnType<typeof client>
const asClient=(c:ClientMock)=>c as unknown as TrackingClient
describe('durable actor-scoped text submissions',()=>{
  it('persists before sending and freezes all user fields',async()=>{
    const storage=new MemoryStore(), queue=new PendingCommands(A,storage), c=client(), input=command()
    const r=await queue.prepare(input)
    if(input.kind==='goal-create')input.payload.title='New text'
    expect(c.command).not.toHaveBeenCalled()
    await queue.send(r.id,asClient(c))
    expect(c.command).toHaveBeenCalledWith(A,command())
    expect(await queue.list()).toHaveLength(0)
  })
  it('retains a frozen command after response loss and reloads for identical retry',async()=>{
    const storage=new MemoryStore(), queue=new PendingCommands(A,storage), c=client()
    const r=await queue.prepare(command())
    c.command.mockRejectedValueOnce(new Error('network lost'))
    await expect(queue.send(r.id,asClient(c))).rejects.toThrow('network lost')
    const reopened=new PendingCommands(A,storage)
    expect(await reopened.list()).toHaveLength(1)
    await reopened.send(r.id,asClient(c))
    expect(c.command.mock.calls[0]).toEqual(c.command.mock.calls[1])
  })
  it('cannot read or send another actor queue',async()=>{
    const storage=new MemoryStore(), queue=new PendingCommands(A,storage), other=new PendingCommands(B,storage), c=client()
    await queue.prepare(command())
    expect(await other.list()).toEqual([])
    await expect(other.send(S,asClient(c))).rejects.toThrow('not found')
    expect(c.command).not.toHaveBeenCalled()
  })
  it('blocks sends on storage failure',async()=>{
    const storage=new MemoryStore(); storage.add=async()=>{throw new Error('disk full')}
    await expect(new PendingCommands(A,storage).prepare(command())).rejects.toThrow('disk full')
    await expect(new IndexedPendingCommands(undefined).list(A)).rejects.toThrow('storage unavailable')
  })
  it('coalesces double sends of the same submission',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();await queue.prepare(command())
    const a=queue.send(S,asClient(c)),b=queue.send(S,asClient(c))
    await Promise.all([a,b]);expect(c.command).toHaveBeenCalledTimes(1)
  })
  it('does not delete an unconfirmed pending update',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();await queue.prepare(command())
    c.submission.mockResolvedValue({found:false,result:null} as never)
    expect(await queue.check(S,asClient(c))).toEqual({found:false,result:null})
    expect(await queue.list()).toHaveLength(1)
  })
  it('resolves a lost successful response by receipt without sending again',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();await queue.prepare(command())
    expect((await queue.check(S,asClient(c))).found).toBe(true)
    expect(c.command).not.toHaveBeenCalled();expect(await queue.list()).toHaveLength(0)
  })
  it('uses disclosure state rather than a nonexistent submission receipt',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();const r=await queue.prepare({kind:'disclosure',payload:{version:1}})
    expect((await queue.check(r.id,asClient(c))).found).toBe(true)
    expect(c.submission).not.toHaveBeenCalled();expect(c.workspace).toHaveBeenCalledTimes(1)
  })
  it('keeps unaccepted disclosure pending',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();const r=await queue.prepare({kind:'disclosure',payload:{version:1}})
    c.workspace.mockResolvedValue({disclosureAccepted:false})
    expect((await queue.check(r.id,asClient(c))).found).toBe(false)
    expect(await queue.list()).toHaveLength(1)
  })
  it('reports server success separately from local cleanup failure',async()=>{
    const storage=new MemoryStore(),queue=new PendingCommands(A,storage),c=client();await queue.prepare(command())
    storage.remove=async()=>{throw new Error('disk error')}
    expect(await queue.send(S,asClient(c))).toMatchObject({id:G,localCleanupPending:true})
    expect(await queue.list()).toHaveLength(1)
  })
  it('signout during disk read blocks transmission',async()=>{
    const storage=new MemoryStore(),queue=new PendingCommands(A,storage),c=client();await queue.prepare(command())
    const original=storage.list.bind(storage);storage.list=async a=>{const r=await original(a);c.signOut();return r}
    await expect(queue.send(S,asClient(c))).rejects.toThrow('Account changed')
    expect(c.command).not.toHaveBeenCalled()
  })
  it('signout after server response retains pending data for original actor',async()=>{
    const storage=new MemoryStore(),queue=new PendingCommands(A,storage),c=client();await queue.prepare(command())
    c.command.mockImplementation(async()=>{c.signOut();return{id:G,version:0}})
    await expect(queue.send(S,asClient(c))).rejects.toThrow('Account changed')
    expect(await queue.list()).toHaveLength(1)
  })
  it('rejects a corrupted queue identity without sending it',async()=>{
    const storage=new MemoryStore(),queue=new PendingCommands(A,storage),c=client();await queue.prepare(command())
    const r=storage.records.get(`${A}/${S}`)!;r.id=G
    await expect(queue.send(G,asClient(c))).rejects.toThrow('unreadable')
    expect(c.command).not.toHaveBeenCalled()
  })
  it('rejects rewriting a persisted submission ID',async()=>{
    const queue=new PendingCommands(A,new MemoryStore());await queue.prepare(command())
    const changed=command();if(changed.kind==='goal-create')changed.payload.title='Changed'
    await expect(queue.prepare(changed)).rejects.toThrow('conflict')
  })
  it('keeps data when server returns a mismatched confirmation',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();await queue.prepare(command())
    c.command.mockResolvedValue({id:G,version:8})
    await expect(queue.send(S,asClient(c))).rejects.toThrow('did not match')
    expect(await queue.list()).toHaveLength(1)
  })
  it('allows explicit removal of a rejected revision after reload, not uncertain work',async()=>{
    const storage=new MemoryStore(),queue=new PendingCommands(A,storage),c=client();await queue.prepare(command())
    await expect(queue.discardRejected(S)).rejects.toThrow('unconfirmed')
    c.command.mockRejectedValue(new TrackingRequestError('Conflict',409))
    await expect(queue.send(S,asClient(c))).rejects.toThrow('Conflict')
    const reopened=new PendingCommands(A,storage)
    expect((await reopened.list())[0].rejection).toBe('conflict')
    await reopened.discardRejected(S);expect(await reopened.list()).toHaveLength(0)
  })
  it('does not give another signed-out caller a shared-flight result',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client(),other=client();await queue.prepare(command())
    const flight=queue.send(S,asClient(c));other.signOut()
    expect(()=>queue.send(S,asClient(other))).toThrow('Account changed')
    await flight
  })
  it('clears an earlier rejection before retry so response loss cannot enable unsafe discard',async()=>{
    const queue=new PendingCommands(A,new MemoryStore()),c=client();await queue.prepare(command())
    c.command.mockRejectedValueOnce(new TrackingRequestError('Denied',403)).mockRejectedValueOnce(new Error('response lost'))
    await expect(queue.send(S,asClient(c))).rejects.toThrow('Denied')
    await expect(queue.send(S,asClient(c))).rejects.toThrow('response lost')
    expect((await queue.list())[0].rejection).toBeUndefined()
    await expect(queue.discardRejected(S)).rejects.toThrow('unconfirmed')
  })
})
describe('bounded commands',()=>{
  it.each([
    {kind:'goal-create',payload:{submissionId:S,learnerId:B,title:' ',description:''}},
    {kind:'goal-create',payload:{submissionId:S,learnerId:B,title:'Hi',description:'',dueDate:'2026-02-30'}},
    {kind:'goal-status',payload:{submissionId:S,goalId:G,expectedVersion:-1,status:'in-progress'}},
    {kind:'goal-status',payload:{submissionId:S,goalId:G,expectedVersion:0,status:['in-progress']}},
    {kind:'help-create',payload:{submissionId:S,goalId:G,message:'x',recordings:[]}},
    {kind:'disclosure',payload:{version:1,submissionId:S}},
  ])('rejects invalid or private fields %j',value=>expect(validTrackingCommand(value)).toBe(false))
  it('accepts exact status and no-op version confirmations',()=>{
    const c:TrackingCommand={kind:'goal-status',payload:{submissionId:S,goalId:G,expectedVersion:2,status:'in-progress'}}
    expect(validateCommandResult(c,{id:G,version:2,status:'in-progress'}).version).toBe(2)
    expect(validateCommandResult(c,{id:G,version:3,status:'in-progress'}).version).toBe(3)
    expect(()=>validateCommandResult(c,{id:G,version:4,status:'in-progress'})).toThrow()
  })
})
