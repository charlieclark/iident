# iident

Turn a selfie and a short voice recording into a **talking 3D avatar** of yourself, give it a persona and the things it should know and show, and share one link that anyone can open to chat with it by voice or text. While it talks, the avatar can put your links, products, videos and images on screen as cards.

The avatar's context (knowledge plus a catalog of items) is generic, so other products can embed it: see [docs/platform.md](docs/platform.md) for the platform design and the plan to replace Liinks' AI Chat with it.

```
selfie ──► character sheet ──► textured 3D mesh ──► rigged GLB + 8 animation clips
          (GPT Image 2.6)        (Meshy 7.1, A-pose)   (Meshy auto-rig, merged + compressed)
                                                              │
voice sample ──► voice clone (Fish Audio, no slot limits)     ▼
persona ───────► system prompt ──► Claude ──► sentence chunks ──► streaming TTS ──► lip-synced avatar
context ───────┘                     └──► show_items(ids) ──► cards on screen
```

## How it works

**1. Photo.** The selfie is checked on-device with MediaPipe Face Landmarker (one clear, front-facing, well-lit face) before it is uploaded.

**2. Look.** Every character shares one house style: a collectible figure of the real person, about five heads tall (`HOUSE_STYLE` in `src/lib/avatar/options.ts`). The creator picks build, height, hair, facial hair, an outfit (presets plus per-piece type and color), accessories and free-text details, and these compile into one prompt that puts likeness first and asks for an A-pose, closed mouth, flat lighting, plain background and empty hands. Those constraints are what make the next steps reliable. Two image models share the work:
- **Sketches** (FLUX.3 klein, under a cent, 2 to 4 seconds): drawn on arrival and again a moment after every change, so trying outfits feels live.
- **The final character** (GPT Image 2.6, about 4 cents, 20 to 30 seconds): drawn once the creator is happy, and can be refined in plain words ("make the sneakers red") with the selfie kept alongside so the face stays true. The 3D model is only built from a final.

The models and style were chosen in a measured bake-off: see [docs/character-pipeline.md](docs/character-pipeline.md).

**3. 3D.** The chosen sheet goes to Meshy image-to-3D in A-pose, then to Meshy's auto-rigger with eight animation presets (idle, wave, two talking gestures, agree, think, listen, shrug). The server merges the rig and all clips into a single GLB, retargeting tracks by bone name, converts textures to WebP and applies lossless meshopt compression (about 1.6 MB in total, down from roughly 45 MB of raw downloads). This runs in the background, typically 3 to 10 minutes depending on queue load, while the creator records their voice and writes the persona.

**4. Making a generated mesh talk.** AI-generated meshes have a closed, painted-on mouth and no facial rig. In the creator's browser the head is rendered head-on in bind pose, MediaPipe finds the lips, eyes and chin on that render, and each landmark is raycast back onto the mesh (`src/lib/avatar/faceRigger.ts`). From those landmarks `src/lib/avatar/faceDriver.ts` builds:
- morph targets for `jaw` (rotation around an estimated jaw hinge), `wide` and `round`;
- a shader patch that paints the stretched region between the lips as a mouth interior with teeth and tongue;
- painted eyelids for blinks.

All of it lives in bind-pose geometry space, so it follows the head through every animation. The landmarks are stored with the avatar, so visitors never load MediaPipe.

**5. Voice and conversation.** The creator reads a short script (or picks one of ElevenLabs' stock voices). The recording is converted to WAV in the browser, kept, and transcribed once. Fish Audio then speaks straight from it: the recording and its transcript go with every speech request (`src/lib/server/fish.ts`), so nothing is stored at Fish and there is no limit on voices. `FISH_VOICE_MODE=model` saves the recording as a private Fish voice model instead, but Fish caps how many the API can create by the account's prepaid credit. Clones made with another service move to Fish on first use, and a saved model that goes missing is rebuilt from the recording (`src/lib/server/voice.ts`). Each visitor message streams to Claude with a persona system prompt (`src/lib/server/persona.ts`). As soon as the first clause of the reply is written it goes to streaming TTS (Fish Audio for cloned voices, ElevenLabs for stock voices), and raw PCM audio is forwarded to the browser over server-sent events as it is generated. The browser schedules each chunk on the audio clock the moment it arrives (`src/lib/avatar/player.ts`), so the avatar starts talking a few hundred milliseconds after the text exists, while Claude is still writing. Later sentences are synthesized in order (ElevenLabs also gets the previous text, for natural intonation). Lip sync is driven from the audio itself (`src/lib/avatar/lipsync.ts`): loudness opens the jaw and the spectral centroid and hiss pick round, wide or closed shapes, so it works with any voice. Visitors can type or tap the mic (speech-to-text via Whisper on fal).

**6. Showing things.** Next to the persona, the creator gives the avatar a context: free-text knowledge (facts, FAQs) and a catalog of items it can show, each a link, product, video or image with a stable id (`src/lib/avatar/context.ts`). The catalog goes into the system prompt and Claude gets one tool, `show_items`, which it calls with up to three ids after its spoken sentence. The server drops unknown ids and streams a `show` event with the cards, which appear under the reply while the avatar is still talking (`src/components/ItemCard.tsx`). YouTube, Vimeo and video files play inline, and the avatar stops talking when they do. The avatar has no other links, so it can't invent one.

**7. Runtime polish** (`src/lib/avatar/player.ts`). Library clips often turn the body away from the camera, so each clip's average hips yaw is measured and removed at load. A head look-at measures the animated head direction every frame and corrects toward the viewer. Clip selection is mood-driven: listening idle, a head-scratch only if a reply takes over 1.2 s, rotating talk gestures while speaking, and a wave on greeting.

## What to expect

Measured while building this, using the default models:

| Step | Time |
| --- | --- |
| Sketch of a look (FLUX.3 klein) | 2 to 4 s (6 to 9 s end to end in the creator, measured before prompt expansion was turned off) |
| Final character (GPT Image 2.6, high quality) | 20 to 30 s |
| 3D mesh + rig + 8 clips (Meshy) | 3 to 13 min, depending on queue load |
| Speech-to-text (Whisper) | about 2.5 s |
| Voice clone (Fish Audio: the recording is stored and transcribed) | a few seconds |
| First audio of a reply (ElevenLabs v4 Turbo, streaming) | about 0.3 s after the text, about 0.65 s from click to sound in the browser |
| First audio in a cloned voice (Fish Audio, recording sent with each request) | about 0.45 s after the text (an ElevenLabs clone of the same recording: about 0.27 s, measured side by side) |
| First audio with the MiniMax fallback (whole clips via fal) | about 4 s |

During the 3D build the creator keeps going (voice, persona) and sees a turntable of the sculpted mesh while it is being rigged.

## Running locally

Requirements: Node 22.13+ (uses the built-in `node:sqlite`).

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
    api/chat/[slug]           SSE conversation: Claude text, streamed speech (PCM), cards to show
    api/voices                stock voices for the active speech provider
    api/stt                   visitor speech-to-text
    api/files/[...key]        stored assets (selfies, voice samples and concepts are owner-only)
  components/
    create/                   creator steps
    AvatarStage.tsx           React wrapper around the three.js player
    AvatarChat.tsx            chat UI with push-to-talk
    ItemCard.tsx              cards for links, products, images and inline videos
  lib/avatar/                 options + prompt builder, context (knowledge + items), player, face rigger/driver, lip sync
  lib/server/                 config, SQLite store, storage, fal wrappers, GLB merge, jobs, persona, speech (ElevenLabs, Fish Audio)
  lib/client/                 API client, recorder + WAV encoder, SSE client, selfie checks
```

## Configuration

All model choices are environment variables (see `.env.example`), so newer fal endpoints can be swapped in without code changes. The conversation model defaults to `claude-opus-5-5` with low effort for fast spoken replies and server-side refusal fallbacks enabled; set `AVATAR_CHAT_MODEL` to change it (for example to `claude-haiku-5-5` for lower latency and cost).

Speech uses ElevenLabs whenever `ELEVENLABS_API_KEY` is set. `ELEVENLABS_MODEL` picks the model (default `eleven_v4_turbo`; `eleven_flash_v2_5` is a slightly faster, lower-fidelity alternative at the same price), and `TTS_PROVIDER=minimax` forces the fal fallback for stock voices. Cloned voices go to `CLONE_PROVIDER` (`fish`, `elevenlabs` or `minimax`; Fish by default when `FISH_API_KEY` is set), with `FISH_MODEL` (default `s2.1-pro`), `FISH_LATENCY` (default `balanced`) and `FISH_VOICE_MODE` (`inline`, the default, or `model`). `VOICE_CLONING=off` switches cloning off.

## Safety and privacy

- Creators must confirm the photo and voice are theirs, or used with permission, before upload or cloning.
- A cloned voice is the easiest part of an avatar to misuse for impersonation, so cloning has an off switch (`VOICE_CLONING=off`): recordings are then refused, clones made earlier are never spoken, and avatars use stock voices. The persona prompt always tells the model whether it speaks with the person's own voice or a stock voice, so it never claims a stock voice is theirs.
- The public page labels the avatar as an AI, and the persona prompt requires it to say so when asked, avoid commitments on the person's behalf, stick to the facts the creator provided and never share private contact, financial or health details.
- Selfies, voice samples and concept images are only served to the owner (edit token); the public page only exposes the 3D model and a thumbnail.
- Editing is protected by a random edit token stored in the creator's browser (only its hash is stored server-side).
- Basic per-IP rate limits protect the expensive endpoints.

## Production notes

- **Long-running work.** The 3D build runs in-process via `after()`. Deploy on a persistent Node server (Fly.io, Render, Railway, a VM). On serverless platforms move the job to a queue or use fal webhooks. Jobs interrupted by a restart are surfaced as failed so the user can retry.
- **Storage and database.** `src/lib/server/storage.ts` (local disk) and `src/lib/server/db.ts` (SQLite) are small, isolated modules; swap them for S3/R2 and Postgres for multi-instance deployments.
- **Accounts.** Drafts are tied to the browser that created them. Add real auth (and an "edit link" email) before launch.
- **Costs.** Each avatar uses sketches at under a cent each, one or two final renders at about 4 cents, one image-to-3D run, one rigging run and one voice clone; each reply uses one Claude call (two in the rare case it shows cards before saying anything) and one TTS call per sentence.
- **Voice cloning at scale.** With `FISH_API_KEY` set, cloned voices are spoken by Fish Audio straight from the creator's recording, which goes with each request, so there is no voice limit and nothing to clean up at Fish. Saved Fish voice models (`FISH_VOICE_MODE=model`) skip re-sending the recording, but Fish caps how many the API can create by prepaid credit (an account with no credit can create none). Fish concurrency also depends on prepaid credit: 5 requests under $100, 15 from $100, 50 from $1,000. Clones made with ElevenLabs instead each take a voice slot for as long as the avatar exists (30 on Creator, 160 on Pro, 660 on Scale, 2,200 on Business, per ElevenLabs' pricing page in November 2026) and count against a monthly quota of new voices (95 on Creator). Stock voices use no slots, and re-recording or switching to a stock voice frees the old clone.

## Known limitations

- Talking is synthesized on a closed-mouth mesh: the mouth interior is painted, so extreme side views look flatter than a hand-rigged face.
- Blinks are painted over the eyes and are disabled when the character wears glasses.
- Hair and loose clothing are part of the single skinned mesh, so they do not simulate physics.
