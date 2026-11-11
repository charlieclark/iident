import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getAvatar } from "@/lib/server/db";
import { handle, rateLimit } from "@/lib/server/http";
import { advanceModelJob } from "@/lib/server/jobs";

/** Room for the final merge of a model, which runs after the response. */
export const maxDuration = 300;

/**
 * fal calls this when a 3D step (sculpting, rigging) completes, so a build
 * carries on when nobody has the creator open. The call is only a nudge: it
 * must carry the build's secret, and what happened is then read from fal
 * itself, never from the request body.
 */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "fal-webhook", 60);
  const url = new URL(req.url);
  const key = Buffer.from(url.searchParams.get("key") ?? "");
  const record = await getAvatar(url.searchParams.get("avatar") ?? "");
  const expected = Buffer.from(record?.model?.hookKey ?? "");
  // Answer the same way for a wrong key and a finished build: there is nothing to retry.
  if (!record || !expected.length || key.length !== expected.length || !timingSafeEqual(key, expected)) {
    return Response.json({ ok: true });
  }
  const { finish } = await advanceModelJob(record);
  if (finish) after(finish);
  return Response.json({ ok: true });
});
