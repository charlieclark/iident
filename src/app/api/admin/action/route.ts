import { z } from "zod";
import { sessionUser } from "@/lib/server/auth";
import { HttpError, handle } from "@/lib/server/http";
import { dismissReport, requireAdmin, restore, takeDown } from "@/lib/server/moderation";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take-down"), avatarId: z.string().min(1).max(40), reason: z.string().trim().max(200).default("Reported") }),
  z.object({ action: z.literal("restore"), avatarId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("dismiss"), reportId: z.string().min(1).max(40) }),
]);

/** What the site's owners can do about a report: take the avatar down, put it back, or dismiss the report. */
export const POST = handle(async (req: Request) => {
  requireAdmin(await sessionUser(req));
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Unknown action.");
  const body = parsed.data;
  if (body.action === "take-down") await takeDown(body.avatarId, body.reason);
  else if (body.action === "restore") await restore(body.avatarId);
  else await dismissReport(body.reportId);
  return Response.json({ ok: true });
});
