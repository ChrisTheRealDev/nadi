# Contributing to NADI v020

## Run and test locally

Follow the [local setup](../README.md). Run `npm run lint`, `npm run build`, and `npm test -- --maxWorkers=2 --pool=forks` from the project folder. The worker cap keeps the suite practical on a memory-constrained machine.

For the browser checks, install desktop Google Chrome and run `npm ci` to install Playwright from the lockfile. Start the built server at [the public v020 origin](http://127.0.0.1:5237/#create). Run these v020 fixture checks in another terminal.

| Command | Coverage |
| --- | --- |
| `npm run test:browser:studio` | Compose, record, save and reopen, audio and MIDI exports, and score controls |
| `npm run test:browser:midi` | Simulated MIDI ports and note routing |
| `npm run test:browser:tutor` | Mocked student and tutor sign-in, sync retry, and feedback |
| `npm run test:browser:visual` | Appearance, responsive layout and sampled contrast |
| `npm run test:browser:score` | Dense-score preparation, progress, cancellation and rendered pages |

These checks use fresh Chrome profiles and fictional projects or responses. Physical MIDI and actual Supabase access are separate checks. The historical browser helpers use earlier ports and fixtures. Use the commands in the table for v020.

## Add a studio feature

- Start at `src/creation/v4/StudioApp.tsx` and its panels. Put each musical edit in the model or operation it belongs to so that editing, Undo, saving and exports share the same semantics.
- Use `StudioStore` for anonymous IndexedDB projects and `AccountStudioStore` for enrolled students. Preserve the transaction that saves account work and queues a revision, reuse mutation IDs on retry, and test existing `.nadi` projects when changing the model.
- For a tutor feature, follow `TrackingClient` in `src/tracking` to the Node `/api/v1` handlers in `server/tracking`. Validate actors and requests at the server boundary and enforce access in the database. Reuse the theme tokens and check desktop and phone layouts.

## Send a track to another music app

Set up a dedicated MIDI port in the receiving app or DAW. Disable MIDI Thru there to help avoid loops. In NADI, open **Settings → External MIDI instrument → Find MIDI outputs**, grant browser permission, and choose the output, studio track, and MIDI channel that the app is listening to.

Play that track from the arrangement or use NADI's screen and computer keys with the track selected. Enable **Also play the NADI sound** if you want to hear both. Record external instrument audio in the receiving app. NADI renders its built-in instruments for WAV export. The routing selection is local to the current session.

## Prepare a test Supabase environment

1. In a separate project, apply the four files in `supabase/migrations` in filename order. Preserve deployed migrations and add a new migration for subsequent changes.
2. Keep registration owner-managed. Create fictional Auth users for a student, an assigned tutor, and an unrelated account. Provision `public.nadi_profiles` with their Auth user IDs, fictional display names, and role values `student` or `mentor`. Put the assigned student's ID in `nadi_assignments.learner_id` and the tutor's in `nadi_assignments.mentor_id`.
3. Copy `.env.example` to your own `.env.local`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for that project. `SUPABASE_ANON_KEY` is the legacy alternative. Restart the local server. The [server guide](../server/demo/README.md) explains configuration precedence.
4. Sign in as the fictional student and accept the in-app disclosure and sharing enrollment. Confirm that the `nadi-captures` bucket is private. Save a revision and a fictional capture. Verify the assigned tutor can review and comment, the student can receive feedback and continue editing, and unrelated or signed-out accounts cannot read the work or capture. Verify that the tutor cannot submit a student's project revision.
5. Disconnect and recover the student connection. Confirm that exactly one revision is delivered, even if a submission is retried. Check that anonymous local projects remain separate from account work.

A later hosted release needs an HTTPS origin, a same-origin deployment design, and a plan for database and private capture backups. Keep the built-in Mira help available while evaluating any separate live provider setup.

## Recover from a local interruption

Restart the same v020 launcher and reopen the same address in the same browser. Keep the terminal error or note the action in progress. If the studio still responds, make a `.nadi` backup before restarting. A project can also be moved between origins by exporting and importing that archive.
