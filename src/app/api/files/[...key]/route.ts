import { connection } from "next/server";
import { canEdit } from "@/lib/server/auth";
import { contentTypeFor, openFile } from "@/lib/server/storage";

/** Personal inputs are only served to the owner (edit token in `?t=`, or their signed-in session). */
const PRIVATE = /^(selfie|portrait|voice|concept)-/;

/**
 * Serves stored avatar assets. File names are versioned, so they cache
 * forever. Public files (3D models, thumbnails, backdrops) are also kept by
 * the CDN, so most requests for them never reach this function; private
 * ones are checked here every time and only cached by the owner's browser.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  await connection();
  const { key } = await ctx.params;
  const [avatarId, name] = key;
  if (!avatarId || !name || key.length !== 2) return new Response("Not found", { status: 404 });
  const isPrivate = PRIVATE.test(name);
  if (isPrivate && !(await canEdit(req, avatarId, new URL(req.url).searchParams.get("t")))) {
    return new Response("Forbidden", { status: 403 });
  }
  const path = `${avatarId}/${name}`;
  const file = await openFile(path);
  if (!file) return new Response("Not found", { status: 404 });
  // A stream is sent as it arrives (3D models are several megabytes).
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(path),
      ...(file.size != null ? { "Content-Length": String(file.size) } : {}),
      "Cache-Control": isPrivate ? "private, max-age=3600" : "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(isPrivate ? {} : { "Access-Control-Allow-Origin": "*" }),
    },
  });
}
