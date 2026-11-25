# NADI v020 public source v002

25 November 2026 · Parent application release `v020` (21 November 2026) · Parent source export `NADI-Public-Source-v001`

## Changes

- Prepared the full NADI v020 studio and local server source for public release with its tests, Supabase migrations, bundled samples, and asset credits.
- Included the empty Sirens study starter from v020 and documented the MIT software license and CC BY 4.0 artwork terms.
- Assigned this checkout port `5237` so its local launch can run alongside the original v020 release. Browser drafts can move between versions through `.nadi` export and import.

## Launch

Follow the [README](README.md) to install with Node.js 24, build, and launch the studio at [localhost port 5237](http://127.0.0.1:5237/#create).

## Verification

- The export inventory matches the v020 source staging manifest, with the release documentation, separate local port, and empty study starter accounted for in the updated checksums.
- A fresh `npm ci` completed under Node.js 24.18.0.
- ESLint, the production client build, and the standalone server build passed. Vite emitted warnings about bundle size and its planned native config loader.
- All 1,232 Vitest checks across 152 files passed.
- The standalone server served the studio, the bundled font, an instrument sample, and the Sirens starter on port 5237 without service credentials.
