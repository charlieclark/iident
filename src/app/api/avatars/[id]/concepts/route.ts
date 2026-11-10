import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appearanceSchema, buildConceptPrompt } from "@/lib/avatar/options";
import type { Concept } from "@/lib/avatar/types";
import { withConcept } from "@/lib/server/concepts";
import { updateAvatar } from "@/lib/server/db";
import { generateCharacterImage } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { download, putFile } from "@/lib/server/storage";

const bodySchema = z.object({
  appearance: appearanceSchema,
  kind: z.enum(["preview", "final"]).default("final"),
});

/**
 * Draws the creator as a full-body character from their selfie and chosen
 * look: a quick draft ("preview") while they try things, or the
 * high-likeness render ("final") the 3D model is built from.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/concepts">) => {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid appearance options.");
  const { appearance, kind } = parsed.data;
  // Drafts cost under a cent, so they get a much higher allowance.
  if (kind === "preview") rateLimit(req, "preview", 90);
  else rateLimit(req, "generate", 12);
  const record = requireOwner(req, id);
  if (!record.selfie) throw new HttpError(400, "Upload a selfie first.");

  const prompt = buildConceptPrompt(appearance);
  const url = await generateCharacterImage({ kind, imageUrls: [record.selfie.url], prompt });
  const cid = randomBytes(6).toString("base64url");
  const file = await putFile(id, `concept-${cid}.png`, await download(url));
  const concept: Concept = { id: cid, url, file, prompt, kind, createdAt: Date.now() };
  const updated = updateAvatar(id, (r) => {
    r.appearance = appearance;
    r.concepts = withConcept(r.concepts, concept);
  });
  return Response.json({ avatar: ownerView(updated), created: [cid] });
});
