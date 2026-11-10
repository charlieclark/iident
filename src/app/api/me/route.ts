import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, billingView } from "@/lib/server/billing";
import { avatarsOwnedBy } from "@/lib/server/db";
import { handle, summaryView } from "@/lib/server/http";
import { usageOf } from "@/lib/server/usage";

/** The signed-in account, its plan and its avatars, or `user: null` for a visitor. */
export const GET = handle(async (req: Request) => {
  const user = sessionUser(req);
  const enabled = billingEnabled();
  if (!user) return Response.json({ user: null, avatars: [], billing: { enabled } });
  const owned = avatarsOwnedBy(user.id);
  const view = billingView(user);
  return Response.json({
    user: { email: user.email },
    // A draft with no selfie yet is just an opened creator, not something to list.
    avatars: owned.filter((r) => r.selfie).map(summaryView),
    billing: {
      enabled,
      ...view,
      live: { used: owned.filter((r) => r.published).length, limit: PLANS[view.plan].avatars },
      replies: { used: owned.reduce((n, r) => n + usageOf(r).replies, 0), limit: PLANS[view.plan].replies },
    },
  });
});
