import { describe, expect, it, vi } from 'vitest'
import { consumeRecoveryFragment, updateRecoveryPassword } from './recoveryFragment'

describe('account recovery boundary', () => {
  it('scrubs all fragment credentials immediately and only accepts a recovery callback', () => {
    const replaceState = vi.fn()
    expect(consumeRecoveryFragment({ hash: '#access_token=fake-secret&refresh_token=fake-refresh&type=recovery', pathname: '/', search: '' }, { replaceState })).toEqual({ token: 'fake-secret' })
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#progress')
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain('secret')
    expect(consumeRecoveryFragment({ hash: '#access_token=fake-secret&type=signup', pathname: '/', search: '' }, { replaceState })).toEqual({ token: null })
  })
  it('does not intercept ordinary navigation and safely consumes expired callbacks', () => {
    const replaceState = vi.fn()
    expect(consumeRecoveryFragment({ hash: '#create', pathname: '/', search: '' }, { replaceState })).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
    expect(consumeRecoveryFragment({ hash: '#error=access_denied&error_code=otp_expired', pathname: '/', search: '' }, { replaceState })).toEqual({ token: null })
  })
  it('sends bearer only to local password endpoint with no cookies, never in URL', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await updateRecoveryPassword('fake-token', 'fake-password', request)
    expect(request).toHaveBeenCalledWith('/api/v1/auth/password', expect.objectContaining({ credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' }, body: JSON.stringify({ password: 'fake-password' }) }))
  })
  it.each([401, 403, 400, 429, 503])('provides a safe error for status %s', async status => {
    const request = vi.fn().mockResolvedValue(new Response('private upstream detail', { status }))
    await expect(updateRecoveryPassword('fake-token', 'fake-password', request)).rejects.toThrow()
    await expect(updateRecoveryPassword('fake-token', 'fake-password', request)).rejects.not.toThrow('private upstream detail')
  })
})
