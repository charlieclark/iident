import { z } from "zod";
import type { AvatarRecord } from "@/lib/avatar/types";
import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, planOf } from "@/lib/server/billing";
import { config } from "@/lib/server/config";
import { avatarOwner, avatarsOwnedBy, claimAvatar, isSlugTaken, updateAvatar } from "@/lib/server/db";
import { track } from "@/lib/server/insights";
import { errorCode, UNIQUE_VIOLATION } from "@/lib/server/pg";
import { HttpError, handle, normalizeSlug, ownerView, requireOwner, validateSlug } from "@/lib/server/http";

const bodySchema = z.object({ slug: z.string().max(64), published: z.boolean().default(true) });

/** Claims a share link (/a/<slug>) and publishes, or unpublishes, the avatar. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/publish">) => {
  const { id } = await ctx.params;
  const record = await requireOwner(req, id);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Choose a link name.");
  if (!parsed.data.published) {
    const updated = await updateAvatar(id, (r) => {
      r.published = false;
    });
    return Response.json({ avatar: await ownerView(updated) });
  }
  const slug = normalizeSlug(parsed.data.slug);
  const problem = validateSlug(slug);
  if (problem) throw new HttpError(400, problem);
  if (await isSlugTaken(slug, id)) throw new HttpError(409, "That link is taken. Try another.");
  if (record.suspended) throw new HttpError(403, "This avatar was taken down and can't be published. Contact us if you think that's a mistake.");
  if (record.model?.status !== "ready") throw new HttpError(400, "Finish building your 3D character first.");
  if (!record.persona.name.trim()) throw new HttpError(400, "Give your avatar a name first.");
  if (billingEnabled() && !record.published) await requireLiveSlot(req, id);
  let updated: AvatarRecord;
  try {
    updated = await updateAvatar(id, (r) => {
      r.slug = slug;
      r.published = true;
    });
  } catch (err) {
    // Someone took the link between the check above and now.
    if (errorCode(err) === UNIQUE_VIOLATION) throw new HttpError(409, "That link is taken. Try another.");
    throw err;
  }
  if (!record.published) await track("published", { userId: await avatarOwner(id), avatarId: id });
  return Response.json({ avatar: await ownerView(updated), url: `${config.appUrl}/a/${slug}` });
});

/** Checks that the signed-in account's plan has room for one more live avatar. */
async function requireLiveSlot(req: Request, avatarId: string) {
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to publish your avatar.");
  if (!(await claimAvatar(avatarId, user.id))) throw new HttpError(403, "This avatar belongs to another account.");
  const plan = PLANS[await planOf(user)];
  if (!plan.avatars) throw new HttpError(402, "Publishing your avatar is part of the Creator plan.");
  const live = (await avatarsOwnedBy(user.id)).filter((r) => r.published && r.id !== avatarId).length;
  if (live >= plan.avatars) {
    throw new HttpError(
      402,
      `The ${plan.name} plan includes ${plan.avatars} live avatar${plan.avatars === 1 ? "" : "s"}. Unpublish another one first${plan.id === "pro" ? "" : ", or move to Pro"}.`,
    );
  }
}
