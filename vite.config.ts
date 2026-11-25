import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error Node-only middleware is deliberately outside the frontend type graph.
import { creationMiraPlugin } from './server/mira/creationRuntime.mjs'
// @ts-expect-error Server-only tracking transport; credentials never enter the frontend graph.
import { trackingPlugin } from './server/tracking/runtime.mjs'
// @ts-expect-error Shared Node-only settings for both local launch modes.
import { DEMO_HOST, DEMO_ORIGIN, DEMO_PORT, loadDemoEnvironment } from './server/demo/config.mjs'

export default defineConfig(async ({ command }) => {
  const plugins = [react()]
  if (command === 'build') return { plugins }

  const env = await loadDemoEnvironment()
  return {
    cacheDir: '.vite-cache',
    plugins: [
      ...plugins,
      creationMiraPlugin({ ...env, MIRA_ALLOWED_ORIGIN: DEMO_ORIGIN }),
      trackingPlugin({ ...env, NADI_ORIGIN: DEMO_ORIGIN }),
    ],
    server: {
      host: DEMO_HOST,
      port: DEMO_PORT,
      strictPort: true,
      watch: { ignored: ['**/backups/**', '**/demo-releases/**'], usePolling: false },
      fs: {
        // Supplying deny replaces Vite's defaults, so retain all current default protections.
        deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.mira-private/**'],
      },
    },
  }
})
