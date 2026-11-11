import { z } from "zod";
import { appearanceSchema } from "@/lib/avatar/options";
import { sessionUser } from "@/lib/server/auth";
import { requireFal } from "@/lib/server/config";
import { HttpError, handle, rateLimit } from "@/lib/server/http";
import { mannequinSketch } from "@/lib/server/mannequin";
import { fileUrl } from "@/lib/server/storage";

const bodySchema = z.object({ appearance: appearanceSchema });

/**
 * The mannequin wearing a look, for trying outfits before the person has a
 * character of their own. Pictures are shared by everyone, so most requests
 * only look one up; a look nobody has tried yet is drawn (about three
 * seconds, under a cent) and comes back inside the response.
 */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "mannequin", 60);
  if (!(await sessionUser(req))) throw new HttpError(401, "Sign in to design your character.");
  requireFal();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid appearance options.");
  const { file, image } = await mannequinSketch(parsed.data.appearance);
  return Response.json({ url: fileUrl(file), ...(image ? { inline: `data:image/jpeg;base64,${image.toString("base64")}` } : {}) });
});
