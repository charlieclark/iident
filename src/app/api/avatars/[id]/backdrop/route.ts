import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { buildBackdropPrompt, toneFor, type Backdrop } from "@/lib/avatar/backdrop";
import { requireFal } from "@/lib/server/config";
import { updateAvatar } from "@/lib/server/db";
import { generateBackdrop } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { download, putFile } from "@/lib/server/storage";

const MAX_BYTES = 12 * 1024 * 1024;
const promptSchema = z.object({ prompt: z.string().trim().min(3).max(200) });

/** Normalizes an image to a WebP of at most 1600 px and measures how bright it is. */
async function prepare(input: Buffer | Uint8Array) {
  const image = sharp(input).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true });
  const [webp, stats] = await Promise.all([image.clone().webp({ quality: 82 }).toBuffer(), image.clone().removeAlpha().stats()]);
  const [r, g, b] = stats.channels.map((c) => c.mean / 255);
  // Mean brightness is enough to choose between light and dark text.
  return { webp, tone: toneFor(0.2126 * r ** 2.2 + 0.7152 * g ** 2.2 + 0.0722 * b ** 2.2) };
}

/**
 * Sets an image as the avatar's backdrop: an uploaded picture (multipart
 * `file`) or a scene generated from a short description (JSON `prompt`).
 * Gradients and colors are set with PATCH /api/avatars/[id].
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/backdrop">) => {
  const { id } = await ctx.params;
  requireOwner(req, id);
  let source: Buffer | Uint8Array;
  let prompt: string | undefined;

  if (req.headers.get("content-type")?.includes("application/json")) {
    rateLimit(req, "generate", 12);
    requireFal();
    const parsed = promptSchema.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Describe the scene in a few words.");
    prompt = parsed.data.prompt;
    source = await download(await generateBackdrop(buildBackdropPrompt(prompt)));
  } else {
    rateLimit(req, "upload", 20);
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach an image file.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "That image is too large (max 12 MB).");
    source = Buffer.from(await file.arrayBuffer());
  }

  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare(source);
  } catch {
    throw new HttpError(400, "We couldn't read that image. Try a JPG, PNG or WebP.");
  }
  const file = await putFile(id, `backdrop-${randomBytes(5).toString("hex")}.webp`, prepared.webp);
  const backdrop: Backdrop = { kind: "image", file, tone: prepared.tone, ...(prompt ? { prompt } : {}) };
  const record = updateAvatar(id, (r) => {
    r.backdrop = backdrop;
  });
  return Response.json({ avatar: ownerView(record) });
});
