import { z } from "zod";
import { consumeLoginToken, startSession } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/config";
import { handle, rateLimit } from "@/lib/server/http";

const bodySchema = z.object({ token: z.string().min(20).max(200) });

/** Trades a sign-in link's token for a session. A POST, so mail scanners that open links don't use it up. */
export const POST = handle(async (req: Request) => {
  rateLimit(req, "auth-verify", 12);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const user = parsed.success ? consumeLoginToken(parsed.data.token) : null;
  if (!user) throw new HttpError(400, "This sign-in link has expired or was already used. Ask for a new one.");
  return Response.json({ user: { email: user.email } }, { headers: { "set-cookie": startSession(user.id) } });
});
