# Twiins as a platform

Twiins turns a person into a talking avatar that **knows things** and can **show things**. It is meant to be embedded by other products, not only used through its own share pages. Liinks is the first host: its visitor AI Chat gets replaced by a Twiins avatar.

Nothing here is specific to link-in-bio pages. A shop, a portfolio, a course site or a booking page describes its content the same way, and the avatar works the same way on all of them.

Status: the context model, the item catalog and on-screen cards are built (this document's first section). The platform API and the Liinks migration are proposals.

## The model

An avatar has three parts:

| Part | What it is | Where it lives |
| --- | --- | --- |
| Identity | 3D model, face rig, voice | Built by the creator flow (`model`, `faceRig`, `voice` on the record). Cloned voices are spoken by Fish Audio from the stored recording; stock voices come from ElevenLabs |
| Persona | Who it is and how it talks: name, tagline, about, traits, speaking style, topics to avoid, greeting, language | `persona` (`src/lib/avatar/types.ts`) |
| Context | What it knows and what it can show | `context` (`src/lib/avatar/context.ts`) |

**Context** has two parts:

- `knowledge`: free text. Facts, FAQs, policies, hours, anything the avatar may say. Up to 12,000 characters.
- `items`: a catalog of things the avatar can put on screen, each with a stable id chosen by the host. Up to 60.

| Item field | Purpose |
| --- | --- |
| `id` | The host's own id (a block id, a product SKU). 1 to 64 of `A-Z a-z 0-9 _ . : -` |
| `kind` | `link`, `product`, `video` or `image`. Decides the default rendering |
| `title` | Required. Shown on the card and given to the avatar |
| `description` | Optional. Shown on the card and given to the avatar |
| `url` | Where the card leads. For videos, the video itself (YouTube, Vimeo or a video file). Required except for images |
| `image` | Thumbnail, or the picture itself for `image` items (required there) |
| `price`, `cta` | Display price ("€40", "From $25") and button label ("Buy", "Book") |
| `notes` | Only the avatar sees this: when the item is worth bringing up. Never sent to browsers |
| `data` | Up to 20 flat host fields, echoed back with the item (for example the host's block type). Visible to browsers, so never secret |

Validation lives in one zod schema shared by the server and the editor. URLs must be `http(s)`, ids are unique, and blank optional fields are dropped.

Two rules keep this safe and predictable:

1. **The avatar only shows items by id.** It has no other links and is told never to invent one or read a web address aloud. An id that is not in the catalog is dropped on the server.
2. **The host owns its content.** It sends the catalog, and it can render items with its own components. Twiins only needs the generic fields to draw a fallback card.

## How the avatar shows things

The model gets one client tool, `show_items({ ids })` (`src/lib/server/persona.ts`), with a strict schema. The system prompt lists the catalog (id, kind, title, price, host, description, notes) and asks it to say a short spoken sentence first and then call `show_items` once, with up to three ids, only when an item answers the visitor or they ask where to find, watch, hear, buy or book something.

- The tool call ends the model's turn. If the reply already has words, nothing else happens: the cards complete the reply. If the model put cards up without saying anything, one follow-up request returns the tool result and asks it to speak.
- On later turns, cards shown earlier are replayed as `show_items` calls with their results, so the model knows what is already on screen and doesn't repeat itself. Thinking blocks are never replayed across turns, so the history check on newer models doesn't apply.
- Speech is unaffected: text streams to text-to-speech sentence by sentence as before, and tool input never reaches the audio.

The conversation stream (`POST /api/chat/[slug]`, server-sent events) gains one event and one field:

| Event | Payload | Meaning |
| --- | --- | --- |
| `text` | `delta` | Reply text as the model writes it |
| `chunk` | `index`, `text` | A sentence was sent to speech |
| `pcm` / `pcm_end` | `index`, `data` | Streamed speech (ElevenLabs) |
| `audio` | `index`, `url` | A whole clip (MiniMax fallback) |
| **`show`** | `items` (public items: everything except `notes`) | Put these cards on screen now |
| `done` | `text`, **`shown`** (item ids) | Reply finished. The client sends `shown` back with that message in the next turn's history |
| `error` | `message` | |

Timing: `show` is sent as soon as the tool call completes, right after the text it belongs to. Text runs well ahead of speech, so a card appears while the avatar is still talking about it.

Without an Anthropic key the server runs a demo mode that shows the item whose title best matches the visitor's words. It exists so the cards, speech and lip sync can be tested end to end without a key.

## Rendering: Twiins' cards or the host's own

**Default rendering** (`src/components/ItemCard.tsx`, used by the share page and the creator preview):

- `link` and `product`: a row with thumbnail (or an icon), title, description, price and host, and a button (the `cta`, "Buy" for products).
- `image`: the picture with a caption, opening `url` or the image.
- `video`: a poster (YouTube thumbnails are derived automatically) that turns into an inline player: YouTube through `youtube-nocookie.com`, Vimeo, or a plain video file. Playing media stops the avatar's speech. Other video links fall back to a link card.

**Host rendering.** A host that wants items to look native renders them itself from the `show` event, using `id` and `data`. For Liinks that means its existing block cards, in the page's theme (see below). The planned embed exposes this as a `renderItem` callback and an `Twiins:show` DOM event the host can cancel.

**Clicks** (planned): the embed reports card opens to the host and to Twiins, so both can count them.

## Platform API (proposed)

The same engine, exposed to other products. Everything below is a proposal to agree on before building.

**Auth.** Each platform gets a secret key for server-to-server calls. Browsers never see it: the host's server mints short-lived session tokens for visitors.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/avatars` `{ external_id, persona?, context? }` | Create an avatar for one of the host's users. Returns `{ id, creator_url }` |
| `creator_url` | The hosted creator (photo, look, voice, preview) in a popup or iframe. Fires `avatar.ready` when the 3D build finishes |
| `GET` / `PATCH /v1/avatars/{id}` | Status, model URL, thumbnail, voice; update persona |
| `PUT /v1/avatars/{id}/context` | Replace the stored knowledge and items |
| `POST /v1/sessions` `{ avatar_id, context?, visitor? }` | Mint a visitor session token. `context` here overrides the stored one for this session, so a host can send what is visible right now (scheduled blocks, stock levels, the visitor's language) |
| `POST /v1/sessions/{token}/turns` | One conversational turn: the event stream above |

**Webhooks:** `avatar.ready`, `avatar.failed`, `conversation.ended` (turns, items shown, items opened), `item.opened`, and periodic `usage`.

**Embed:** a script that mounts the avatar stage and, optionally, the default chat UI. Hosts that keep their own chat UI use it headless: the SDK plays speech in sync with the avatar and hands every event to the host.

**Assistant mode (no 3D model).** The conversation, context and items work without an avatar: text only, or voice with a stock voice and a profile photo. Hosts can move an existing chatbot onto Twiins first and add the 3D avatar per user later. Liinks needs this so current AI Chat users keep a working chat.

**Metering** per conversation turn, per synthesized character and per 3D build, reported in `usage` webhooks and by API.

## Room to grow

The contract with the model stays the same as the catalog grows: it can only use ids the host gave it.

- **Actions.** Host-defined client tools (`open_form`, `navigate_to_tab`, `book_slot`): the avatar calls one, the embed hands it to the host, the host returns a result. A built-in `collect_contact` action plus a `lead.captured` webhook would cover the "AI front desk" idea in Liinks' backlog.
- **Suggested replies** as tappable chips after a reply.
- **More kinds:** audio (Spotify, SoundCloud), files (a PDF menu or CV), events (date, venue), places (a map).

## Replacing Liinks AI Chat

### What exists today

Liinks' visitor AI Chat is a Pro beta. A badge on the page opens a chat panel that replaces the feed.

- **Settings** (`AdminProfile/pages/AiChat/AiChat.tsx`): `aiChatEnabled`, `aiChatWelcomeMessage` (display only, 100 characters) and `aiChatBusinessDescription` (300 characters, added to the prompt).
- **Server** (`server/controllers/aiChat.ts`, tRPC `assistant.newChat`): one non-streaming OpenAI `gpt-5.5` call per question. The prompt holds the bio or business description, up to 30 searchable blocks that are visible now (title plus description, cut to 100 characters) and social links that have a URL. A `share` tool returns one block id with an explanation, so a reply is either text or a single card, never both.
- **Client** (`LinkFeed/components/AiChat`): renders a shared block with the page's own block renderer (`renderLinks({ aiPreviewLinkId })`), so the card matches the theme. Questions are cut to 50 characters, and only the last 10 messages are used.
- **Limits:** the owner preview is 20 a minute. Visitors get 100 an hour per IP, 20 a minute per IP per page and 100 a minute per page.
- **Gaps:** no streaming, voice or analytics, and nothing is saved. Plan gating was UI-only (audit lead NV-055); the visitor path now checks that chat is offered and the page is public.

### How it maps

| Liinks today | With Twiins |
| --- | --- |
| Bio, `aiChatBusinessDescription` | `context.knowledge` |
| FAQ, Resume, Testimonials, Timeline, Quote, Text blocks | `context.knowledge`, as text |
| Link, Media and Form blocks, social links | `context.items`, with `id` = block id and `data.blockType`. YouTube and Vimeo media become `video` items |
| `share` tool, one card instead of words | `show_items`, up to three cards next to spoken words |
| `renderRecommendation(linkId)` | The `show` event goes into the same renderer (host rendering) |
| `aiChatWelcomeMessage` | `persona.greeting`, also spoken |
| 50-character questions, 10 messages | 1,000 characters, 24 messages |
| `gpt-5.5`, no streaming | Claude, streamed text and speech |

### Steps

1. **Twiins: context and items.** Done in this change.
2. **Twiins: platform API.** Keys, `external_id`, sessions with per-session context, CORS, the embed SDK, webhooks, assistant mode.
3. **Liinks server.** `aiChat.ts` builds the context from the page (reusing `getIsLinkSearchable`, `filterLinksByWeeklySchedule` and the social-link filter it already has) and mints a Twiins session instead of calling OpenAI. Gating stays on the Liinks server: a session is only minted when `getIsAiChatOffered` and `getPublicAccessErrorForUser` allow it, as the chat checks today, and Liinks' rate limits apply at minting.
4. **Liinks client.** The AI Chat panel streams from Twiins through the SDK. When the creator has an avatar, the stage sits above the messages. `show` events render through the existing block renderer, and the panel's built-in text goes through `getTranslations`.
5. **Liinks settings.** "Create your avatar" opens Twiins' hosted creator. `avatar.ready` stores an `TwiinsAvatarId` (a scalar column on `User`). The greeting and business description move into the persona and context. Existing users keep a text assistant until they create an avatar.
6. **Cutover.** Remove the OpenAI path and `assistant.newChat`. Record conversations, cards shown and cards opened in Tinybird `product_events`, and count card opens as link clicks.

### Risks

- **Cost per conversation.** One Claude call per turn plus speech per sentence. It needs per-page monthly caps before it can be part of Pro.
- **Voices.** Cloned voices are spoken by Fish Audio straight from the stored recording, sent with each request, so nothing is stored per voice and voice cloning scales with the number of avatars instead of an ElevenLabs plan (2,200 slots on Business). It adds about 0.2 s before the first word compared with an ElevenLabs clone. Cloning still needs the creator's consent, and it has an off switch (`VOICE_CLONING=off`) that falls back to stock voices.
- **Weight on mobile.** The avatar is about 2 MB plus three.js. Load it only when the visitor opens the chat.
- **Data ownership.** Transcripts would live in Twiins; the host should be able to export and delete them per user.

### Questions to settle

1. Should current AI Chat users move to assistant mode automatically, or opt in?
2. Is the avatar part of Pro, or a paid add-on with its own usage limits?
3. Hosted creator in a popup, or an embedded creator inside the Liinks editor?
4. Does Twiins keep its own share pages (`/a/[slug]`), or become API-only once Liinks is live?
