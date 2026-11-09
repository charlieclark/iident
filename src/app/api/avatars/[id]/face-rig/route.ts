import sharp from "sharp";
import { z } from "zod";
import { updateAvatar } from "@/lib/server/db";
import { HttpError, handle, ownerView, requireOwner } from "@/lib/server/http";
import { putFile } from "@/lib/server/storage";

const vec = z.tuple([z.number(), z.number(), z.number()]);
const eye = z.object({
  center: vec,
  inner: vec,
  outer: vec,
  upper: z.array(vec).min(3).max(16),
  lower: z.array(vec).min(3).max(16),
});
const rigSchema = z.object({
  version: z.literal(1),
  detected: z.boolean(),
  meshName: z.string().max(200),
  right: vec,
  up: vec,
  forward: vec,
  mouth: z.object({
    center: vec,
    left: vec,
    right: vec,
    upperInner: z.array(vec).min(3).max(32),
    lowerInner: z.array(vec).min(3).max(32),
    upperOuter: z.array(vec).min(3).max(32),
    lowerOuter: z.array(vec).min(3).max(32),
  }),
  chin: vec,
  noseTip: vec,
  eyes: z.object({ left: eye, right: eye }),
  skinColor: vec,
  lipColor: vec,
});

const bodySchema = z.object({
  rig: rigSchema,
  /** PNG data URL of the finished avatar, used for link previews. */
  thumbnail: z.string().startsWith("data:image/png;base64,").max(6_000_000).optional(),
});

/** Saves the face landmarks computed in the creator's browser (and a thumbnail). */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/face-rig">) => {
  const { id } = await ctx.params;
  const record = requireOwner(req, id);
  if (record.model?.status !== "ready") throw new HttpError(400, "The 3D character isn't ready yet.");
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid face data.");

  let thumbKey: string | undefined;
  if (parsed.data.thumbnail) {
    const png = Buffer.from(parsed.data.thumbnail.split(",")[1], "base64");
    const webp = await sharp(png).resize(600, 800, { fit: "cover" }).webp({ quality: 86 }).toBuffer();
    thumbKey = await putFile(id, `thumb-${Date.now().toString(36)}.webp`, webp);
  }
  const updated = updateAvatar(id, (r) => {
    r.faceRig = parsed.data.rig;
    if (thumbKey) r.thumbnail = thumbKey;
  });
  return Response.json({ avatar: ownerView(updated) });
});
