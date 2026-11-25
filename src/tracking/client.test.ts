import { describe, expect, it, vi } from 'vitest'
import { parseTrackingWorkspace, TrackingClient } from './client'
import type { TrackingCommand } from './commands'

const profile = { id: 'student', display_name: 'Alex', role: 'student' }
const workspace = { profile, disclosureAccepted: false, learners: [{ profile, progress: {
  learnerId: 'student', goals: [], workSessions: [], events: [], checkpoints: [], feedback: [], helpRequests: [],
} }] }
const token = { accessToken: 'test-access', refreshToken: 'test-refresh', expiresIn: 3600 }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

describe('tracking read-only client', () => {
  it('projects only display data, ignoring private or unexpected fields', () => {
    const input = structuredClone(workspace)
    Object.assign(input.learners[0].progress, { recordings: ['private'], checkpoints: [{ id: 'cp', goal_id: 'g', reflection: '', created_at: 'today', snapshot: { private: 'not UI data' } }] })
    const output = parseTrackingWorkspace(input)
    expect(JSON.stringify(output)).not.toContain('private')
    expect(output.learners[0].progress.checkpoints[0]).not.toHaveProperty('snapshot')
  })
  it.each([null, {}, { ...workspace, profile: { ...profile, role: 'admin' } }, { ...workspace, learners: [null] }, { ...workspace, disclosureAccepted: 'yes' }])('rejects malformed workspace %j', input => {
    expect(() => parseTrackingWorkspace(input)).toThrow('could not be read')
  })
  it('signs in, then reads with the actor token and no cookies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response(workspace))
    const client = new TrackingClient(fetcher)
    await client.login(' alex@example.test ', 'private-password')
    expect(await client.workspace()).toEqual(workspace)
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/login')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer test-access' } })
    client.signOut()
    await expect(client.workspace()).rejects.toThrow('Sign in')
  })
  it('does not forward server/provider secrets in errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'SECRET' }, 401))
    await expect(new TrackingClient(fetcher).login('a', 'b')).rejects.toThrow('Sign-in expired')
  })
  it('rejects invalid token responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ accessToken: 'x' }))
    await expect(new TrackingClient(fetcher).login('a', 'b')).rejects.toThrow('could not be read')
  })
  it('does not expose non-JSON response fragments or network exceptions', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_PROXY_TOKEN_CONTENT')), vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE_NETWORK_CONTENT'))]) {
      const client = new TrackingClient(fetcher)
      await expect(client.status()).rejects.toThrow('connection unavailable or response unreadable')
    }
  })
  it('ignores a late login after sign out even if fetch ignores cancellation', async () => {
    let finish!: (r: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const client = new TrackingClient(fetcher)
    const login = client.login('a', 'b')
    client.signOut(); finish(response(token))
    await expect(login).rejects.toThrow('Session changed')
    await expect(client.workspace()).rejects.toThrow('Sign in')
  })
  it('ignores late workspace data after account boundary', async () => {
    let finish!: (r: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(token)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const client = new TrackingClient(fetcher)
    await client.login('a', 'b')
    const pending = client.workspace(); await Promise.resolve(); client.signOut(); finish(response(workspace))
    await expect(pending).rejects.toThrow('Session changed')
  })
  it('cannot revive tokens if signout happens between parsing and installing tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ({ ok: true, json: async () => {
      queueMicrotask(() => queueMicrotask(() => client.signOut()))
      return token
    } }) as Response)
    const client = new TrackingClient(fetcher)
    await expect(client.login('a', 'b')).rejects.toThrow('Session changed')
    await expect(client.workspace()).rejects.toThrow('Sign in')
  })
  it('refreshes once for concurrent expired reads', async () => {
    let time = 0
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(token)).mockImplementation(async path => response(String(path).endsWith('refresh') ? token : workspace))
    const client = new TrackingClient(fetcher, () => time)
    await client.login('a', 'b'); time = 3600000
    await Promise.all([client.workspace(), client.workspace()])
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('refresh'))).toHaveLength(1)
  })
  it('performs only the requested status read and no automatic login or writes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ configured: false, reason: 'Owner setup required' }))
    expect(await new TrackingClient(fetcher).status()).toEqual({ configured: false, reason: 'Owner setup required' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET')
  })
  it('calls browser host fetch without a class receiver', async () => {
    const fetcher = function (this: unknown) {
      expect(this).toBeUndefined()
      return Promise.resolve(response({ configured: true, reason: 'Sign in' }))
    } as typeof fetch
    expect(await new TrackingClient(fetcher).status()).toEqual({ configured: true, reason: 'Sign in' })
  })
})

describe('actor-bound tracking commands', () => {
  const actor='10000000-0000-4000-8000-000000000001', goal='20000000-0000-4000-8000-000000000001', submission='30000000-0000-4000-8000-000000000001'
  const data={...workspace,profile:{...profile,id:actor}}
  const command:TrackingCommand={kind:'goal-status',payload:{submissionId:submission,goalId:goal,expectedVersion:2,status:'in-progress'}}
  async function setup(responseValue:unknown={id:goal,version:3,status:'in-progress'}, status=200) {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(responseValue,status))
    const client=new TrackingClient(fetcher);await client.login('a','b');await client.workspace();return{client,fetcher}
  }
  it('uses PATCH, frozen version and verified actor token for status',async()=>{
    const{client,fetcher}=await setup()
    expect(await client.command(actor,command)).toEqual({id:goal,version:3,status:'in-progress'})
    expect(fetcher.mock.calls[2]).toMatchObject([`/api/v1/goals/${goal}`,{method:'PATCH',body:JSON.stringify(command.payload),headers:{Authorization:'Bearer test-access'}}])
  })
  it('rejects a different actor before writing',async()=>{
    const{client,fetcher}=await setup()
    await expect(client.command('someone-else',command)).rejects.toThrow('Account changed')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('requires a verified workspace before any shared mutation',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response(token));const client=new TrackingClient(fetcher)
    await client.login('a','b')
    await expect(client.command(actor,command)).rejects.toThrow('Account changed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('never silently replaces a frozen revision after conflict',async()=>{
    const{client,fetcher}=await setup({error:'conflict'},409)
    await expect(client.command(actor,command)).rejects.toMatchObject({status:409})
    expect(fetcher).toHaveBeenCalledTimes(3);expect(command.payload).toHaveProperty('expectedVersion',2)
  })
  it('ignores commands interrupted by signout during token preparation',async()=>{
    const{client,fetcher}=await setup()
    const pending=client.command(actor,command);client.signOut()
    await expect(pending).rejects.toThrow('Account changed')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('validates rather than trusts a confirmation',async()=>{
    const{client}=await setup({id:goal,version:50,status:'in-progress'})
    await expect(client.command(actor,command)).rejects.toThrow('did not match')
  })
  it('rejects malformed status enums before transmission',async()=>{
    const{client,fetcher}=await setup()
    const invalid={...command,payload:{...command.payload,status:['in-progress']}} as unknown as TrackingCommand
    await expect(client.command(actor,invalid)).rejects.toThrow('Invalid update')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('requires a numeric goal version in fetched workspace data',()=>{
    const invalid=structuredClone(workspace)
    Object.assign(invalid.learners[0].progress,{goals:[{id:goal,title:'Goal',description:'',status:'not-started',due_date:null,created_at:'today',version:'0'}]})
    expect(()=>parseTrackingWorkspace(invalid)).toThrow('could not be read')
  })
})

describe('v009 authentication status recovery', () => {
  it.each([429,503])('retains tokens after transient refresh status %s and retries successfully', async status => {
    let clock = 0
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({...token,expiresIn:31})).mockResolvedValueOnce(response({code:'auth-unavailable'},status)).mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response(workspace))
    const client=new TrackingClient(fetcher,()=>clock)
    await client.login('student@test.invalid','password')
    clock=2000
    await expect(client.workspace()).rejects.toMatchObject({status})
    expect(client.hasSession()).toBe(true)
    expect(await client.workspace()).toEqual(workspace)
  })
  it('preserves session through identity service outage',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response({},503)).mockResolvedValueOnce(response(workspace))
    const client=new TrackingClient(fetcher);await client.login('a','b')
    await expect(client.workspace()).rejects.toMatchObject({status:503});expect(client.hasSession()).toBe(true)
    expect(await client.workspace()).toEqual(workspace)
  })
  it('accepts only known authentication codes and never provider prose',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({code:'auth-account-attention',error:'SECRET'},403)).mockResolvedValueOnce(response({code:'SECRET',error:'SECRET'},401))
    const client=new TrackingClient(fetcher)
    await expect(client.login('a','b')).rejects.toMatchObject({code:'auth-account-attention',status:403})
    await expect(client.login('a','b')).rejects.toMatchObject({code:undefined,status:401})
  })
})
