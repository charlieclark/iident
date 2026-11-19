import { z } from "zod";
import { HttpError, handle, rateLimit } from "@/lib/server/http";
import { fileReport } from "@/lib/server/moderation";

const bodySchema = z.object({
  slug: z.string().min(1).max(64),
  reason: z.enum(["impersonation", "inappropriate", "other"]),
  details: z.string().trim().max(1000).default(""),
  email: z.union([z.literal(""), z.string().trim().max(254).email()]).default(""),
});

/** Anyone can report a published avatar. The answer is the same whether or not the avatar exists. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "report", 5);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Tell us what's wrong, and check the email address if you gave one.");
  await fileReport(parsed.data);
  return Response.json({ received: true });
});
