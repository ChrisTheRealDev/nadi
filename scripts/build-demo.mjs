import { rolldown } from 'rolldown'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Bundle the TypeScript dependency graph without embedding environment values. */
export async function buildDemoServer(output = resolve(projectRoot, '.nadi-server/server.mjs')) {
  const bundle = await rolldown({
    input: resolve(projectRoot, 'server/demo/entry.mjs'),
    platform: 'node', external: [/^node:/],
  })
  try { await bundle.write({ file: output, format: 'esm', sourcemap: false, codeSplitting: false }) }
  finally { await bundle.close() }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildDemoServer()
  console.log('Built standalone server at .nadi-server/server.mjs (no credentials bundled).')
}
