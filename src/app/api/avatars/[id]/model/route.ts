import { after } from "next/server";
import { z } from "zod";
import { heightMeters } from "@/lib/avatar/options";
import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, buildsUsed, countBuild, planOf } from "@/lib/server/billing";
import { requireFal } from "@/lib/server/config";
import { claimAvatar, getAvatar } from "@/lib/server/db";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { isJobRunning, startModelJob } from "@/lib/server/jobs";

const bodySchema = z.object({ conceptId: z.string().min(1).max(32) });

/** Kicks off 3D generation for the chosen concept. Poll GET /api/avatars/[id] for progress. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/model">) => {
  const { id } = await ctx.params;
  rateLimit(req, "model", 6);
  const record = requireOwner(req, id);
  requireFal();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Pick a concept first.");
  const concept = record.concepts.find((c) => c.id === parsed.data.conceptId);
  if (!concept) throw new HttpError(404, "Concept not found.");
  // Drafts are low resolution and looser on likeness; the model is built from a final render.
  if (concept.kind === "preview") throw new HttpError(400, "Create your final character first.");
  if (isJobRunning(id)) throw new HttpError(409, "Your character is already being built.");

  // The 3D build is the expensive step, so it is what a plan pays for.
  const payer = billingEnabled() ? requireBuildAllowance(req, id, record.model?.status === "failed") : null;

  const job = startModelJob(id, parsed.data.conceptId, heightMeters(record.appearance.height));
  if (payer) countBuild(payer);
  if (job) after(job);
  return Response.json({ avatar: ownerView(getAvatar(id)!) });
});

/**
 * Checks that the signed-in account may start a build, and attaches the
 * avatar to it. Returns the account to count the build against, or null
 * when the build is free: a retry after a failed build isn't charged twice.
 */
function requireBuildAllowance(req: Request, avatarId: string, retry: boolean): string | null {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to bring your character to life in 3D.");
  if (!claimAvatar(avatarId, user.id)) throw new HttpError(403, "This avatar belongs to another account.");
  const plan = PLANS[planOf(user)];
  if (!plan.builds) throw new HttpError(402, "Bringing your character to life in 3D is part of the Creator plan.");
  if (retry) return null;
  if (buildsUsed(user.id) >= plan.builds) {
    throw new HttpError(402, `You've used all ${plan.builds} of this month's 3D builds on the ${plan.name} plan. They reset next month.`);
  }
  return user.id;
}
