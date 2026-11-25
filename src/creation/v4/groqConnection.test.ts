import { describe, expect, it, vi } from 'vitest'
import { studioMiraConnection } from './miraClient'

const signal = () => new AbortController().signal
describe('Groq local connection', () => {
  it('is ready without a pairing request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ready: true, authorized: true, provider: 'groq', remainingRequests: 100 })))
    expect(await studioMiraConnection(signal(), fetcher)).toEqual({ availability: 'ready', provider: 'groq', remainingRequests: 100 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('/api/mira/creation/status')
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined()
  })
  it('exposes bounded public provider/quota status only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ready: false, authorized: false, provider: 'groq', remainingRequests: 0, blocker: 'quota-exhausted' })))
    expect(await studioMiraConnection(signal(), fetcher)).toEqual({ availability: 'disabled', provider: 'groq', remainingRequests: 0, blocker: 'quota-exhausted' })
  })
})
