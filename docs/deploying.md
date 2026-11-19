# Deploying to Vercel

Aliike runs on Vercel with a Postgres database and a Vercel Blob store. Nothing in it needs a server that stays up: every request is handled by a short-lived function, and anything that takes longer is split into steps kept in the database.

## What runs where

| Part | On Vercel | In local development |
| --- | --- | --- |
| Pages and API | Vercel Functions (Node.js, Fluid compute) | `next dev` |
| Database | Neon Postgres, through `DATABASE_URL` (any Postgres works) | An embedded Postgres (PGlite) in `data/pg`, no setup |
| Files (selfies, character images, 3D models) | A private Vercel Blob store | `data/files` |
| The 3D build | fal's queue, moved on by the creator's page and by fal's callback | The same, moved on by the creator's page |
| Rate limits, sessions, plans | Postgres | The embedded Postgres |

## Setting it up

1. **Import the repository** in Vercel. It is a standard Next.js project with no build settings to change. The only thing in `vercel.json` is the daily schedule for deleting unused accounts.

2. **Add the database (Neon).** In the project's **Storage** tab choose Neon from the Marketplace and connect it to the project. That adds the connection string to the project's environment. The app reads `DATABASE_URL`, or `POSTGRES_URL` if that is what the provider sets; use the pooled connection string. The tables are created on the first request; there is no migration step to run. Three settings matter for privacy:
   - **Region.** It is fixed when the Neon project is created. Pick the one the functions will run in (see Region below).
   - **Restore window** (Neon Console → project settings). This is how long a deleted row can still be restored. The Privacy page says database backups last up to 30 days, so keep it at 30 days or less; the default of 1 day on the Launch and Scale plans is a good setting.
   - **Snapshots.** Scheduled snapshots are kept 35 days unless you set a shorter time, and manual snapshots never expire unless given a date. If you use either, set them to 30 days or less, or change the Privacy page to match.

   Bought through the Vercel Marketplace, Neon is still your own contract with Neon (now part of Databricks), not a service of Vercel's.

3. **Add a Blob store.** In **Storage**, create a **Blob** store and set its access to **Private**, then connect it to the project. Vercel adds `BLOB_STORE_ID`, and the app signs in to the store with the deployment's own short-lived token, so there is no secret to copy. Private matters: selfies and voice recordings live there, and nothing in a private store can be fetched except through the app, which checks who is asking.

4. **Set the environment variables** (Project → Settings → Environment Variables):

   | Variable | Needed for |
   | --- | --- |
   | `FAL_KEY` | Character images, the 3D build, speech-to-text |
   | `ANTHROPIC_API_KEY` | The avatar's conversation |
   | `ELEVENLABS_API_KEY` | The avatars' voices and speech. Set it on a live site: the Privacy page names ElevenLabs as the speech provider, and without the key speech falls back to MiniMax on fal |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Sign-in emails, "your avatar is ready" and reports. Without them nobody can sign in on a deployed site |
   | `CRON_SECRET` | A long random string. Vercel sends it with the daily call that deletes unused accounts; without it that job refuses to run |
   | `ADMIN_EMAILS` | Your own address: lets that account open `/admin` (reports, takedowns, numbers, errors) and receive reports |
   | `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_LEGAL_JURISDICTION` | Who runs the site, how to reach them and whose law applies, shown on the Terms and Privacy pages. These are read when the site is built, so redeploy after changing them |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Plans and payments. Without the secret key nobody can pay, so the deployed site builds no 3D avatars (except for `COMP_EMAILS` accounts) |
   | `COMP_EMAILS` | Your own address, to test a deployment end to end before payments are set up |
   | `NEXT_PUBLIC_APP_URL` | Only if the site's address isn't the project's production domain (see below) |

   The rest of `.env.example` is optional.

5. **Deploy**, then:
   - Point a Stripe webhook at `https://<your domain>/api/billing/webhook` (events: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`).
   - Verify the `EMAIL_FROM` domain in Resend.
   - Sign in with the `ADMIN_EMAILS` address and open `/admin`. Report a test avatar from its page and check the report arrives there and by email.
   - Read `/terms` and `/privacy` on the live site: the company name, contact address and governing law should be filled in.
   - Publish a test avatar, load its page, delete it from the account page, and check its model address (`/api/files/<id>/model-....glb`, from the browser's network tab) now answers 404 rather than a cached copy.
   - Make one avatar from start to finish. The 3D build is the part most worth watching: it should move through sculpting, rigging and finishing on its own, including with the creator tab closed.

Vercel's Hobby plan is for non-commercial use only, so a site that takes payments needs the Pro plan.

## Other companies' copies: settings to make before launch

The Privacy page says what each provider keeps. Some of that is done by the code, some depends on settings in the providers' dashboards, and some is still open. Facts below were read from the providers' own pages on 2026-11-19; check them again before launch.

**Done by the code**

- **fal.** Every file sent to fal and every result it makes is given a 24-hour expiry (one hour for voice messages), requests that are collected at once are sent with `X-Fal-Store-IO: 0` so fal keeps no record of them, and deleting an avatar deletes fal's copies immediately (`src/lib/server/fal.ts`, `falLinks.ts`). The two 3D steps keep fal's default request record (90 days), because their results are collected minutes later; it holds links and settings, no pictures. As a backstop, also set the account's default expiry: fal dashboard, or `PUT https://api.fal.ai/v1/storage/settings` with `{"expiration_duration_seconds": 86400}` ([docs](https://fal.ai/docs/platform-apis/v1/storage/settings/update.md)). Without an expiry fal keeps files indefinitely, at public links.

**For you to set**

- **ElevenLabs: refuse training.** ElevenLabs only ever receives the text an avatar speaks, never a recording. Its terms still let it use content to improve its services unless you opt out: account settings → Terms and Privacy → Data use ([terms](https://elevenlabs.io/terms-of-use)). The opt-out only covers data from then on, so do it before launch, and then the sentence about this on the Privacy page can go.
- **ElevenLabs: speech history.** It keeps the text and audio of everything it speaks (so, what avatars said) until deleted. Zero retention is for enterprise customers only ([docs](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode.md)). The Privacy page says this history "stays until we clear it": clear it regularly in the dashboard, or ask for a job that does.
- **Neon and Vercel plans.** The restore window and snapshots above. Vercel keeps request logs (with network addresses) for an hour on Hobby, a day on Pro, 30 days with Observability Plus; the Privacy page says "about a day".
- **Resend** keeps sent emails for 30 days on every self-serve plan; the Privacy page says so.

**Open questions for a lawyer, or to ask the provider in writing**

- **fal's partner models.** fal's API terms say it will not train on customer content, but exclude third-party models marked "Pending Enterprise Ready", for which its data processing agreement does not apply either ([terms](https://fal.ai/legal/api-services)). Ask fal which of the models in use (GPT Image, Nano Banana, FLUX, Meshy, Wizper) are covered, and what the makers keep.
- **Biometric data clauses.** fal's acceptable use policy lists "biometric data (such as facial recognition data, fingerprints, voiceprints...)" among information its services may not be used to collect or process, and its data processing agreement says the services "are not designed for special categories of personal data" ([policy](https://fal.ai/legal/acceptable-use-policy)). Vercel's says customers are "prohibited from including sensitive data or special categories of data in Customer Data" ([DPA](https://vercel.com/legal/dpa), Schedule 1, 6.1). The app does not record or clone voices, which removes the least settled part of this. What remains is the selfie. In the laws we read, a photograph is not biometric data by itself; measurements taken from it to identify a person are. The app identifies nobody: the creator's browser runs face detection on the selfie to check it is usable and keeps none of those measurements, and the image models then draw from the photo. Whether that keeps the selfie outside these clauses is a question for a lawyer before launch.
- **Anthropic** needs nothing: its commercial terms bar training on customer content and it deletes inputs and outputs within 30 days.

## The scheduled job

`vercel.json` asks Vercel to call `/api/cron/retention` once a day. Vercel sends `CRON_SECRET` as a bearer token, and the route answers 404 to anything else. The job warns and deletes accounts that have gone unused for the period published on the Privacy page (`src/lib/retention.ts`). It is safe to run twice, and it deletes nobody whose warning email was not sent. Vercel runs scheduled calls only on the production deployment, once a day on the Hobby plan. To run it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your domain>/api/cron/retention
```

## The site's address

Sign-in links, share links, Stripe return addresses and fal's callback are built from the site's public address. It is taken from, in order: `NEXT_PUBLIC_APP_URL`; on a production deployment, the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`, which is your custom domain once you add one); on a preview deployment, that deployment's own address. Set `NEXT_PUBLIC_APP_URL` only to override this.

## How the pieces cope with short-lived functions

**The 3D build.** A build takes 4 to 13 minutes; a function may run for 5 (up to 13 on Pro, if raised). So no function waits for it. Sculpting and rigging run in fal's queue, and the avatar's record keeps their request ids. `advanceModelJob` in `src/lib/server/jobs.ts` moves a build on by one step when called: it checks the step in flight, and if that is done, submits the next. It is called by the creator's page (which polls every 4 seconds while a build runs), by the account page, and by fal itself, which calls `/api/fal/webhook` when a step completes, so a build finishes with nobody watching. The last step, merging and compressing the model (under ten seconds in testing), runs after the response of whichever call found it ready. A short lease on the record makes sure a step is never submitted twice, and a merge cut short by a function timeout is started again, up to three times.

fal's callback carries a per-build secret and is only a nudge: the app then asks fal what happened, and never trusts the request body. Preview deployments behind Vercel's deployment protection can't be called by fal; builds there still move on while the creator's page is open.

**Uploads.** Vercel accepts request bodies up to 4.5 MB. The app's own limit is 4 MB everywhere, and the browser makes files fit before sending: photos over 1.5 MB are scaled down (the server keeps a 1024 px selfie anyway).

**Files.** Everything is served through `/api/files/...`. Private files (selfies, portraits, character images) are checked against the owner on every request. Public ones (3D models, thumbnails, backdrops) have unchanging names and are cached by Vercel's CDN for a year, so after the first request for a model the function and the Blob store aren't touched. Each cached file carries a `Vercel-Cache-Tag` naming its avatar, and deleting an avatar or taking it down drops the copies with that tag (`dropCached` in `src/lib/server/avatarFiles.ts`), so a model doesn't outlive its avatar in the cache.

**Rate limits** are token buckets in a Postgres table, one statement per check, so every instance counts against the same bucket. Keys are hashed; no IP addresses are stored.

**Updates to an avatar** lock its row while they read, change and write it, so two instances can't overwrite each other (reply counts, build steps, edits).

**Durations.** Routes that wait for an image model or run a build step declare `maxDuration = 300`, Vercel's default and the Hobby maximum.

## Region

Put the functions in the region of the database (Project → Settings → Functions). Each request makes a handful of queries, and across regions each one costs tens of milliseconds.

## Preview deployments

Previews use whatever database and Blob store are connected to the Preview environment. Connecting the production ones there means previews read and write real data. Some providers (Neon, for one) can give each preview its own database branch; use that, or connect a separate database and store.

## Local development

`npm install && npm run dev` needs no database or storage setup: Postgres is embedded and files go to `data/`. If there is a `data/app.db` from before the move to Postgres, its avatars and accounts are carried over into the new database the first time the app starts.

To develop against the real services instead, link the project and pull its environment:

```bash
npx vercel link
```

```bash
npx vercel env pull .env.local
```

That sets `DATABASE_URL` and the Blob store for `next dev`. The embedded database belongs to one process at a time: don't run two dev servers on the same `data/` folder.

Tests use the embedded database too. To run them against a Postgres server (each test file gets a fresh database on it):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

## Running somewhere else

Nothing depends on Vercel except the Blob store. On any Node host, set `DATABASE_URL`; files go to `DATA_DIR/files` (which then has to be a disk that persists and is shared by all instances) unless `BLOB_READ_WRITE_TOKEN` points at a Vercel Blob store. To use S3 or R2 instead, add a driver beside the two in `src/lib/server/storage.ts`.

## Changing the schema

Add an entry to the end of `MIGRATIONS` in `src/lib/server/schema.ts`. It is applied once, on the first request after deploying, under a lock so that instances starting together don't both run it. Never edit an entry that has shipped.
