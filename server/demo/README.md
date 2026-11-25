# NADI v020 standalone local server

Run `npm run demo` from the project root to build and launch the application at [the public v020 origin](http://127.0.0.1:5237/#create). For repeated starts, build once with `npm run build` and `npm run build:server`, then use `npm run start:built` or `Start-NADI-v020.cmd` on Windows. `npm start` starts the development server on the same port. The launcher exits if the port is occupied.

The Node bundle serves the compiled `dist` files and runs tracking and optional Mira middleware on the same local origin. `npm run build:server` bundles the server's TypeScript dependencies. Keep runtime files and account data in the release folder where they were configured. Browser drafts stay with their browser and origin.

Configuration is optional for local composing and built-in Mira help. The server reads `.env.local`, then `.env.tracking.local`, with process environment values taking precedence. Use release-local configuration and keep the environment files out of any shared source export. The built server binds to loopback.

For a clean source checkout, install dependencies with `npm ci` before building. The relevant Node integration checks are in `server/demo/entry.test.mjs`. See the [contributor guide](../../docs/CONTRIBUTING-v020.md) for the fixture browser tests and the Supabase setup order.
