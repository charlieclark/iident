import { after } from "next/server";
import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, billingView } from "@/lib/server/billing";
import { config } from "@/lib/server/config";
import { avatarsOwnedBy } from "@/lib/server/db";
import { handle, summaryView } from "@/lib/server/http";
import { advanceModelJob, isBuilding } from "@/lib/server/jobs";
import { accountAllowance, usageOf, type Allowance } from "@/lib/server/usage";

export const maxDuration = 300;

/** The signed-in account, its plan and its avatars, or `user: null` for a visitor. */
export const GET = handle(async (req: Request) => {
  const user = await sessionUser(req);
  const enabled = billingEnabled();
  if (!user) return Response.json({ user: null, avatars: [], billing: { enabled } });
  const [listed, view] = await Promise.all([avatarsOwnedBy(user.id), billingView(user)]);
  // A character being built moves on when someone looks, here as well as in the creator.
  const owned = await Promise.all(
    listed.map(async (r) => {
      if (!isBuilding(r.model)) return r;
      const { record, finish } = await advanceModelJob(r);
      if (finish) after(finish);
      return record;
    }),
  );
  // With billing on, the account's avatars share its plan's replies; otherwise each has the default allowance.
  const shared = enabled ? accountAllowance(view.plan, owned) : null;
  const allowanceOf = (r: (typeof owned)[number]): Allowance => shared ?? { limit: config.limits.monthlyReplies, used: usageOf(r).replies, paused: false };
  return Response.json({
    user: { email: user.email },
    // A draft with no selfie yet is just an opened creator, not something to list.
    avatars: owned.filter((r) => r.selfie).map((r) => summaryView(r, allowanceOf(r))),
    billing: {
      enabled,
      ...view,
      live: { used: owned.filter((r) => r.published).length, limit: PLANS[view.plan].avatars },
      replies: { used: owned.reduce((n, r) => n + usageOf(r).replies, 0), limit: PLANS[view.plan].replies },
    },
  });
});
