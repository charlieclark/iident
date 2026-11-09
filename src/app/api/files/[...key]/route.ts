import { connection } from "next/server";
import { verifyEditToken } from "@/lib/server/db";
import { contentTypeFor, getFile } from "@/lib/server/storage";

/** Personal inputs are only served to the owner (edit token in `?t=`). */
const PRIVATE = /^(selfie|voice|concept)-/;

/** Serves stored avatar assets. File names are versioned, so they cache forever. */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  await connection();
  const { key } = await ctx.params;
  const [avatarId, name] = key;
  if (!avatarId || !name || key.length !== 2) return new Response("Not found", { status: 404 });
  const isPrivate = PRIVATE.test(name);
  if (isPrivate && !verifyEditToken(avatarId, new URL(req.url).searchParams.get("t"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const path = `${avatarId}/${name}`;
  const file = await getFile(path);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": contentTypeFor(path),
      "Content-Length": String(file.size),
      "Cache-Control": isPrivate ? "private, max-age=3600" : "public, max-age=31536000, immutable",
      "Referrer-Policy": "no-referrer",
      ...(isPrivate ? {} : { "Access-Control-Allow-Origin": "*" }),
    },
  });
}
