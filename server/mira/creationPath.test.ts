import { describe, expect, it } from 'vitest'
import { classifyCreationPath } from './creationPath'
describe('private Mira ledger URL protection', () => {
  it('blocks plain, encoded, nested-encoded and Windows case/separator paths', () => {
    for (const path of [
      '/.mira-private/no-such-ledger.json', '/.mira%2dprivate/no-such-ledger.json', '/%2emira-private/no-such-ledger.json',
      '/.MIRA-PRIVATE/no-such-ledger.json', '/.mIrA-pRiVaTe/no-such-ledger.json', '/%2EMIRA%2DPRIVATE/no-such-ledger.json',
      '/.mira%252dprivate/no-such-ledger.json', '/@fs/D:/studio/.mira-private/no-such-ledger.json',
      '/@fs/D:%5Cstudio%5C.MIRA-PRIVATE%5Cno-such-ledger.json',
    ]) expect(classifyCreationPath(path).rejection, path).toBe(403)
  })
  it('fails closed on malformed percent encodings', () => {
    for (const path of ['/%', '/%ZZ', '/%2', '/%E0%A4%A', '/.mira%private/file']) expect(classifyCreationPath(path).rejection, path).toBe(400)
  })
  it('preserves normal API and asset routes without treating query text as a file path', () => {
    expect(classifyCreationPath('/api/mira/creation/status?probe=%')).toEqual({ path: '/api/mira/creation/status', rejection: null })
    expect(classifyCreationPath('/assets/mira/mira-encouraging.png').rejection).toBeNull()
  })
})
