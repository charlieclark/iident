import { after } from "next/server";
import { z } from "zod";
import { heightMeters } from "@/lib/avatar/options";
import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, buildsUsed, countBuild, planOf } from "@/lib/server/billing";
import { requireFal } from "@/lib/server/config";
import { claimAvatar } from "@/lib/server/db";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { isBuilding, startModelJob } from "@/lib/server/jobs";

/** Room for the final merge of a model, which runs after the response. */
export const maxDuration = 300;

const bodySchema = z.object({ conceptId: z.string().min(1).max(32) });

/** Kicks off 3D generation for the chosen concept. Poll GET /api/avatars/[id] for progress. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/model">) => {
  const { id } = await ctx.params;
  await rateLimit(req, "model", 6);
  const record = await requireOwner(req, id);
  requireFal();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Pick a concept first.");
  const concept = record.concepts.find((c) => c.id === parsed.data.conceptId);
  if (!concept) throw new HttpError(404, "Concept not found.");
  // Drafts are low resolution and looser on likeness; the model is built from a final render.
  if (concept.kind === "preview") throw new HttpError(400, "Create your final character first.");
  if (isBuilding(record.model)) throw new HttpError(409, "Your character is already being built.");

  // The 3D build is the expensive step, so it is what a plan pays for.
  const payer = billingEnabled() ? await requireBuildAllowance(req, id, record.model?.status === "failed") : null;

  // Submits the first step to the 3D service; the rest follows as it is polled (see jobs.ts).
  const { record: started, finish } = await startModelJob(id, parsed.data.conceptId, heightMeters(record.appearance.height));
  if (payer) await countBuild(payer);
  if (finish) after(finish);
  return Response.json({ avatar: await ownerView(started) });
});

/**
 * Checks that the signed-in account may start a build, and attaches the
 * avatar to it. Returns the account to count the build against, or null
 * when the build is free: a retry after a failed build isn't charged twice.
 */
async function requireBuildAllowance(req: Request, avatarId: string, retry: boolean): Promise<string | null> {
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to bring your character to life in 3D.");
  if (!(await claimAvatar(avatarId, user.id))) throw new HttpError(403, "This avatar belongs to another account.");
  const plan = PLANS[await planOf(user)];
  if (!plan.builds) throw new HttpError(402, "Bringing your character to life in 3D is part of the Creator plan.");
  if (retry) return null;
  if ((await buildsUsed(user.id)) >= plan.builds) {
    throw new HttpError(402, `You've used all ${plan.builds} of this month's 3D builds on the ${plan.name} plan. They reset next month.`);
  }
  return user.id;
}
