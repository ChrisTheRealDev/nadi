import { describe, expect, it, vi } from 'vitest'
import { createTrackingRequestHandler } from './runtime.mjs'
import { createStudioProject } from '../../src/creation/v4/model'
const actor='11111111-1111-4111-8111-111111111111'
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}
function request(path,body) { return new Request(`http://127.0.0.1:5176/api/v1/${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer caller-token','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) }
function setup(response={revision:1}) { const fetchImpl=vi.fn(async url=>new Response(JSON.stringify(url.endsWith('/auth/v1/user')?{id:actor}:response)));return {fetchImpl,handle:createTrackingRequestHandler({env,fetchImpl})} }
describe('shared music HTTP boundary (offline)',()=>{
 it('uses caller JWT for assigned learner reads',async()=>{ const {handle,fetchImpl}=setup({projects:[],revisions:[],exchanges:[],threads:[]});expect((await handle(request(`shared?learnerId=${actor}`))).status).toBe(200);expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer caller-token') })
 it('accepts the complete project including unplaced patterns',async()=>{const {handle,fetchImpl}=setup();const project=createStudioProject();project.clips=[];expect((await handle(request('shared',{kind:'revision',payload:{mutationId:crypto.randomUUID(),projectId:project.id,manifest:project,expectedRevision:0,savedAt:new Date().toISOString()}}))).status).toBe(200);expect(fetchImpl.mock.calls[1][1].body).toContain('manifest')})
 it('rejects corrupt graph before writing',async()=>{const {handle,fetchImpl}=setup();const project=createStudioProject();project.tracks[0].soundId='unknown';expect((await handle(request('shared',{kind:'revision',payload:{mutationId:crypto.randomUUID(),projectId:project.id,manifest:project}}))).status).toBe(400);expect(fetchImpl).toHaveBeenCalledTimes(1)})
 it('rejects altered capture hash before storage access',async()=>{const {handle,fetchImpl}=setup();expect((await handle(request('captures',{hash:'0'.repeat(64),base64:'YWJj',mimeType:'audio/webm'}))).status).toBe(400);expect(fetchImpl).toHaveBeenCalledTimes(1)})
 it('propagates stale remote revisions as conflicts',async()=>{const fetchImpl=vi.fn(async url=>new Response(JSON.stringify(url.endsWith('/auth/v1/user')?{id:actor}:{code:'40001'}),{status:url.endsWith('/auth/v1/user')?200:400}));const handle=createTrackingRequestHandler({env,fetchImpl});expect((await handle(request('shared',{kind:'resolve',payload:{mutationId:'stable',threadId:actor}}))).status).toBe(409)})
})
