import "server-only";
import { PORTRAIT_PROMPT } from "@/lib/avatar/options";
import type { AvatarRecord } from "@/lib/avatar/types";
import { getAvatar, updateAvatar } from "./db";
import { generatePortrait } from "./fal";
import { download, putFile } from "./storage";

/**
 * The clean portrait a character is drawn from: made once per selfie, in the
 * background as soon as the selfie is uploaded, and awaited by whatever
 * draws first if it isn't ready yet.
 *
 * Requests land on different server instances, so "already being made" is
 * recorded on the selfie itself: the first caller claims it and makes the
 * portrait, the others wait for it to appear.
 */

/** A portrait takes 15 to 45 seconds; a claim older than this was abandoned. */
const CLAIM_MS = 120_000;
const WAIT_STEP_MS = 700;

type Selfie = NonNullable<AvatarRecord["selfie"]>;

/**
 * The URL of the portrait for the avatar's current selfie, making it if
 * needed. Resolves to null when it cannot be made: drawing then falls back
 * to the selfie alone instead of failing.
 */
export async function ensurePortrait(avatarId: string): Promise<string | null> {
  const first = (await getAvatar(avatarId))?.selfie;
  if (!first) return null;
  if (first.portrait) return first.portrait.url;

  const deadline = Date.now() + CLAIM_MS;
  for (let waited = false; ; waited = true) {
    let mine = false;
    const now = Date.now();
    const selfie = (
      await updateAvatar(avatarId, (r) => {
        const s = r.selfie;
        if (!s || s.portrait) return false;
        if (s.portraitClaimedAt && now - s.portraitClaimedAt < CLAIM_MS) return false;
        // Nobody is making it. After waiting, that means the one who was gave up.
        if (waited) return false;
        s.portraitClaimedAt = now;
        mine = true;
      })
    ).selfie;
    if (!selfie) return null;
    if (selfie.portrait) return selfie.portrait.url;
    if (mine) return make(avatarId, selfie);
    if (!selfie.portraitClaimedAt || Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
  }
}

async function make(avatarId: string, selfie: Selfie): Promise<string | null> {
  try {
    const url = await generatePortrait(selfie.url, PORTRAIT_PROMPT);
    const file = await putFile(avatarId, `portrait-${Date.now().toString(36)}.png`, await download(url));
    await updateAvatar(avatarId, (r) => {
      // A newer selfie may have arrived while this one was being redrawn.
      if (r.selfie?.file !== selfie.file) return false;
      r.selfie.portrait = { file, url };
      delete r.selfie.portraitClaimedAt;
    });
    return url;
  } catch (err) {
    console.warn(`[portrait ${avatarId}]`, err);
    // Release the claim, so the next drawing tries again.
    await updateAvatar(avatarId, (r) => {
      if (r.selfie?.file !== selfie.file) return false;
      delete r.selfie.portraitClaimedAt;
    }).catch(() => {});
    return null;
  }
}
