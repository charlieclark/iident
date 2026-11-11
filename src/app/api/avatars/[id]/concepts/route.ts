import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appearanceSchema, buildConceptPrompt, buildSketchEditPrompt, STYLE_ID } from "@/lib/avatar/options";
import type { Concept } from "@/lib/avatar/types";
import { sketchBase, withConcept } from "@/lib/server/concepts";
import { config } from "@/lib/server/config";
import { updateAvatar } from "@/lib/server/db";
import { generateCharacterImage } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { ensurePortrait } from "@/lib/server/portrait";
import { download, putFile } from "@/lib/server/storage";

const bodySchema = z.object({
  appearance: appearanceSchema,
  kind: z.enum(["preview", "final"]).default("final"),
});

/**
 * Draws the creator as a full-body character in their chosen look: a quick
 * sketch ("preview") while they try things, or the full-quality render
 * ("final") the 3D model is built from.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/concepts">) => {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid appearance options.");
  const { appearance, kind } = parsed.data;
  // Sketches cost about a cent and redraw as the look changes, so they get a higher per-minute allowance.
  if (kind === "preview") rateLimit(req, "preview", 20);
  else rateLimit(req, "generate", 12);
  const record = requireOwner(req, id);
  if (!record.selfie) throw new HttpError(400, "Upload a selfie first.");

  // A sketch restyles the picture the main model already drew of this person,
  // which keeps the face. Until there is one, the main model draws the first
  // sketch itself, at a lower quality.
  const base = kind === "preview" ? sketchBase(record) : null;
  // Drawn from the selfie's clean portrait and the selfie together; from the selfie alone if the portrait could not be made.
  const portrait = base ? null : await ensurePortrait(id);
  const prompt = base ? buildSketchEditPrompt(appearance) : buildConceptPrompt(appearance, { portrait: !!portrait });
  const url = base
    ? await generateCharacterImage({ engine: "sketch", imageUrls: [base.url], prompt })
    : await generateCharacterImage({
        engine: "main",
        imageUrls: portrait ? [portrait, record.selfie.url] : [record.selfie.url],
        prompt,
        quality: kind === "preview" ? config.models.firstSketchQuality : undefined,
      });
  const cid = randomBytes(6).toString("base64url");
  const file = await putFile(id, `concept-${cid}.png`, await download(url));
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
  const updated = updateAvatar(id, (r) => {
    r.appearance = appearance;
    // The picture sketches are made from must outlive the sketches made from it.
    r.concepts = withConcept(r.concepts, concept, sketchBase({ concepts: [concept, ...r.concepts], selfie: r.selfie }));
  });
  return Response.json({ avatar: ownerView(updated), created: [cid] });
});
