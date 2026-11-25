export type RecoveryLink = { token: string | null } | null

// Run once before React mounts: StrictMode may invoke component initializers twice.
export function consumeRecoveryFragment(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): RecoveryLink {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  const recovery = params.get('type') === 'recovery'
  const authFragment = params.has('access_token') || params.has('refresh_token') || params.has('error_code') || params.has('error_description')
  if (!recovery && !authFragment) return null
  // Never retain credentials in the URL, including unsupported authentication callbacks.
  history.replaceState(null, '', `${location.pathname}${location.search}#progress`)
  const token = params.get('access_token')
  return { token: recovery && !params.has('error') && token ? token : null }
}

export async function updateRecoveryPassword(token: string, password: string, request: typeof fetch = fetch) {
  const reply = await request('/api/v1/auth/password', {
    method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  })
  if (reply.ok) return
  if (reply.status === 401 || reply.status === 403) throw new Error('This recovery link has expired or was already used. Request a new email below.')
  if (reply.status === 400) throw new Error('Choose a different, stronger password. Use at least 8 characters.')
  if (reply.status === 429) throw new Error('Too many attempts. Wait a few minutes before trying again.')
  throw new Error('The sign-in service could not be reached. Keep this page open and try again.')
}
