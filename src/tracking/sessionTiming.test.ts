import {describe,it,expect,vi} from 'vitest'
import {TrackingClient} from './client'
const token={accessToken:'old-access',refreshToken:'refresh-one',expiresIn:3600}
const rotated={accessToken:'new-access',refreshToken:'refresh-two',expiresIn:3600}
const workspace={profile:{id:'student',display_name:'Test',role:'student'},disclosureAccepted:true,learners:[]}
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
describe('v012 session timing regressions',()=>{
 it('recovers early server expiry with one refresh/read retry',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401)).mockResolvedValueOnce(reply(rotated)).mockResolvedValueOnce(reply(workspace))
  const client=new TrackingClient(fetcher);await client.login('test@example.invalid','unchanged')
  expect(await client.workspace()).toEqual(workspace);expect(client.hasSession()).toBe(true)
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual(['/api/v1/auth/login','/api/v1/workspace','/api/v1/auth/refresh','/api/v1/workspace'])
  expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({Authorization:'Bearer new-access'})
 })
 it('late old-token rejection cannot erase a valid refreshed session',async()=>{
  let clock=0,finish!:(r:Response)=>void,started!:()=>void
  const began=new Promise<void>(resolve=>{started=resolve})
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockImplementationOnce(()=>{started();return new Promise(resolve=>{finish=resolve})}).mockResolvedValueOnce(reply(rotated)).mockResolvedValueOnce(reply(workspace)).mockResolvedValueOnce(reply(workspace))
  const client=new TrackingClient(fetcher,()=>clock);await client.login('a','b')
  const slow=client.workspace();await began;clock=3600000
  expect(await client.workspace()).toEqual(workspace)
  finish(reply({},401));expect(await slow).toEqual(workspace);expect(client.hasSession()).toBe(true)
  expect(fetcher.mock.calls.filter(([path])=>String(path).endsWith('/refresh'))).toHaveLength(1)
 })
 it('stops after one failed read retry and clears genuinely expired session',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401)).mockResolvedValueOnce(reply(rotated)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401))
  const client=new TrackingClient(fetcher);await client.login('a','b');await expect(client.workspace()).rejects.toMatchObject({status:401});expect(client.hasSession()).toBe(false);expect(fetcher).toHaveBeenCalledTimes(4)
 })
 it('preserves session on refresh outage after early expiry',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401)).mockResolvedValueOnce(reply({code:'auth-unavailable'},503))
  const client=new TrackingClient(fetcher);await client.login('a','b');await expect(client.workspace()).rejects.toMatchObject({status:503});expect(client.hasSession()).toBe(true)
 })
 it.each(['workspace','refresh'])('plain403 %s configuration rejection does not erase authentication',async path=>{
  let clock=0;const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply({},403))
  const client=new TrackingClient(fetcher,()=>clock);await client.login('a','b');if(path==='refresh')clock=3600000
  await expect(client.workspace()).rejects.toMatchObject({status:403});expect(client.hasSession()).toBe(true)
 })
 it('does not automatically replay a rejected mutation',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply(workspace)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401))
  const client=new TrackingClient(fetcher);await client.login('a','b');await client.workspace()
  await expect(client.feedbackCommand('student','question',{mutationId:'stable',message:'hello'})).rejects.toMatchObject({status:401})
  expect(fetcher).toHaveBeenCalledTimes(3)
 })
 it('signout during refresh never retries under another account',async()=>{
  let finish!:(r:Response)=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve})
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply({code:'auth-session-expired'},401)).mockImplementationOnce(()=>{started();return new Promise(resolve=>{finish=resolve})})
  const client=new TrackingClient(fetcher);await client.login('a','b');const pending=client.workspace();await began;client.signOut();finish(reply(rotated));await expect(pending).rejects.toThrow('Session changed');expect(client.hasSession()).toBe(false);expect(fetcher).toHaveBeenCalledTimes(3)
 })
})
