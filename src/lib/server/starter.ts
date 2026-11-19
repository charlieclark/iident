import "server-only";
import { randomBytes } from "node:crypto";
import { buildConceptPrompt, STYLE_ID } from "@/lib/avatar/options";
import type { AvatarRecord, Concept } from "@/lib/avatar/types";
import { sketchBase, withConcept } from "./concepts";
import { getAvatar, updateAvatar } from "./db";
import { generateCharacterImage } from "./fal";
import { ensurePortrait } from "./portrait";
import { download, putFile } from "./storage";

/**
 * The starter character: the first picture of a person, in the look they
 * start with.
 *
 * Previewing a look on yourself is a quick restyle of a picture that already
 * exists (about 3 seconds). Drawing that first picture takes half a minute
 * (the clean portrait, then the character), so it is started in the
 * background the moment the selfie is uploaded, while the person is busy
 * picking items. It is also the first thing they see of themselves.
 *
 * Requests land on different server instances, so "already being drawn" is
 * recorded on the selfie: the first caller claims it, the others wait.
 */

/** Portrait plus drawing takes about 30 seconds; a claim older than this was abandoned. */
const CLAIM_MS = 150_000;
const WAIT_STEP_MS = 700;

type Selfie = NonNullable<AvatarRecord["selfie"]>;

/**
 * The picture previews are made from, drawing it if needed. Resolves to null
 * when it cannot be drawn; the next call tries again.
 */
export async function ensureStarter(avatarId: string): Promise<Concept | null> {
  const first = await getAvatar(avatarId);
  if (!first?.selfie) return null;
  const have = sketchBase(first);
  if (have) return have;

  const deadline = Date.now() + CLAIM_MS;
  for (let waited = false; ; waited = true) {
    let mine = false;
    const now = Date.now();
    const record = await updateAvatar(avatarId, (r) => {
      const s = r.selfie;
      if (!s || sketchBase(r)) return false;
      if (s.starterClaimedAt && now - s.starterClaimedAt < CLAIM_MS) return false;
      // Nobody is drawing it. After waiting, that means the one who was gave up.
      if (waited) return false;
      s.starterClaimedAt = now;
      mine = true;
    });
    const base = sketchBase(record);
    if (base) return base;
    if (!record.selfie) return null;
    if (mine) return draw(avatarId, record, record.selfie);
    if (!record.selfie.starterClaimedAt || Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
  }
}

async function draw(avatarId: string, record: AvatarRecord, selfie: Selfie): Promise<Concept | null> {
  try {
    // Drawn from the selfie's clean portrait and the selfie together; from the selfie alone if the portrait could not be made.
    const portrait = await ensurePortrait(avatarId);
    const prompt = buildConceptPrompt(record.appearance, { portrait: !!portrait });
    const url = await generateCharacterImage({ engine: "main", imageUrls: portrait ? [portrait, selfie.url] : [selfie.url], prompt });
    const id = randomBytes(6).toString("base64url");
    const file = await putFile(avatarId, `concept-${id}.png`, await download(url));
    const concept: Concept = { id, url, file, prompt, kind: "preview", drawnBy: "main", style: STYLE_ID, selfie: selfie.file, createdAt: Date.now() };
    let kept = false;
    await updateAvatar(avatarId, (r) => {
      // A newer selfie may have arrived while this one was being drawn.
      if (r.selfie?.file !== selfie.file) return false;
      delete r.selfie.starterClaimedAt;
      r.concepts = withConcept(r.concepts, concept, concept);
      kept = true;
    });
    return kept ? concept : null;
  } catch (err) {
    console.warn(`[starter ${avatarId}]`, err);
    // Release the claim, so the next preview tries again.
    await updateAvatar(avatarId, (r) => {
      if (r.selfie?.file !== selfie.file) return false;
      delete r.selfie.starterClaimedAt;
    }).catch(() => {});
    return null;
  }
}
