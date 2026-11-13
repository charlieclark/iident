import "server-only";
import { randomBytes } from "node:crypto";
import { query } from "./pg";

/**
 * What is happening on the site, kept in the site's own database: the steps
 * people take (so drop-off is visible) and what goes wrong. Nothing is sent
 * to a third party and no visitor is tracked: events are tied to accounts
 * and avatars, which only signed-in creators have.
 */

/** The steps worth counting, in the order people take them. */
export const STEPS = [
  "signed_up",
  "selfie_uploaded",
  "previewed",
  "character_created",
  "checkout_started",
  "plan_started",
  "build_started",
  "build_ready",
  "published",
] as const;

export type EventName = (typeof STEPS)[number] | "build_failed" | "reported" | "avatar_deleted" | "account_deleted" | "taken_down";

/** Records a step. Never throws: counting must not break the thing being counted. */
export async function track(name: EventName, who: { userId?: string | null; avatarId?: string | null; props?: Record<string, unknown> } = {}): Promise<void> {
  try {
    await query("INSERT INTO events (name, user_id, avatar_id, at, props) VALUES ($1, $2, $3, $4, $5::jsonb)", [
      name,
      who.userId ?? null,
      who.avatarId ?? null,
      Date.now(),
      JSON.stringify(who.props ?? {}),
    ]);
  } catch (err) {
    console.warn(`[insights] could not record ${name}:`, err);
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Records something that went wrong. Never throws. */
export async function logError(source: "server" | "build" | "browser", message: string, where: { route?: string; detail?: string } = {}): Promise<void> {
  try {
    await query("INSERT INTO errors (at, source, route, message, detail) VALUES ($1, $2, $3, $4, $5)", [
      Date.now(),
      source,
      where.route ? clip(where.route, 200) : null,
      clip(message || "Unknown error", 500),
      where.detail ? clip(where.detail, 4000) : null,
    ]);
    // Old errors are of no use; keep the table small.
    if (Math.random() < 0.02) await query("DELETE FROM errors WHERE at < $1", [Date.now() - 30 * 24 * 60 * 60 * 1000]);
  } catch (err) {
    console.warn("[insights] could not record an error:", err);
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How many people reached each step in the last day, week and 30 days. A
 * person is an account, or an avatar where no account is known.
 */
export async function funnel(now = Date.now()): Promise<{ step: string; day: number; week: number; month: number }[]> {
  const rows = await query<{ name: string; day: number; week: number; month: number }>(
    `SELECT name,
            COUNT(DISTINCT COALESCE(user_id, avatar_id)) FILTER (WHERE at > $1)::int AS day,
            COUNT(DISTINCT COALESCE(user_id, avatar_id)) FILTER (WHERE at > $2)::int AS week,
            COUNT(DISTINCT COALESCE(user_id, avatar_id))::int AS month
     FROM events WHERE at > $3 AND name = ANY($4) GROUP BY name`,
    [now - DAY, now - 7 * DAY, now - 30 * DAY, [...STEPS]],
  );
  const by = new Map(rows.map((r) => [r.name, r]));
  return STEPS.map((step) => ({ step, day: by.get(step)?.day ?? 0, week: by.get(step)?.week ?? 0, month: by.get(step)?.month ?? 0 }));
}

/** 3D builds over the last 30 days: how many started, finished and failed. */
export async function buildCounts(now = Date.now()): Promise<{ started: number; ready: number; failed: number }> {
  const rows = await query<{ name: string; n: number }>("SELECT name, COUNT(*)::int AS n FROM events WHERE at > $1 AND name = ANY($2) GROUP BY name", [
    now - 30 * DAY,
    ["build_started", "build_ready", "build_failed"],
  ]);
  const n = (name: string) => rows.find((r) => r.name === name)?.n ?? 0;
  return { started: n("build_started"), ready: n("build_ready"), failed: n("build_failed") };
}

export type LoggedError = { id: number; at: number; source: string; route: string | null; message: string; detail: string | null };

export async function recentErrors(limit = 30): Promise<LoggedError[]> {
  const rows = await query<LoggedError>("SELECT id, at, source, route, message, detail FROM errors ORDER BY at DESC, id DESC LIMIT $1", [limit]);
  return rows.map((r) => ({ ...r, id: Number(r.id), at: Number(r.at) }));
}

/**
 * When someone deletes their account, what they did stays countable but is
 * no longer theirs: their id is swapped for a random one that leads nowhere.
 * (Blanking it instead would drop them from "signed up" but not from the
 * later steps, and the funnel would stop adding up.)
 */
export async function forgetUser(userId: string): Promise<void> {
  await query("UPDATE events SET user_id = $2 WHERE user_id = $1", [userId, `gone_${randomBytes(9).toString("hex")}`]);
}
