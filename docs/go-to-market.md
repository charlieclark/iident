# Getting iident to something sellable

Where the product stands (November 2026), what it costs to run, how to charge for it, and what a new user still trips over. Figures marked "estimate" were not measured.

## What it costs

**Creating an avatar (one time): about $2.65**

| Step | Cost | Source |
| --- | --- | --- |
| Clean portrait of the selfie | $0.04 | $0.041, fal price; once per selfie uploaded |
| Sketches while trying looks (about 10) | $0.11 | first one $0.042, then $0.008 each, fal prices |
| Final character (1 or 2 renders) | $0.04 to $0.08 | $0.042 each, fal price |
| 3D mesh with textures | $1.20 | fal price for Meshy 7.1 |
| Rig plus 8 animation clips | about $1.16 | Meshy's listed add-ons ($0.20 rig, $0.12 a clip); the rigging endpoint doesn't publish its own price |
| Voice clone | under $0.01 | one transcription; Fish stores nothing |

Every rebuild in 3D costs the $2.36 again. Sketches and finals are cheap enough to give away.

**Each reply to a visitor: 1 to 2 cents**

| Part | Cost per reply | Notes |
| --- | --- | --- |
| Claude Opus 5.5, low effort | about $0.006 to $0.01 | Estimate: cached persona prompt, short history, about 60 spoken words. Not measured, no key in the build environment |
| Speech, cloned voice (Fish) | about $0.004 | $15 per million bytes, about 250 characters |
| Speech, stock voice (ElevenLabs v4 Turbo) | about $0.01 | $0.04 per 1,000 characters at overage rates |

So an avatar at the default cap of 300 replies a month costs $3 to $6 that month at most. Most avatars will use far less.

**Levers if margins matter**

- Chat model: Claude Haiku 5.5 would cut the model part of a reply to a fraction of a cent, leaving speech as the main cost. Quality for short persona chat is probably fine, but it should be tested with real conversations first. `AVATAR_CHAT_MODEL` switches it.
- Stock voices on Fish instead of ElevenLabs would cut their speech cost by more than half.
- Fewer animation clips: each costs $0.12 per build.

## What is in place for charging

- **Metering** (`src/lib/server/usage.ts`): replies to visitors are counted per avatar per calendar month, with a running total. Owner previews and greetings are free.
- **A cap** (`MONTHLY_REPLY_LIMIT`, default 300, 0 for none): past it the avatar answers in text only, with no model call or speech, until the next month. The owner sees the count on the share step.
- **Voice cloning switch** (`VOICE_CLONING=off`).

- **Accounts** (`src/lib/server/auth.ts`): sign-in by email link, avatars owned by an account and listed at `/me`, browser drafts attached on sign-in.
- **Plans and payments** (`src/lib/billing/plans.ts`, `src/lib/server/billing.ts`): Free, Creator and Pro; Stripe Checkout, billing portal and webhook; the paywall at the 3D build and at publishing; replies, live avatars and builds limited by plan. Off until `STRIPE_SECRET_KEY` is set.

Not in place: annual plans, extra replies as an add-on, a trial, refunds or proration rules beyond Stripe's defaults.

## How to sell it

**Recommended first: inside Liinks.** Liinks already has accounts, billing, and about 5,300 paying profiles who are the exact audience. iident replaces Liinks' AI Chat (plan in `docs/platform.md`) and becomes a reason to choose or stay on Pro, or a paid add-on. Nothing about accounts or payments has to be built twice. What iident needs for that is the platform API: keys, visitor sessions carrying the page's content, the embed, and usage reporting per avatar (the metering above is the start of that).

A cost-based way to set the Liinks offer:

- Include one avatar build with the plan. $2.65 is small next to a subscription, but limit rebuilds (for example two a month), since each costs $2.36.
- Include a monthly allowance of replies (300 costs at most $3 to $6) and sell more as an add-on, or let the avatar fall back to text when it runs out, as it does now.

**Later, or in parallel: iident on its own.** A consumer product needs sign-in and Stripe. A shape that fits the costs:

| | Free | Creator (about $10 a month) | Pro (about $29 a month) |
| --- | --- | --- | --- |
| Design your character (sketches, final image) | Yes | Yes | Yes |
| 3D avatar with your voice, public link | No | 1 avatar | 3 avatars |
| Replies a month | none | 300 | 2,000 |
| Cards, embed on your own site | No | Cards | Cards and embed |

The free tier costs about 20 to 25 cents per person and gives them something to share (their character). The paywall sits exactly where the cost is: bringing it to life in 3D.

These prices are a starting point from costs, not from testing what people will pay. This table is what is built (`src/lib/billing/plans.ts`), with 2 builds in 3D a month on Creator and 5 on Pro; embedding on your own site is not built yet and is not advertised.

**Worst case per account per month** (every build and every reply used, replies at 1 to 2 cents):

| | Revenue after Stripe fees | Builds | Replies | Worst-case margin |
| --- | --- | --- | --- | --- |
| Creator | about $9.40 | 2 × $2.36 = $4.72 | 300 = $3 to $6 | about $0 to minus $1.30 |
| Pro | about $27.90 | 5 × $2.36 = $11.80 | 2,000 = $20 to $40 | about minus $4 to minus $24 |

A plan's replies are shared by the account's avatars. Typical use will be far below the caps (one build, a few dozen replies), but a Pro account that uses everything costs more than it pays. Two fixes, either is enough: a cheaper chat model (Haiku would bring a reply to roughly half a cent to one cent, so 2,000 replies cost $10 to $20), or a lower allowance (1,200). Decide this before promoting Pro.

## A new user's first ten minutes

What works now:

1. Selfie, checked on the device before upload.
2. A sketch of them appears within seconds of reaching the look step and redraws as they change outfits.
3. A final character that looks like them in about 25 seconds.
4. While the 3D build runs (about 6 minutes), they record a voice and write the persona.

What still gets in the way, in order of impact:

1. ~~No accounts.~~ Done: sign in by email link; a reminder to save appears once there is a final character. Not yet required at any step.
2. **The persona step is a long form.** Two fixes: draft it from two or three short answers, and, inside Liinks, fill it from the page (name, bio, links become the avatar's knowledge and cards with no typing).
3. **Nothing to show for the free part.** Let people download or share their final character image before paying. It is the cheapest marketing available.
4. **The 6-minute build has no notification.** If they close the tab they don't know it finished. Needs accounts (email) or a browser notification.
5. **Not tested with real people.** Everything so far used synthetic faces and one real voice. Five real users going through the flow would find more than any further tuning.

## Suggested order

1. Merge the open work (crisper voice, house style and sketches, metering).
2. Try the creator yourself with your own selfie and voice; check the likeness and the 3D result on your phone.
3. ~~Decide: Liinks first, or standalone first.~~ Decided: standalone first. Accounts and Stripe billing are built.
4. Connect a Stripe account (test mode first) and an email service, deploy, and run one real purchase.
5. Decide Pro's reply allowance or the chat model (see the margin table above).
6. Put five real people through it.
