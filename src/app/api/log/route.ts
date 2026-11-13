import { z } from "zod";
import { handle, rateLimit } from "@/lib/server/http";
import { logError } from "@/lib/server/insights";

const bodySchema = z.object({
  message: z.string().min(1).max(500),
  detail: z.string().max(4000).optional(),
  page: z.string().max(200).optional(),
});

/** An error from someone's browser (see ErrorReporter). Kept so it can be looked at; nothing else is collected. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "log", 10);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (parsed.success) await logError("browser", parsed.data.message, { route: parsed.data.page, detail: parsed.data.detail });
  return Response.json({ ok: true });
});
