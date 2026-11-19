import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { appearanceSchema, buildConceptPrompt, buildSketchEditPrompt, STYLE_ID } from "@/lib/avatar/options";
import type { Concept } from "@/lib/avatar/types";
import { sketchBase, withConcept } from "@/lib/server/concepts";
import { avatarOwner, updateAvatar } from "@/lib/server/db";
import { track } from "@/lib/server/insights";
import { generateCharacterImage } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { ensurePortrait } from "@/lib/server/portrait";
import { ensureStarter } from "@/lib/server/starter";
import { download } from "@/lib/server/storage";
import { saveFile } from "@/lib/server/avatarFiles";

/** Drawing takes 15 to 45 seconds, after a wait for the portrait when the selfie is new. */
export const maxDuration = 300;

/**
 * A sketch comes back inside the response, as a small JPEG, so the page can
 * show it at once instead of asking for the stored file in a second request.
 */
async function inlinePicture(image: Buffer): Promise<string | undefined> {
  try {
    const jpeg = await sharp(image).resize({ height: 1024, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return undefined; // the page falls back to the stored file
  }
}

const bodySchema = z.object({
  appearance: appearanceSchema,
  kind: z.enum(["preview", "final"]).default("final"),
});

/**
 * Draws the creator as a full-body character in their chosen look: a quick
 * preview ("preview", about 3 seconds) before committing, or the
 * full-quality render ("final") the 3D model is built from.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/concepts">) => {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid appearance options.");
  const { appearance, kind } = parsed.data;
  // Sketches cost about a cent and redraw as the look changes, so they get a higher per-minute allowance.
  if (kind === "preview") await rateLimit(req, "preview", 40);
  else await rateLimit(req, "generate", 12);
  const record = await requireOwner(req, id);
  if (!record.selfie) throw new HttpError(400, "Upload a selfie first.");

  // A quick preview restyles the picture the main model already drew of this
  // person, which keeps the face. That first picture is started in the
  // background when the selfie is uploaded; a preview asked for before it is
  // done waits for it.
  const base = kind === "preview" ? (sketchBase(record) ?? (await ensureStarter(id))) : null;
  if (kind === "preview" && !base) throw new HttpError(502, "We couldn't draw you just now. Try again in a moment.");
  // Drawn from the selfie's clean portrait and the selfie together; from the selfie alone if the portrait could not be made.
  const portrait = base ? null : await ensurePortrait(id);
  const prompt = base ? buildSketchEditPrompt(appearance) : buildConceptPrompt(appearance, { portrait: !!portrait });
  const url = base
    ? await generateCharacterImage({ engine: "sketch", imageUrls: [base.url], prompt })
    : await generateCharacterImage({
        engine: "main",
        imageUrls: portrait ? [portrait, record.selfie.url] : [record.selfie.url],
        prompt,
      });
  const cid = randomBytes(6).toString("base64url");
  const image = await download(url);
  const file = await saveFile(id, `concept-${cid}.${base ? "jpg" : "png"}`, image);
  const concept: Concept = {
    id: cid,
    url,
    file,
    prompt,
    kind,
    drawnBy: base ? "sketch" : "main",
    style: STYLE_ID,
    selfie: record.selfie.file,
    ...(base ? { parentId: base.id } : {}),
    createdAt: Date.now(),
  };
  const updated = await updateAvatar(id, (r) => {
    r.appearance = appearance;
    // The picture sketches are made from must outlive the sketches made from it.
    r.concepts = withConcept(r.concepts, concept, sketchBase({ concepts: [concept, ...r.concepts], selfie: r.selfie }));
  });
  await track(kind === "preview" ? "previewed" : "character_created", { userId: await avatarOwner(id), avatarId: id });
  return Response.json({ avatar: await ownerView(updated), created: [cid], ...(kind === "preview" ? { inline: await inlinePicture(image) } : {}) });
});
