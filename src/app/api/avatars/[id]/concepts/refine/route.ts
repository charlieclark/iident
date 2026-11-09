import { randomBytes } from "node:crypto";
import { z } from "zod";
import { buildRefinePrompt } from "@/lib/avatar/options";
import { updateAvatar } from "@/lib/server/db";
import { generateConcepts } from "@/lib/server/fal";
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

  const prompt = buildRefinePrompt(parsed.data.instruction);
  const [url] = await generateConcepts({ imageUrls: [base.url], prompt, count: 1 });
  const cid = randomBytes(6).toString("base64url");
  const file = await putFile(id, `concept-${cid}.png`, await download(url));
  const concept = { id: cid, url, file, prompt, parentId: base.id, createdAt: Date.now() };
  const updated = updateAvatar(id, (r) => {
    r.concepts = [concept, ...r.concepts].slice(0, 24);
  });
  return Response.json({ avatar: ownerView(updated), created: [cid] });
});
