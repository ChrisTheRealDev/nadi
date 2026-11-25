# NADI v020

NADI is a browser-based music studio for composing, recording and arranging music. An optional tutor workspace lets enrolled students share revisions and receive feedback.

## Open the studio

Install Node.js 24 and use npm from this folder.

~~~sh
npm ci
npm run build
npm run build:server
npm run start:built
~~~

Open [NADI v020](http://127.0.0.1:5237/#create) in Chrome or Edge. On Windows, `Start-NADI-v020.cmd` can start the built server after the two build commands. For development, stop your built server and run `npm start`.

The studio, local saves, audio and MIDI exports, and Mira's built-in help work without an account or API key. Drafts are tied to the browser and address. To bring a draft from an older release, export a `.nadi` project there and import it in v020.

## Extend or test NADI

- [Contributor guide](docs/CONTRIBUTING-v020.md) covers the studio code, browser tests, external MIDI, and a future Supabase setup.
- [Local server](server/demo/README.md) covers the standalone build and isolated environment settings.
- [Asset credits](docs/ASSETS-v020.md) document the bundled audio, font, and artwork.
- [Release notes](RELEASE-v020-public-source-v002.md) record the source revision and verification.

## License

The original software and software documentation are available under the [MIT License](LICENSE). Original artwork is available under [CC BY 4.0](ARTWORK.md). Bundled samples, fonts, and dependencies carry their own terms. See the [asset credits](docs/ASSETS-v020.md).
