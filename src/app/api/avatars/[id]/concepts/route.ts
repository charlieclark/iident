import { randomBytes } from "node:crypto";
import { appearanceSchema, buildConceptPrompt } from "@/lib/avatar/options";
import { config } from "@/lib/server/config";
import { updateAvatar } from "@/lib/server/db";
import { generateConcepts } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { download, putFile } from "@/lib/server/storage";

/** Generates full-body character concepts from the selfie and chosen look. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/concepts">) => {
  const { id } = await ctx.params;
  rateLimit(req, "generate", 12);
  const record = requireOwner(req, id);
  if (!record.selfie) throw new HttpError(400, "Upload a selfie first.");
  const parsed = appearanceSchema.safeParse((await req.json())?.appearance);
  if (!parsed.success) throw new HttpError(400, "Invalid appearance options.");
  const appearance = parsed.data;
  const prompt = buildConceptPrompt(appearance);

  const urls = await generateConcepts({
    imageUrls: [record.selfie.url],
    prompt,
    count: Math.min(4, Math.max(1, config.models.conceptVariants)),
  });
  const concepts = await Promise.all(
    urls.map(async (url) => {
      const cid = randomBytes(6).toString("base64url");
      const file = await putFile(id, `concept-${cid}.png`, await download(url));
      return { id: cid, url, file, prompt, createdAt: Date.now() };
    }),
  );
  const updated = updateAvatar(id, (r) => {
    r.appearance = appearance;
    r.concepts = [...concepts, ...r.concepts].slice(0, 24);
  });
  return Response.json({ avatar: ownerView(updated), created: concepts.map((c) => c.id) });
});
