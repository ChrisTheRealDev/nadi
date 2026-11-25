import {afterEach,describe,it,expect,vi} from 'vitest'
import {TrackingClient} from './client'
const token={accessToken:'test-access',refreshToken:'test-refresh',expiresIn:3600}
const workspace={profile:{id:'student',display_name:'Fixture',role:'student'},disclosureAccepted:true,learners:[]}
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
afterEach(()=>vi.useRealTimers())
describe('v016 authentication disaster tests, simulated network only',()=>{
 it('bounds a fetch that ignores AbortSignal to15seconds and ignores its late success',async()=>{
  vi.useFakeTimers();let finish!:(r:Response)=>void
  const fetcher=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const client=new TrackingClient(fetcher);let outcome='pending'
  const result=client.login('fixture@example.invalid','fixture').then(()=>{outcome='accepted'},()=>{outcome='rejected'})
  try{await vi.advanceTimersByTimeAsync(15001);expect(outcome).toBe('rejected');expect(client.hasSession()).toBe(false)}
  finally{finish(reply(token));await result}
  expect(client.hasSession()).toBe(false)
 })
 it('bounds response JSON parsing even after fetch succeeds',async()=>{
  vi.useFakeTimers();let finish!:(v:unknown)=>void
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue({ok:true,json:()=>new Promise(resolve=>{finish=resolve})} as Response)
  const client=new TrackingClient(fetcher);let outcome='pending'
  const result=client.login('a','b').then(()=>{outcome='accepted'},()=>{outcome='rejected'});await flush()
  try{await vi.advanceTimersByTimeAsync(15001);expect(outcome).toBe('rejected')}
  finally{finish(token);await result}
  expect(client.hasSession()).toBe(false)
 })
 it('does not interpret a hung401 error body as an expired refresh session',async()=>{
  vi.useFakeTimers();let clock=0,finish!:(v:unknown)=>void
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockResolvedValueOnce({ok:false,status:401,json:()=>new Promise(resolve=>{finish=resolve})} as Response).mockResolvedValueOnce(reply(token)).mockResolvedValueOnce(reply(workspace))
  const client=new TrackingClient(fetcher,()=>clock);await client.login('a','b');clock=3600000
  let outcome='pending';const result=client.workspace().then(()=>{outcome='accepted'},()=>{outcome='rejected'});await flush()
  try{await vi.advanceTimersByTimeAsync(15001);expect(outcome).toBe('rejected');expect(client.hasSession()).toBe(true)}
  finally{finish({code:'auth-session-expired'});await result}
  expect(await client.workspace()).toEqual(workspace)
 })
 it('signout immediately settles an abort-ignoring request',async()=>{
  let finish!:(r:Response)=>void;const fetcher=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const client=new TrackingClient(fetcher);let outcome='pending'
  const result=client.login('a','b').then(()=>{outcome='accepted'},()=>{outcome='rejected'});client.signOut();await flush()
  try{expect(outcome).toBe('rejected')}
  finally{finish(reply(token));await result}
  expect(client.hasSession()).toBe(false)
 })
 it('the original read deadline also bounds a slow authentication refresh',async()=>{
  vi.useFakeTimers();let first!:(r:Response)=>void,finish!:(r:Response)=>void
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockImplementationOnce(()=>new Promise(resolve=>{first=resolve})).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const client=new TrackingClient(fetcher);await client.login('a','b');let outcome='pending'
  const pending=client.workspace().then(()=>{outcome='accepted'},()=>{outcome='rejected'});await flush()
  await vi.advanceTimersByTimeAsync(14000);first(reply({code:'auth-session-expired'},401));await flush()
  try{await vi.advanceTimersByTimeAsync(1001);expect(outcome).toBe('rejected');expect(client.hasSession()).toBe(true)}
  finally{finish(reply(token));await pending;await flush()}
 })
 it('keeps the original15second deadline when successful late refresh starts a hung retry',async()=>{
  vi.useFakeTimers();let first!:(r:Response)=>void,refresh!:(r:Response)=>void,last!:(r:Response)=>void
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockImplementationOnce(()=>new Promise(resolve=>{first=resolve})).mockImplementationOnce(()=>new Promise(resolve=>{refresh=resolve})).mockImplementationOnce(()=>new Promise(resolve=>{last=resolve}))
  const client=new TrackingClient(fetcher);await client.login('a','b');let outcome='pending'
  const pending=client.workspace().then(()=>{outcome='accepted'},()=>{outcome='rejected'});await flush()
  await vi.advanceTimersByTimeAsync(14000);first(reply({code:'auth-session-expired'},401));await flush()
  await vi.advanceTimersByTimeAsync(500);refresh(reply({...token,accessToken:'refreshed'}));await flush()
  try{await vi.advanceTimersByTimeAsync(501);expect(outcome).toBe('rejected');expect(client.hasSession()).toBe(true);expect(vi.getTimerCount()).toBe(0)}
  finally{last(reply(workspace));await pending;await flush()}
  expect(client.hasSession()).toBe(true)
 })
 it('a hung single-flight refresh releases all64 waiters and allows the next attempt',async()=>{
  vi.useFakeTimers();let clock=0,finish!:(r:Response)=>void
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(token)).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(async path=>reply(String(path).endsWith('/refresh')?token:workspace))
  const client=new TrackingClient(fetcher,()=>clock);await client.login('a','b');clock=3600000
  let settled=0;const waiting=Array.from({length:64},()=>client.workspace().then(()=>{settled++},()=>{settled++}));await flush()
  try{await vi.advanceTimersByTimeAsync(15001);expect(settled).toBe(64);expect(client.hasSession()).toBe(true)}
  finally{finish(reply(token));await Promise.all(waiting)}
  expect(await client.workspace()).toEqual(workspace)
  expect(fetcher.mock.calls.filter(([path])=>String(path).endsWith('/refresh'))).toHaveLength(2)
 })
 it('64 concurrent expired readers share one refresh and all recover after offline failure',async()=>{
  let clock=0,offline=true,refreshes=0
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async path=>{
   if(String(path).endsWith('/login'))return reply(token)
   if(String(path).endsWith('/refresh')){refreshes++;await flush();if(offline)throw new Error('simulated-offline-private');return reply({...token,accessToken:'rotated-access'})}
   return reply(workspace)
  })
  const client=new TrackingClient(fetcher,()=>clock);await client.login('a','b');clock=3600000
  const failed=await Promise.allSettled(Array.from({length:64},()=>client.workspace()))
  expect(failed.every(item=>item.status==='rejected')).toBe(true);expect(refreshes).toBe(1);expect(client.hasSession()).toBe(true)
  offline=false;const recovered=await Promise.all(Array.from({length:64},()=>client.workspace()))
  expect(recovered).toHaveLength(64);expect(refreshes).toBe(2);expect(client.hasSession()).toBe(true)
 })
 it('32 rapid login attempts cannot overwrite the final account when replies arrive backwards',async()=>{
  const completions:Array<(r:Response)=>void>=[]
  const fetcher=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(resolve=>{completions.push(resolve)}))
  const client=new TrackingClient(fetcher)
  const attempts=Array.from({length:32},(_,i)=>client.login(`fixture${i}@example.invalid`,'fixture').then(()=>true,()=>false))
  for(let i=31;i>=0;i--)completions[i](reply({...token,accessToken:`access-${i}`}))
  const results=await Promise.all(attempts);expect(results.filter(Boolean)).toHaveLength(1);expect(results[31]).toBe(true)
  fetcher.mockResolvedValueOnce(reply(workspace));await client.workspace()
  expect(fetcher.mock.calls[32][1]?.headers).toMatchObject({Authorization:'Bearer access-31'})
 })
 it.each([null,{}, {accessToken:'x',refreshToken:'y',expiresIn:0},{accessToken:'x',refreshToken:'y',expiresIn:'3600'}])('never installs malformed token response %j',async value=>{
  const client=new TrackingClient(vi.fn<typeof fetch>().mockResolvedValue(reply(value)))
  await expect(client.login('a','b')).rejects.toThrow();expect(client.hasSession()).toBe(false)
 })
})
