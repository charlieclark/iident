import { after } from "next/server";
import sharp from "sharp";
import { updateAvatar } from "@/lib/server/db";
import { uploadToFal } from "@/lib/server/fal";
import { HttpError, MAX_UPLOAD_BYTES, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { ensureStarter } from "@/lib/server/starter";
import { putFile } from "@/lib/server/storage";

/** The portrait and the starter character are drawn after the response, which takes about half a minute. */
export const maxDuration = 300;


/** Stores the selfie (normalized to a 1024px JPEG), mirrors it to fal storage and starts drawing the person. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/selfie">) => {
  const { id } = await ctx.params;
  // Each selfie is redrawn as a clean portrait (about 4 cents), so uploads are limited more tightly than other files.
  await rateLimit(req, "selfie", 6);
  await requireOwner(req, id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an image file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That image is too large (max 4 MB).");
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
  const record = await updateAvatar(id, (r) => {
    r.selfie = { file: key, url };
    r.consent = true;
  });
  // Start drawing the person now (their clean portrait, then a starter character), so that by the
  // time they have picked a look, previewing it on themselves takes seconds.
  after(() => ensureStarter(id));
  return Response.json({ avatar: await ownerView(record) });
});
