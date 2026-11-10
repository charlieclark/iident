import { randomBytes } from "node:crypto";
import { z } from "zod";
import { buildRefinePrompt } from "@/lib/avatar/options";
import { withConcept } from "@/lib/server/concepts";
import { updateAvatar } from "@/lib/server/db";
import type { Concept } from "@/lib/avatar/types";
import { generateCharacterImage } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { download, putFile } from "@/lib/server/storage";

const bodySchema = z.object({
  conceptId: z.string().min(1).max(32),
  instruction: z.string().min(2).max(240),
});

/** Applies a free-text tweak ("make the jacket red") to an existing concept. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/concepts/refine">) => {
  const { id } = await ctx.params;
  rateLimit(req, "generate", 12);
  const record = requireOwner(req, id);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Describe the change you'd like.");
  const base = record.concepts.find((c) => c.id === parsed.data.conceptId);
  if (!base) throw new HttpError(404, "Concept not found.");

  if (!record.selfie) throw new HttpError(400, "Upload a selfie first.");

  const prompt = buildRefinePrompt(parsed.data.instruction);
  // The result is always a final render, with the selfie alongside to keep the face true.
  const url = await generateCharacterImage({ kind: "final", imageUrls: [base.url, record.selfie.url], prompt });
  const cid = randomBytes(6).toString("base64url");
  const file = await putFile(id, `concept-${cid}.png`, await download(url));
  const concept: Concept = { id: cid, url, file, prompt, kind: "final", parentId: base.id, createdAt: Date.now() };
  const updated = updateAvatar(id, (r) => {
    r.concepts = withConcept(r.concepts, concept);
  });
  return Response.json({ avatar: ownerView(updated), created: [cid] });
});
