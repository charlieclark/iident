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
  thumbnail: z.string().startsWith("data:image/png;base64,").max(4_000_000).optional(),
});

/** Saves the face landmarks computed in the creator's browser (and a thumbnail). */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/face-rig">) => {
  const { id } = await ctx.params;
  const record = await requireOwner(req, id);
  if (record.model?.status !== "ready") throw new HttpError(400, "The 3D character isn't ready yet.");
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid face data.");

  let thumbKey: string | undefined;
  if (parsed.data.thumbnail) {
    const png = Buffer.from(parsed.data.thumbnail.split(",")[1], "base64");
    const avatarLayer = await sharp(png).resize(600, 800, { fit: "cover" }).png().toBuffer();
    // Link previews don't handle transparency well: put the avatar on the
    // same soft gradient the app uses for its stage.
    const backdrop = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#efeaf9"/><stop offset="1" stop-color="#ffe3d3"/>
          </linearGradient>
          <radialGradient id="r" cx="0.5" cy="0.15" r="0.7">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="600" height="800" fill="url(#g)"/><rect width="600" height="800" fill="url(#r)"/>
      </svg>`,
    );
    const webp = await sharp(backdrop)
      .composite([{ input: avatarLayer }])
      .webp({ quality: 86 })
      .toBuffer();
    thumbKey = await putFile(id, `thumb-${Date.now().toString(36)}.webp`, webp);
  }
  const updated = await updateAvatar(id, (r) => {
    r.faceRig = parsed.data.rig;
    if (thumbKey) r.thumbnail = thumbKey;
  });
  return Response.json({ avatar: await ownerView(updated) });
});
