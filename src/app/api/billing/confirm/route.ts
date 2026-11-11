import { z } from "zod";
import { sessionUser } from "@/lib/server/auth";
import { confirmCheckout } from "@/lib/server/billing";
import { HttpError } from "@/lib/server/config";
import { handle, rateLimit } from "@/lib/server/http";

const bodySchema = z.object({ sessionId: z.string().max(220) });

/** Called on return from checkout: records the plan that was just paid for. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "checkout-confirm", 12);
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to finish setting up your plan.");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "That checkout link isn't valid.");
  return Response.json({ plan: await confirmCheckout(user, parsed.data.sessionId) });
});
