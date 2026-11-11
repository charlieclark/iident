import { sessionUser } from "@/lib/server/auth";
import { createPortal } from "@/lib/server/billing";
import { HttpError } from "@/lib/server/config";
import { handle, rateLimit } from "@/lib/server/http";

/** A link to Stripe's billing portal for the signed-in account. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "portal", 6);
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in first.");
  return Response.json({ url: await createPortal(user) });
});
