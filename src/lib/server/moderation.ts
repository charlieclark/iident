import "server-only";
import { randomBytes } from "node:crypto";
import type { AvatarRecord } from "@/lib/avatar/types";
import type { User } from "./auth";
import { dropCached } from "./avatarFiles";
import { config, HttpError } from "./config";
import { getAvatar, getAvatarBySlug, updateAvatar } from "./db";
import { sendReportEmail } from "./email";
import { track } from "./insights";
import { one, query } from "./pg";

/**
 * Reports and takedowns. Anyone can report a published avatar (someone made
 * one of them without permission, say). The site's owners (ADMIN_EMAILS) see
 * reports at /admin and can take an avatar down: its page and chat stop
 * existing at once and it can't be published again until it is restored.
 */

export const REPORT_REASONS = [
  { id: "impersonation", label: "It's me or someone I know, made without permission" },
  { id: "inappropriate", label: "It says or shows something harmful or inappropriate" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export type Report = { id: string; avatarId: string; slug: string | null; reason: string; details: string; reporterEmail: string | null; status: string; createdAt: number };
type Row = { id: string; avatar_id: string; slug: string | null; reason: string; details: string; reporter_email: string | null; status: string; created_at: number };
const toReport = (r: Row): Report => ({ id: r.id, avatarId: r.avatar_id, slug: r.slug, reason: r.reason, details: r.details, reporterEmail: r.reporter_email, status: r.status, createdAt: Number(r.created_at) });

export const isAdmin = (user: User | null) => !!user && config.adminEmails.includes(user.email);

export function requireAdmin(user: User | null): User {
  // The same answer for everyone who isn't an owner, signed in or not.
  if (!isAdmin(user)) throw new HttpError(404, "Not found.");
  return user!;
}

/** Records a report about a published avatar and tells the site's owners. */
export async function fileReport(input: { slug: string; reason: ReportReason; details: string; email?: string }): Promise<void> {
  const record = await getAvatarBySlug(input.slug);
  // Reporting a page that isn't there (any more) needs no action; the reporter gets the same thanks.
  if (!record) return;
  const id = randomBytes(9).toString("base64url");
  await query("INSERT INTO reports (id, avatar_id, slug, reason, details, reporter_email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    id,
    record.id,
    record.slug,
    input.reason,
    input.details,
    input.email || null,
    Date.now(),
  ]);
  await track("reported", { avatarId: record.id, props: { reason: input.reason } });
  if (config.adminEmails.length) {
    await sendReportEmail(config.adminEmails, { slug: record.slug!, reason: input.reason, details: input.details }, `${config.appUrl}/admin`).catch((err) =>
      console.warn("[report] could not email the owners:", err),
    );
  }
}

export async function openReports(): Promise<Report[]> {
  return (await query<Row>("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 100")).map(toReport);
}

/** Closes a report, and every other open report about the same avatar. */
async function closeReports(avatarId: string, status: "dismissed" | "actioned"): Promise<void> {
  await query("UPDATE reports SET status = $2, resolved_at = $3 WHERE avatar_id = $1 AND status = 'open'", [avatarId, status, Date.now()]);
}

export async function dismissReport(reportId: string): Promise<void> {
  const row = await one<{ avatar_id: string }>("SELECT avatar_id FROM reports WHERE id = $1", [reportId]);
  if (!row) throw new HttpError(404, "Report not found.");
  await closeReports(row.avatar_id, "dismissed");
}

/** Takes an avatar down: its page and chat are gone at once, and it stays unpublished until restored. */
export async function takeDown(avatarId: string, reason: string): Promise<AvatarRecord> {
  if (!(await getAvatar(avatarId))) throw new HttpError(404, "Avatar not found.");
  const record = await updateAvatar(avatarId, (r) => {
    r.suspended = { at: Date.now(), reason: reason.slice(0, 200) };
  });
  // Its model and thumbnail stop being public; the CDN's copies of them go now.
  await dropCached(avatarId);
  await closeReports(avatarId, "actioned");
  await track("taken_down", { avatarId });
  return record;
}

export async function restore(avatarId: string): Promise<AvatarRecord> {
  if (!(await getAvatar(avatarId))) throw new HttpError(404, "Avatar not found.");
  return updateAvatar(avatarId, (r) => {
    delete r.suspended;
  });
}
