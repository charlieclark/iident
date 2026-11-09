# iident

Turn a selfie and a short voice recording into a **talking 3D avatar** of yourself, give it a persona, and share one link that anyone can open to chat with it by voice or text.

```
selfie ──► character sheet ──► textured 3D mesh ──► rigged GLB + 8 animation clips
            (Nano Banana)        (Meshy 7.1, A-pose)   (Meshy auto-rig, merged + compressed)
                                                              │
voice sample ──► voice clone (MiniMax)                        ▼
persona ───────► system prompt ──► Claude ──► sentence chunks ──► TTS ──► lip-synced avatar
```

## How it works

**1. Photo.** The selfie is checked on-device with MediaPipe Face Landmarker (one clear, front-facing, well-lit face) before it is uploaded.

**2. Look.** The creator picks a style (Animated, Realistic, Collectible, Anime, Clay), build, height, hair, facial hair, an outfit (presets plus per-piece type and color), accessories and free-text details. These compile into one prompt (`src/lib/avatar/options.ts`) that asks an image model to redraw the person as a full-body character sheet: A-pose, closed mouth, plain background, empty hands. Those constraints are what make the next steps reliable. Two variants come back in about 10 to 15 seconds and can be refined in plain words ("make the sneakers red").

**3. 3D.** The chosen sheet goes to Meshy image-to-3D in A-pose, then to Meshy's auto-rigger with eight animation presets (idle, wave, two talking gestures, agree, think, listen, shrug). The server merges the rig and all clips into a single GLB, retargeting tracks by bone name, converts textures to WebP and applies lossless meshopt compression (about 1.6 MB in total, down from roughly 45 MB of raw downloads). This runs in the background, typically 3 to 10 minutes depending on queue load, while the creator records their voice and writes the persona.

**4. Making a generated mesh talk.** AI-generated meshes have a closed, painted-on mouth and no facial rig. In the creator's browser the head is rendered head-on in bind pose, MediaPipe finds the lips, eyes and chin on that render, and each landmark is raycast back onto the mesh (`src/lib/avatar/faceRigger.ts`). From those landmarks `src/lib/avatar/faceDriver.ts` builds:
- morph targets for `jaw` (rotation around an estimated jaw hinge), `wide` and `round`;
- a shader patch that paints the stretched region between the lips as a mouth interior with teeth and tongue;
- painted eyelids for blinks.

All of it lives in bind-pose geometry space, so it follows the head through every animation. The landmarks are stored with the avatar, so visitors never load MediaPipe.

**5. Voice and conversation.** The voice sample is converted to WAV in the browser and cloned with MiniMax (or a stock voice is used). Each visitor message streams to Claude with a persona system prompt (`src/lib/server/persona.ts`). As soon as a sentence completes it is sent to TTS, and audio streams back over server-sent events so the avatar starts talking before the reply is finished. Lip sync is driven from the audio itself (`src/lib/avatar/lipsync.ts`): loudness opens the jaw and the spectral centroid and hiss pick round, wide or closed shapes, so it works with any voice. Visitors can type or tap the mic (speech-to-text via Whisper on fal).

**6. Runtime polish** (`src/lib/avatar/player.ts`). Library clips often turn the body away from the camera, so each clip's average hips yaw is measured and removed at load. A head look-at measures the animated head direction every frame and corrects toward the viewer. Clip selection is mood-driven: listening idle, a head-scratch only if a reply takes over 1.2 s, rotating talk gestures while speaking, and a wave on greeting.

## What to expect

Measured while building this, using the default models:

| Step | Time |
| --- | --- |
| Two character sheets (Nano Banana 2) | about 11 s |
| 3D mesh + rig + 8 clips (Meshy) | 3 to 13 min, depending on queue load |
| Voice clone (MiniMax) | about 19 s |
| Speech-to-text (Whisper) | about 2.5 s |
| Speech per sentence (MiniMax Speech 2.8 Turbo) | about 3 to 4 s |

During the 3D build the creator keeps going (voice, persona) and sees a turntable of the sculpted mesh while it is being rigged.

## Running locally

Requirements: Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `FAL_KEY` (fal.ai) and `ANTHROPIC_API_KEY`, then:

```bash
npm run dev
```

Open http://localhost:3000 and click **Create your avatar**.

Without `ANTHROPIC_API_KEY` the avatar still talks, but replies with a setup hint instead of a real answer. Without `FAL_KEY`, generation endpoints return a clear 503.

Data (SQLite database and files) is written to `./data`.

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

A developer harness for the avatar runtime is available at `/dev/avatar` in development (expects a merged GLB at `public/dev/sample.glb`).

## Project layout

```
src/
  app/
    page.tsx                  landing page
    create/page.tsx           the five-step creator
    a/[slug]/page.tsx         public avatar page (Open Graph tags, real 404s)
    api/avatars/...           draft CRUD, selfie, concepts, 3D build, face rig, voice, publish
    api/chat/[slug]           SSE conversation: Claude text + per-sentence TTS audio
    api/stt                   visitor speech-to-text
    api/files/[...key]        stored assets (selfies, voice samples and concepts are owner-only)
  components/
    create/                   creator steps
    AvatarStage.tsx           React wrapper around the three.js player
    AvatarChat.tsx            chat UI with push-to-talk
  lib/avatar/                 options + prompt builder, player, face rigger/driver, lip sync
  lib/server/                 config, SQLite store, storage, fal wrappers, GLB merge, jobs, persona
  lib/client/                 API client, recorder + WAV encoder, SSE client, selfie checks
```

## Configuration

All model choices are environment variables (see `.env.example`), so newer fal endpoints can be swapped in without code changes. The conversation model defaults to `claude-opus-5-5` with low effort for fast spoken replies and server-side refusal fallbacks enabled; set `AVATAR_CHAT_MODEL` to change it (for example to `claude-haiku-5-5` for lower latency and cost).

## Safety and privacy

- Creators must confirm the photo and voice are theirs, or used with permission, before upload or cloning.
- The public page labels the avatar as an AI, and the persona prompt requires it to say so when asked, avoid commitments on the person's behalf, stick to the facts the creator provided and never share private contact, financial or health details.
- Selfies, voice samples and concept images are only served to the owner (edit token); the public page only exposes the 3D model and a thumbnail.
- Editing is protected by a random edit token stored in the creator's browser (only its hash is stored server-side).
- Basic per-IP rate limits protect the expensive endpoints.

## Production notes

- **Long-running work.** The 3D build runs in-process via `after()`. Deploy on a persistent Node server (Fly.io, Render, Railway, a VM). On serverless platforms move the job to a queue or use fal webhooks. Jobs interrupted by a restart are surfaced as failed so the user can retry.
- **Storage and database.** `src/lib/server/storage.ts` (local disk) and `src/lib/server/db.ts` (SQLite) are small, isolated modules; swap them for S3/R2 and Postgres for multi-instance deployments.
- **Accounts.** Drafts are tied to the browser that created them. Add real auth (and an "edit link" email) before launch.
- **Costs.** Each avatar uses two image generations per round, one image-to-3D run, one rigging run and one voice clone; each reply uses one Claude call and one TTS call per sentence.

## Known limitations

- Talking is synthesized on a closed-mouth mesh: the mouth interior is painted, so extreme side views look flatter than a hand-rigged face.
- Blinks are painted over the eyes and are disabled when the character wears glasses.
- Hair and loose clothing are part of the single skinned mesh, so they do not simulate physics.
