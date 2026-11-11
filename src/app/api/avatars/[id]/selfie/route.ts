import { after } from "next/server";
import sharp from "sharp";
import { updateAvatar } from "@/lib/server/db";
import { uploadToFal } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { ensurePortrait } from "@/lib/server/portrait";
import { putFile } from "@/lib/server/storage";

const MAX_BYTES = 12 * 1024 * 1024;

/** Stores the selfie (normalized to a 1024px JPEG), mirrors it to fal storage and starts its clean portrait. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/selfie">) => {
  const { id } = await ctx.params;
  // Each selfie is redrawn as a clean portrait (about 4 cents), so uploads are limited more tightly than other files.
  rateLimit(req, "selfie", 6);
  requireOwner(req, id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an image file.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "That image is too large (max 12 MB).");
  if (form.get("consent") !== "true") {
    throw new HttpError(400, "Please confirm this is your photo, or that you have permission to use it.");
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "We couldn't read that image. Try a JPG or PNG.");
  }

  const key = await putFile(id, `selfie-${Date.now().toString(36)}.jpg`, jpeg);
  const url = await uploadToFal(jpeg, "image/jpeg", "selfie.jpg");
  const record = updateAvatar(id, (r) => {
    r.selfie = { file: key, url };
    r.consent = true;
  });
  // Start on the clean portrait now, so it is ready by the time a character is drawn.
  after(() => ensurePortrait(id));
  return Response.json({ avatar: ownerView(record) });
});
