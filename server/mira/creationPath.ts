/** Canonicalize before Vite can decode a URL into a filesystem path. */
export function classifyCreationPath(rawUrl: string | undefined): { path: string; rejection: 400 | 403 | null } {
  let path = (rawUrl ?? '').split('?')[0]
  try {
    // Repeated decoding also closes nested encodings, regardless of how many downstream layers decode.
    for (let pass = 0; pass < 5; pass++) {
      const decoded = decodeURIComponent(path)
      if (decoded === path) break
      path = decoded
    }
    if (/%[0-9a-f]{2}/i.test(path)) return { path: '', rejection: 400 }
  } catch { return { path: '', rejection: 400 } }
  path = path.replace(/\\/g, '/')
  return { path, rejection: path.toLowerCase().includes('.mira-private') ? 403 : null }
}
