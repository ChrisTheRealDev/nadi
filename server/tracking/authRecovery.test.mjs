import { describe, it, expect, vi } from 'vitest'
import { createTrackingRequestHandler } from './runtime.mjs'
const origin = 'http://localhost:3000'
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', NADI_ORIGIN: origin }
const req = (path, body, extra = {}) => new Request(`${origin}/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
function setup(status, data = {}) { const fetchImpl = vi.fn(async () => new Response(JSON.stringify(data), {status})); return { fetchImpl, handle: createTrackingRequestHandler({env, fetchImpl}) } }
describe('v009 auth recovery and failure classification', () => {
  it.each(['auth/login','auth/refresh','workspace'])('preserves service failures on %s instead of forcing sign-out', async path => {
    const {handle} = setup(503, {code:'unexpected_failure', message:'private debug detail'})
    const response = await handle(req(path, path === 'workspace' ? undefined : path === 'auth/login' ? {email:'a@test.invalid',password:'unchanged'} : {refreshToken:'test-refresh'}))
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({code:'auth-unavailable'})
  })
  it.each([[400,'invalid_credentials',401,'auth-rejected'],[400,'email_not_confirmed',403,'auth-account-attention'],[403,'user_banned',403,'auth-account-attention'],[429,'over_request_rate_limit',429,'auth-rate-limited'],[400,'unknown_future_failure',503,'auth-unavailable']])('normalizes login %s/%s without provider text', async (status,code,expected,mapped) => {
    const {handle} = setup(status,{code,message:'SECRET provider payload'})
    const response = await handle(req('auth/login',{email:'a@test.invalid',password:'unchanged'}))
    expect(response.status).toBe(expected); const body = await response.json(); expect(body.code).toBe(mapped); expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  it('expires a revoked refresh session but not an unknown error', async () => {
    const {handle} = setup(400,{code:'refresh_token_not_found'})
    expect((await handle(req('auth/refresh',{refreshToken:'old'}))).status).toBe(401)
  })
  it('does not treat malformed identity success as revoked credentials', async () => {
    expect((await setup(200,{}).handle(req('workspace'))).status).toBe(503)
  })
  it.each([200,400,404])('recovery hides account existence for provider status %s', async status => {
    const {handle,fetchImpl}=setup(status,{message:'account existence detail'})
    const response=await handle(req('auth/recover',{email:' user@test.invalid '}))
    expect(response.status).toBe(200);expect(await response.json()).toEqual({accepted:true})
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.supabase.co/auth/v1/recover')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({email:'user@test.invalid'})
  })
  it('rejects a caller-supplied recovery redirect before contacting provider',async()=>{
    const {handle,fetchImpl}=setup(200)
    expect((await handle(req('auth/recover',{email:'a@test.invalid',redirectTo:'https://evil.invalid'}))).status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('changes a password with only caller bearer and returns no tokens or user data',async()=>{
    const {handle,fetchImpl}=setup(200,{id:'private-user',email:'private',access_token:'private-token'})
    const response=await handle(req('auth/password',{password:'new-test-password'}))
    expect(await response.json()).toEqual({updated:true})
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({method:'PUT',headers:{Authorization:'Bearer test-token'}})
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({password:'new-test-password'})
  })
  it('rejects password mutation without bearer or from foreign origin',async()=>{
    const {handle,fetchImpl}=setup(200)
    expect((await handle(req('auth/password',{password:'new-test-password'},{authorization:''}))).status).toBe(401)
    expect((await handle(req('auth/password',{password:'new-test-password'},{origin:'https://evil.invalid'}))).status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('keeps provider password policies sanitized',async()=>{
    const response=await setup(422,{code:'weak_password',message:'SECRET'}).handle(req('auth/password',{password:'123456'}))
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'auth-password-policy'})
  })
})

describe('recovery delivery configuration', () => {
  it.each(['email_address_not_authorized', 'email_provider_disabled'])('surfaces %s as unavailable rather than claiming a request succeeded',async code=>{
    const response=await setup(400,{code}).handle(req('auth/recover',{email:'a@test.invalid'}))
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'auth-unavailable'})
  })
  it('retains rate-limit signal even when provider uses status400',async()=>{
    expect((await setup(400,{code:'over_email_send_rate_limit'}).handle(req('auth/recover',{email:'a@test.invalid'}))).status).toBe(429)
  })
})
