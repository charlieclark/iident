import { z } from "zod";
import { sessionUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/config";
import { claimAvatar, verifyEditToken } from "@/lib/server/db";
import { handle, rateLimit } from "@/lib/server/http";

const bodySchema = z.object({
  drafts: z.array(z.object({ id: z.string().max(40), token: z.string().max(200) })).max(20),
});

/**
 * Attaches avatars made in this browser to the signed-in account. Each needs
 * its edit token, and an avatar that already belongs to an account stays there.
 */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "claim", 10);
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in first.");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid request.");
  const claimed: string[] = [];
  for (const d of parsed.data.drafts) {
    if ((await verifyEditToken(d.id, d.token)) && (await claimAvatar(d.id, user.id))) claimed.push(d.id);
  }
  return Response.json({ claimed });
});
