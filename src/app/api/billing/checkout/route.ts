import { z } from "zod";
import { sessionUser } from "@/lib/server/auth";
import { createCheckout } from "@/lib/server/billing";
import { HttpError } from "@/lib/server/config";
import { handle, rateLimit } from "@/lib/server/http";

const bodySchema = z.object({ plan: z.enum(["creator", "pro"]) });

/** Starts Stripe Checkout for a plan and returns the URL to send the person to. */
export const POST = handle(async (req: Request) => {
  rateLimit(req, "checkout", 6);
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to choose a plan.");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Choose a plan.");
  return Response.json({ url: await createCheckout(user, parsed.data.plan) });
});
