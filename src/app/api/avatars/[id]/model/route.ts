import { after } from "next/server";
import { z } from "zod";
import { heightMeters } from "@/lib/avatar/options";
import { requireFal } from "@/lib/server/config";
import { getAvatar } from "@/lib/server/db";
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
  if (!record.concepts.some((c) => c.id === parsed.data.conceptId)) throw new HttpError(404, "Concept not found.");
  if (isJobRunning(id)) throw new HttpError(409, "Your character is already being built.");

  const job = startModelJob(id, parsed.data.conceptId, heightMeters(record.appearance.height));
  if (job) after(job);
  return Response.json({ avatar: ownerView(getAvatar(id)!) });
});
