import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/server/config";
import { handle, HttpError } from "@/lib/server/http";
import { sweepInactive } from "@/lib/server/retention";

/** Deleting an account removes its files one avatar at a time. */
export const maxDuration = 300;

/**
 * Run once a day by Vercel (see vercel.json): warns and deletes accounts
 * nobody has used for the published period. Vercel sends CRON_SECRET as a
 * bearer token; without that setting, or with the wrong token, nothing runs.
 */
export const GET = handle(async (req: Request) => {
  const secret = config.cronSecret;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new HttpError(404, "Not found.");
  return Response.json(await sweepInactive());
});
