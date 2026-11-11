# Deploying to Vercel

iident runs on Vercel with a Postgres database and a Vercel Blob store. Nothing in it needs a server that stays up: every request is handled by a short-lived function, and anything that takes longer is split into steps kept in the database.

## What runs where

| Part | On Vercel | In local development |
| --- | --- | --- |
| Pages and API | Vercel Functions (Node.js, Fluid compute) | `next dev` |
| Database | Any Postgres, through `DATABASE_URL` | An embedded Postgres (PGlite) in `data/pg`, no setup |
| Files (selfies, character images, 3D models, voice recordings) | A private Vercel Blob store | `data/files` |
| The 3D build | fal's queue, moved on by the creator's page and by fal's callback | The same, moved on by the creator's page |
| Rate limits, sessions, plans | Postgres | The embedded Postgres |

## Setting it up

1. **Import the repository** in Vercel. It is a standard Next.js project: no `vercel.json` and no build settings to change.

2. **Add a Postgres database.** In the project's **Storage** tab choose a Postgres provider from the Marketplace (Neon, Supabase, Prisma Postgres and others) and connect it to the project. That adds the connection string to the project's environment. The app reads `DATABASE_URL`, or `POSTGRES_URL` if that is what the provider sets. Use the pooled connection string when the provider offers both. The tables are created on the first request; there is no migration step to run.

3. **Add a Blob store.** In **Storage**, create a **Blob** store and set its access to **Private**, then connect it to the project. Vercel adds `BLOB_STORE_ID`, and the app signs in to the store with the deployment's own short-lived token, so there is no secret to copy. Private matters: selfies and voice recordings live there, and nothing in a private store can be fetched except through the app, which checks who is asking.

4. **Set the environment variables** (Project → Settings → Environment Variables):

   | Variable | Needed for |
   | --- | --- |
   | `FAL_KEY` | Character images, the 3D build, speech-to-text |
   | `ANTHROPIC_API_KEY` | The avatar's conversation |
   | `ELEVENLABS_API_KEY` | Streaming speech (recommended) |
   | `FISH_API_KEY` | Cloned voices (recommended) |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Sign-in emails. Without them nobody can sign in on a deployed site |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Plans and payments. Without the secret key nothing is paywalled |
   | `NEXT_PUBLIC_APP_URL` | Only if the site's address isn't the project's production domain (see below) |

   The rest of `.env.example` is optional.

5. **Deploy**, then:
   - Point a Stripe webhook at `https://<your domain>/api/billing/webhook` (events: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`).
   - Verify the `EMAIL_FROM` domain in Resend.
   - Make one avatar from start to finish. The 3D build is the part most worth watching: it should move through sculpting, rigging and finishing on its own, including with the creator tab closed.

Vercel's Hobby plan is for non-commercial use only, so a site that takes payments needs the Pro plan.

## The site's address

Sign-in links, share links, Stripe return addresses and fal's callback are built from the site's public address. It is taken from, in order: `NEXT_PUBLIC_APP_URL`; on a production deployment, the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`, which is your custom domain once you add one); on a preview deployment, that deployment's own address. Set `NEXT_PUBLIC_APP_URL` only to override this.

## How the pieces cope with short-lived functions

**The 3D build.** A build takes 4 to 13 minutes; a function may run for 5 (up to 13 on Pro, if raised). So no function waits for it. Sculpting and rigging run in fal's queue, and the avatar's record keeps their request ids. `advanceModelJob` in `src/lib/server/jobs.ts` moves a build on by one step when called: it checks the step in flight, and if that is done, submits the next. It is called by the creator's page (which polls every 4 seconds while a build runs), by the account page, and by fal itself, which calls `/api/fal/webhook` when a step completes, so a build finishes with nobody watching. The last step, merging and compressing the model (under ten seconds in testing), runs after the response of whichever call found it ready. A short lease on the record makes sure a step is never submitted twice, and a merge cut short by a function timeout is started again, up to three times.

fal's callback carries a per-build secret and is only a nudge: the app then asks fal what happened, and never trusts the request body. Preview deployments behind Vercel's deployment protection can't be called by fal; builds there still move on while the creator's page is open.

**Uploads.** Vercel accepts request bodies up to 4.5 MB. The app's own limit is 4 MB everywhere, and the browser makes files fit before sending: photos over 1.5 MB are scaled down (the server keeps a 1024 px selfie anyway), and a voice sample is cut at 75 seconds (cloning needs 15 to 30).

**Files.** Everything is served through `/api/files/...`. Private files (selfies, portraits, voice samples, character images) are checked against the owner on every request. Public ones (3D models, thumbnails, backdrops) have unchanging names and are cached by Vercel's CDN for a year, so after the first request for a model the function and the Blob store aren't touched.

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
