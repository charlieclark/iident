import { z } from "zod";
import { config } from "@/lib/server/config";
import { isSlugTaken, updateAvatar } from "@/lib/server/db";
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
  const updated = updateAvatar(id, (r) => {
    r.slug = slug;
    r.published = true;
  });
  return Response.json({ avatar: ownerView(updated), url: `${config.appUrl}/a/${slug}` });
});
