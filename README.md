# iident

Turn a selfie and a short voice recording into a **talking 3D avatar** of yourself, give it a persona and the things it should know and show, and share one link that anyone can open to chat with it by voice or text. While it talks, the avatar can put your links, products, videos and images on screen as cards.

The avatar's context (knowledge plus a catalog of items) is generic, so other products can embed it: see [docs/platform.md](docs/platform.md) for the platform design and the plan to replace Liinks' AI Chat with it.

```
selfie ──► character sheet ──► textured 3D mesh ──► rigged GLB + 8 animation clips
          (Nano Banana 2.1)      (Meshy 7.1, A-pose)   (Meshy auto-rig, merged + compressed)
                                                              │
voice sample ──► voice clone (Fish Audio, no slot limits)     ▼
persona ───────► system prompt ──► Claude ──► sentence chunks ──► streaming TTS ──► lip-synced avatar
context ───────┘                     └──► show_items(ids) ──► cards on screen
```

## How it works

**0. An account.** Creating starts with an account: a visitor who clicks "Create your avatar" is asked for their email, opens the link they are sent, and lands in the creator. Everything they make is saved to the account from the first step.

**1. Photo.** The selfie is checked on-device with MediaPipe Face Landmarker (one clear, front-facing, well-lit face) before it is uploaded.

**2. Look.** Every character shares one house style: an animated film character with natural proportions, the face drawn in the same style as the body (`HOUSE_STYLE` in `src/lib/avatar/options.ts`). The creator picks build, height, hair, facial hair, an outfit (presets plus per-piece type and color), accessories and free-text details, and these compile into one prompt that keeps the person recognizable in the style and asks for an A-pose, closed mouth, flat lighting, plain background and empty hands. Those constraints are what make the next steps reliable. Before anything is drawn, the selfie is turned into a clean portrait: the same person straight on, evenly lit, with a relaxed face (GPT Image 2.6 at medium quality, about 11 seconds, started in the background as soon as the selfie is uploaded). Characters are drawn from that portrait and the selfie together, so a photo taken from below, against a window or mid-frown doesn't end up in the character. The portrait is a private reference and is never shown as the character. Two more image models share the drawing:
- **A loadout of items.** The look is a set of slots (hair, face, top, layer, bottom, shoes, extras, body). Each slot's choices are cards showing the item itself: one ready-made picture per option (64 of them in `public/items`, made by `scripts/items/build.mjs`), drawn in white and tinted in the browser in whatever color is chosen. Picking is instant and no image model runs. The slots and the person's picture stay on screen while the cards scroll (pinned under the header on a phone).
- **Preview on me**, on demand: FLUX.3 klein restyles the picture that already exists of the person with the loadout (a few seconds, under a cent), so the face stays the same while the outfit changes. A look previewed before comes back at once.
- **The starter character** is what makes that quick: the first picture of the person (their portrait, then the character, about half a minute) is drawn in the background as soon as the selfie is uploaded (`src/lib/server/starter.ts`), while they are busy picking items, and appears by itself when ready. Asked to draw the person from the selfie itself, the fast model loses them in this style, so every preview is a restyle of this picture.
- **The final character** (Nano Banana 2.1, about 4 cents, 15 to 20 seconds): drawn when the creator presses "Create character", and can be refined in plain words ("make the sneakers red") with the selfie kept alongside so the face stays true. The 3D model is only built from a final.

The models and style were chosen in a measured bake-off: see [docs/character-pipeline.md](docs/character-pipeline.md).

**3. 3D.** The chosen sheet goes to Meshy image-to-3D in A-pose, then to Meshy's auto-rigger with eight animation presets (idle, wave, two talking gestures, agree, think, listen, shrug). The server merges the rig and all clips into a single GLB, retargeting tracks by bone name, converts textures to WebP and applies lossless meshopt compression (about 1.6 MB in total, down from roughly 45 MB of raw downloads). This runs in the background, typically 3 to 10 minutes depending on queue load, while the creator records their voice and writes the persona.

**4. Making a generated mesh talk.** AI-generated meshes have a closed, painted-on mouth and no facial rig. In the creator's browser the head is rendered head-on in bind pose, MediaPipe finds the lips, eyes and chin on that render, and each landmark is raycast back onto the mesh (`src/lib/avatar/faceRigger.ts`). From those landmarks `src/lib/avatar/faceDriver.ts` builds:
- morph targets for `jaw` (rotation around an estimated jaw hinge), `wide` and `round`;
- a shader patch that paints the stretched region between the lips as a mouth interior with teeth and tongue;
- painted eyelids for blinks.

All of it lives in bind-pose geometry space, so it follows the head through every animation. The landmarks are stored with the avatar, so visitors never load MediaPipe.

**5. Voice and conversation.** The creator reads a short script (or picks one of ElevenLabs' stock voices). The recording is converted to WAV in the browser, kept, and transcribed once. Fish Audio then speaks straight from it: the recording and its transcript go with every speech request (`src/lib/server/fish.ts`), so nothing is stored at Fish and there is no limit on voices. `FISH_VOICE_MODE=model` saves the recording as a private Fish voice model instead, but Fish caps how many the API can create by the account's prepaid credit. A clone inherits the tone of its recording, so voice samples are captured without the browser's call-style noise suppression, a dull recording has its highs lifted before cloning (`src/lib/server/brighten.ts`), and Fish speech streams at 44.1 kHz. Clones made with another service move to Fish on first use, and a saved model that goes missing is rebuilt from the recording (`src/lib/server/voice.ts`). Each visitor message streams to Claude with a persona system prompt (`src/lib/server/persona.ts`). As soon as the first clause of the reply is written it goes to streaming TTS (Fish Audio for cloned voices, ElevenLabs for stock voices), and raw PCM audio is forwarded to the browser over server-sent events as it is generated. The browser schedules each chunk on the audio clock the moment it arrives (`src/lib/avatar/player.ts`), so the avatar starts talking a few hundred milliseconds after the text exists, while Claude is still writing. Later sentences are synthesized in order (ElevenLabs also gets the previous text, for natural intonation). Lip sync is driven from the audio itself (`src/lib/avatar/lipsync.ts`): loudness opens the jaw and the spectral centroid and hiss pick round, wide or closed shapes, so it works with any voice. Visitors can type or tap the mic (speech-to-text via Whisper on fal).

**6. Showing things.** Next to the persona, the creator gives the avatar a context: free-text knowledge (facts, FAQs) and a catalog of items it can show, each a link, product, video or image with a stable id (`src/lib/avatar/context.ts`). The catalog goes into the system prompt and Claude gets one tool, `show_items`, which it calls with up to three ids after its spoken sentence. The server drops unknown ids and streams a `show` event with the cards, which appear under the reply while the avatar is still talking (`src/components/ItemCard.tsx`). YouTube, Vimeo and video files play inline, and the avatar stops talking when they do. The avatar has no other links, so it can't invent one.

**7. Background.** The 3D canvas is transparent, so what sits behind the avatar is a CSS layer the creator picks on the share step (`src/lib/avatar/backdrop.ts`): one of nine gradients, a color of their own, an uploaded picture, or a scene generated from a short description (FLUX.3 klein, under a cent, about 4 seconds). Each backdrop has a tone, measured from the color or picture, that switches the page's text and chat between light and dark.

**8. Runtime polish** (`src/lib/avatar/player.ts`). Library clips often turn the body away from the camera, so each clip's average hips yaw is measured and removed at load. A head look-at measures the animated head direction every frame and corrects toward the viewer. Clip selection is mood-driven: listening idle, a head-scratch only if a reply takes over 1.2 s, rotating talk gestures while speaking, and a wave on greeting.

## What to expect

Measured while building this, using the default models:

| Step | Time |
| --- | --- |
| From uploading the photo to picking items | 2.4 s, the upload included |
| Picking an item or a color | instant: tinted in the browser, no image model |
| The first picture of you, drawn in the background | 36 to 45 s after uploading |
| "Preview on me" (FLUX.3 klein) | 3 to 7 s; 13 s once, on a slow spell of the image service |
| "Create character" to the final character (Nano Banana 2.1) | 15 to 39 s |
| Final character (Nano Banana 2.1) | about 15 s |
| 3D mesh + rig + 8 clips (Meshy) | 3 to 13 min, depending on queue load |
| Speech-to-text (Whisper) | about 2.5 s |
| Voice clone (Fish Audio: the recording is stored and transcribed) | a few seconds |
| First audio of a reply (ElevenLabs v4 Turbo, streaming) | about 0.3 s after the text, about 0.65 s from click to sound in the browser |
| First audio in a cloned voice (Fish Audio, recording sent with each request) | about 0.45 s after the text (an ElevenLabs clone of the same recording: about 0.27 s, measured side by side) |
| First audio with the MiniMax fallback (whole clips via fal) | about 4 s |

During the 3D build the creator keeps going (voice, persona) and sees a turntable of the sculpted mesh while it is being rigged.

## Running locally

Requirements: Node 22.13+. No database to install: without `DATABASE_URL`, an embedded Postgres keeps its data in `./data/pg`.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `FAL_KEY` (fal.ai), `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`, then:

```bash
npm run dev
```

Open http://localhost:3000 and click **Create your avatar**.

Without `ANTHROPIC_API_KEY` the avatar still talks, but replies with a setup hint instead of a real answer, or shows the item whose title best matches the visitor's words (handy for testing cards). Add `FISH_API_KEY` to clone voices with Fish Audio; without it, clones are made with ElevenLabs. Without `ELEVENLABS_API_KEY`, stock voices and speech fall back to MiniMax on fal (several seconds per sentence). Without `FAL_KEY`, generation endpoints return a clear 503.

Data (the embedded Postgres and files) is written to `./data`. An older `data/app.db` (SQLite) is carried over into it the first time the app starts. To deploy, see [docs/deploying.md](docs/deploying.md).

### Tests and checks

```bash
npm test
```

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

Tests run on the embedded Postgres. To run them against a Postgres server instead (the driver used in production), set `TEST_DATABASE_URL` to a connection the tests may create databases on.

A developer harness for the avatar runtime is available at `/dev/avatar` in development (expects a merged GLB at `public/dev/sample.glb`).

## Project layout

```
src/
  app/
    page.tsx                  landing page
    create/page.tsx           the five-step creator
    login, auth/verify, me    sign in by email link, and the account's avatars
    pricing, billing/return   plans, and where Stripe Checkout returns to
    a/[slug]/page.tsx         public avatar page (Open Graph tags, real 404s)
    api/auth/..., api/me      sign-in links, sessions, attaching browser drafts to an account
    api/billing/...           checkout, confirm on return, billing portal, Stripe webhook
    api/avatars/...           draft CRUD, selfie, concepts, 3D build, face rig, voice, publish
    api/chat/[slug]           SSE conversation: Claude text, streamed speech (PCM), cards to show
    api/voices                stock voices for the active speech provider
    api/stt                   visitor speech-to-text
    api/files/[...key]        stored assets (selfies, voice samples and concepts are owner-only)
    api/fal/webhook           fal reports a finished 3D step here, so builds carry on unattended
  components/
    create/                   creator steps
    AvatarStage.tsx           React wrapper around the three.js player
    AvatarChat.tsx            chat UI with push-to-talk
    ItemCard.tsx              cards for links, products, images and inline videos
  lib/avatar/                 options + prompt builder, context (knowledge + items), player, face rigger/driver, lip sync
  lib/server/                 config, Postgres (pg, schema, db), storage (Vercel Blob or disk), fal wrappers, GLB merge, the 3D build (jobs), persona, speech (ElevenLabs, Fish Audio)
  lib/client/                 API client, recorder + WAV encoder, SSE client, selfie checks
```

## Configuration

All model choices are environment variables (see `.env.example`), so newer fal endpoints can be swapped in without code changes. The conversation model defaults to `claude-opus-5-5` with low effort for fast spoken replies and server-side refusal fallbacks enabled; set `AVATAR_CHAT_MODEL` to change it (for example to `claude-haiku-5-5` for lower latency and cost).

Speech uses ElevenLabs whenever `ELEVENLABS_API_KEY` is set. `ELEVENLABS_MODEL` picks the model (default `eleven_v4_turbo`; `eleven_flash_v2_5` is a slightly faster, lower-fidelity alternative at the same price), and `TTS_PROVIDER=minimax` forces the fal fallback for stock voices. Cloned voices go to `CLONE_PROVIDER` (`fish`, `elevenlabs` or `minimax`; Fish by default when `FISH_API_KEY` is set), with `FISH_MODEL` (default `s2.1-pro`), `FISH_LATENCY` (default `balanced`), `FISH_SAMPLE_RATE` (default `44100`) and `FISH_VOICE_MODE` (`inline`, the default, or `model`). `VOICE_CLONING=off` switches cloning off.

## Plans and payments

Plans live in `src/lib/billing/plans.ts` (Free, Creator at $10 a month, Pro at $29) and everything about Stripe in `src/lib/server/billing.ts`. Billing is on only when `STRIPE_SECRET_KEY` is set. Without it, publishing isn't paywalled and `MONTHLY_REPLY_LIMIT` applies to every avatar. The 3D build is different: it costs a couple of dollars, so it never starts before payment. A development server with billing off builds for free; a production one (`NODE_ENV=production`) refuses to build until payments are set up, except for accounts in `COMP_EMAILS`.

With billing on:

- Designing a character is free with an account. Building it in 3D and publishing it need a plan; the build button sends people to `/pricing`, through Stripe Checkout, and back to their avatar, where the build they paid for starts by itself.
- A plan sets how many avatars can be live, how many replies each gives visitors a month, and how many 3D builds the account gets a month. Retrying a failed build isn't counted.
- The plan is recorded when the person returns from checkout (the session is read back from Stripe), so it is active at once. The webhook keeps it in step afterwards: renewals, plan changes in the billing portal, failed payments, cancellations.
- When a plan ends, avatars are kept. Their pages stay up and answer with a short "taking a break" line, with no model call or speech, until the account has a plan again.

Setting up Stripe: set `STRIPE_SECRET_KEY`; add a webhook endpoint at `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`; switch on the customer portal in the Stripe dashboard. Creating two recurring prices and setting `STRIPE_PRICE_CREATOR` and `STRIPE_PRICE_PRO` is optional but needed for people to switch plans in the portal; without them checkout charges the listed price directly and the plan chosen at checkout is kept. `COMP_EMAILS` gives accounts Pro without paying. If the Stripe account has Managed Payments on (Stripe sells as merchant of record and handles sales tax), every product needs a tax code: checkout sends `STRIPE_TAX_CODE` (default `txcd_10105001`, a cloud-hosted AI service for personal use) with the product it creates, and prices you create yourself need one set in Stripe.

## Safety and privacy

- Creators must confirm the photo and voice are theirs, or used with permission, before upload or cloning.
- A cloned voice is the easiest part of an avatar to misuse for impersonation, so cloning has an off switch (`VOICE_CLONING=off`): recordings are then refused, clones made earlier are never spoken, and avatars use stock voices. The persona prompt always tells the model whether it speaks with the person's own voice or a stock voice, so it never claims a stock voice is theirs.
- The public page labels the avatar as an AI, and the persona prompt requires it to say so when asked, avoid commitments on the person's behalf, stick to the facts the creator provided and never share private contact, financial or health details.
- Selfies, their clean portraits, voice samples and concept images are only served to the owner; the public page only exposes the 3D model and a thumbnail.
- An avatar belongs to the account that created it, and can be edited by that account and by the browser that made it (a random edit token kept in that browser, also used in its private file links). Accounts sign in with a one-time email link (20 minutes, single use, 5 an hour per address) that starts a 60-day session in an httpOnly, SameSite=Lax cookie. Only hashes of edit tokens, link tokens and session tokens are stored. An avatar that belongs to an account can't be claimed by another one.
- Per-IP rate limits (counted in the database, with the addresses hashed) protect the expensive endpoints, and each avatar has a monthly cap on replies to visitors (`MONTHLY_REPLY_LIMIT`, default 300): past it, the avatar answers in text only until the next month.

## Production notes

- **Hosting.** Built for Vercel: Postgres through `DATABASE_URL`, files in a private Vercel Blob store, and no process that has to stay up. [docs/deploying.md](docs/deploying.md) has the setup steps and how each part copes with short-lived functions.
- **Long-running work.** A 3D build takes 4 to 13 minutes, so nothing waits for it. The two slow steps run in fal's queue and the avatar's record keeps their request ids; the build moves on one step at a time whenever the creator's page polls or fal calls back (`src/lib/server/jobs.ts`). Any server instance can pick it up, and a step is never submitted twice.
- **Storage and database.** `src/lib/server/storage.ts` (Vercel Blob, or local disk in development) and `src/lib/server/db.ts` with `pg.ts` (Postgres) are small, isolated modules. Rate limits live in Postgres too, so they hold across instances.
- **Accounts.** Sign-in emails go through Resend (`RESEND_API_KEY`, `EMAIL_FROM` on a domain verified there). Without a key, development shows the sign-in link on the page and production refuses to sign anyone in. Set `NEXT_PUBLIC_APP_URL` to the public https address: sign-in links are built from it and the session cookie is marked Secure when it is https.
- **Costs.** Each avatar uses a clean portrait of the selfie at up to 4 cents, a starter character at about 4 cents, previews at under a cent each, one or two final renders at about 4 cents, one image-to-3D run, one rigging run and one voice clone; each reply uses one Claude call (two in the rare case it shows cards before saying anything) and one TTS call per sentence.
- **Voice cloning at scale.** With `FISH_API_KEY` set, cloned voices are spoken by Fish Audio straight from the creator's recording, which goes with each request, so there is no voice limit and nothing to clean up at Fish. Saved Fish voice models (`FISH_VOICE_MODE=model`) skip re-sending the recording, but Fish caps how many the API can create by prepaid credit (an account with no credit can create none). Fish concurrency also depends on prepaid credit: 5 requests under $100, 15 from $100, 50 from $1,000. Clones made with ElevenLabs instead each take a voice slot for as long as the avatar exists (30 on Creator, 160 on Pro, 660 on Scale, 2,200 on Business, per ElevenLabs' pricing page in November 2026) and count against a monthly quota of new voices (95 on Creator). Stock voices use no slots, and re-recording or switching to a stock voice frees the old clone.

Costs, pricing options and what a new user still trips over are written up in [docs/go-to-market.md](docs/go-to-market.md).

## Known limitations

- Talking is synthesized on a closed-mouth mesh: the mouth interior is painted, so extreme side views look flatter than a hand-rigged face.
- Blinks are painted over the eyes and are disabled when the character wears glasses.
- Hair and loose clothing are part of the single skinned mesh, so they do not simulate physics.
