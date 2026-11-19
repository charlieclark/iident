import { sessionUser } from "@/lib/server/auth";
import { suspendedAvatars } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { buildCounts, funnel, recentErrors } from "@/lib/server/insights";
import { openReports, requireAdmin } from "@/lib/server/moderation";

/** Everything the site's owners look at: who gets how far, builds, errors, reports and what was taken down. */
export const GET = handle(async (req: Request) => {
  requireAdmin(await sessionUser(req));
  const [steps, builds, errors, reports, down] = await Promise.all([funnel(), buildCounts(), recentErrors(), openReports(), suspendedAvatars()]);
  return Response.json({
    steps,
    builds,
    errors,
    reports,
    takenDown: down.map((r) => ({ id: r.id, name: r.persona.name, slug: r.slug, at: r.suspended!.at, reason: r.suspended!.reason })),
  });
});
