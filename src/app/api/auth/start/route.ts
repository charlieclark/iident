import { z } from "zod";
import { createLoginToken, normalizeEmail } from "@/lib/server/auth";
import { config, HttpError } from "@/lib/server/config";
import { sendSignInEmail } from "@/lib/server/email";
import { handle, rateLimit } from "@/lib/server/http";

const bodySchema = z.object({ email: z.string().trim().max(254).email() });

/** Emails a one-time sign-in link. The answer is the same whether or not an account exists. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "auth-start", 6);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Enter a valid email address.");
  const email = normalizeEmail(parsed.data.email);

  const development = process.env.NODE_ENV !== "production";
  if (!config.email.resendKey && !development) throw new HttpError(503, "Email sign-in isn't set up yet.");

  const token = await createLoginToken(email);
  if (!token) throw new HttpError(429, "Too many sign-in links were requested for this address. Try again in an hour.");
  const link = `${config.appUrl}/auth/verify?token=${token}`;
  const { delivered } = await sendSignInEmail(email, link);
  // With no email service (development only) the page shows the link itself.
  return Response.json({ sent: true, ...(delivered ? {} : { devLink: link }) });
});
