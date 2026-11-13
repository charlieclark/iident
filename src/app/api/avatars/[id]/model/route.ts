import { after } from "next/server";
import { z } from "zod";
import { heightMeters } from "@/lib/avatar/options";
import { sessionUser } from "@/lib/server/auth";
import { buildNeedsPayment, countBuild, requireBuildAllowance } from "@/lib/server/billing";
import { requireFal } from "@/lib/server/config";
import { avatarOwner, claimAvatar } from "@/lib/server/db";
import { track } from "@/lib/server/insights";
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

  // The 3D build is the expensive step, so it is what a plan pays for: it never starts before payment.
  let payer: string | null = null;
  if (buildNeedsPayment()) {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, "Sign in to bring your character to life in 3D.");
    if (!(await claimAvatar(id, user.id))) throw new HttpError(403, "This avatar belongs to another account.");
    payer = await requireBuildAllowance(user, record.model?.status === "failed");
  }

  // Submits the first step to the 3D service; the rest follows as it is polled (see jobs.ts).
  const { record: started, finish } = await startModelJob(id, parsed.data.conceptId, heightMeters(record.appearance.height));
  if (payer) await countBuild(payer);
  await track("build_started", { userId: payer ?? (await avatarOwner(id)), avatarId: id });
  if (finish) after(finish);
  return Response.json({ avatar: await ownerView(started) });
});
