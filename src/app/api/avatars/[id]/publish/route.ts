import { z } from "zod";
import { PLANS } from "@/lib/billing/plans";
import { sessionUser } from "@/lib/server/auth";
import { billingEnabled, planOf } from "@/lib/server/billing";
import { config } from "@/lib/server/config";
import { avatarsOwnedBy, claimAvatar, isSlugTaken, updateAvatar } from "@/lib/server/db";
import { HttpError, handle, normalizeSlug, ownerView, requireOwner, validateSlug } from "@/lib/server/http";

const bodySchema = z.object({ slug: z.string().max(64), published: z.boolean().default(true) });

/** Claims a share link (/a/<slug>) and publishes, or unpublishes, the avatar. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/publish">) => {
  const { id } = await ctx.params;
  const record = requireOwner(req, id);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Choose a link name.");
  if (!parsed.data.published) {
    const updated = updateAvatar(id, (r) => {
      r.published = false;
    });
    return Response.json({ avatar: ownerView(updated) });
  }
  const slug = normalizeSlug(parsed.data.slug);
  const problem = validateSlug(slug);
  if (problem) throw new HttpError(400, problem);
  if (isSlugTaken(slug, id)) throw new HttpError(409, "That link is taken. Try another.");
  if (record.model?.status !== "ready") throw new HttpError(400, "Finish building your 3D character first.");
  if (!record.persona.name.trim()) throw new HttpError(400, "Give your avatar a name first.");
  if (billingEnabled() && !record.published) requireLiveSlot(req, id);
  const updated = updateAvatar(id, (r) => {
    r.slug = slug;
    r.published = true;
  });
  return Response.json({ avatar: ownerView(updated), url: `${config.appUrl}/a/${slug}` });
});

/** Checks that the signed-in account's plan has room for one more live avatar. */
function requireLiveSlot(req: Request, avatarId: string) {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to publish your avatar.");
  if (!claimAvatar(avatarId, user.id)) throw new HttpError(403, "This avatar belongs to another account.");
  const plan = PLANS[planOf(user)];
  if (!plan.avatars) throw new HttpError(402, "Publishing your avatar is part of the Creator plan.");
  const live = avatarsOwnedBy(user.id).filter((r) => r.published && r.id !== avatarId).length;
  if (live >= plan.avatars) {
    throw new HttpError(
      402,
      `The ${plan.name} plan includes ${plan.avatars} live avatar${plan.avatars === 1 ? "" : "s"}. Unpublish another one first${plan.id === "pro" ? "" : ", or move to Pro"}.`,
    );
  }
}
