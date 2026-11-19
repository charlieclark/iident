import "server-only";
import { RETENTION } from "@/lib/retention";
import type { User } from "./auth";
import { ACTIVE_STATUSES } from "./billing";
import { config } from "./config";
import { sendInactiveWarningEmail } from "./email";
import { logError, track } from "./insights";
import { query } from "./pg";
import { deleteAccount } from "./removal";

/**
 * The retention schedule for unused accounts.
 *
 * An account holds a person's face and voice, and until they delete it, so
 * does the site. Someone who tried it once and never came back should not be
 * on file for ever. So an account is deleted, with everything in it, when
 *
 *   - nobody has signed in to it for RETENTION.inactiveMonths, and
 *   - it has no paid or complimentary plan, and
 *   - its owner was told by email at least RETENTION.warningDays ago.
 *
 * Signing in at any point, including after the warning, starts the clock
 * again. Nothing is deleted without the warning having been sent, so a site
 * with no email service deletes nothing.
 *
 * `sweepInactive` is run once a day by the scheduled call to
 * /api/cron/retention. It is safe to run at any time and any number of times.
 */

const DAY = 24 * 60 * 60 * 1000;

/** `months` before `now`, by the calendar. */
function monthsBefore(now: number, months: number): number {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

type Row = { id: string; email: string; created_at: number; last_seen: number };
const toUser = (r: Row): User => ({ id: r.id, email: r.email, createdAt: Number(r.created_at) });

/** Accounts last used before `cutoff` that no plan keeps alive. */
const UNUSED = `COALESCE(last_seen_at, created_at) < $1
  AND COALESCE(data->'subscription'->>'status', '') <> ALL($2::text[])
  AND data->>'comp' IS NULL
  AND email <> ALL($3::text[])`;

export async function sweepInactive(now = Date.now(), batch = 50): Promise<{ warned: number; deleted: number }> {
  const deleteBefore = monthsBefore(now, RETENTION.inactiveMonths);
  const warning = RETENTION.warningDays * DAY;
  // The site's own accounts and accounts given a plan by hand are never swept.
  const kept = [...config.stripe.compEmails, ...config.adminEmails];
  const columns = "id, email, created_at, COALESCE(last_seen_at, created_at) AS last_seen";

  // 1. Delete the accounts whose warning has run out and that are still unused.
  const due = await query<Row>(
    `SELECT ${columns} FROM users WHERE ${UNUSED} AND retention_warned_at IS NOT NULL AND retention_warned_at <= $4 ORDER BY retention_warned_at LIMIT $5`,
    [deleteBefore, ACTIVE_STATUSES, kept, now - warning, batch],
  );
  let deleted = 0;
  for (const row of due) {
    try {
      await deleteAccount(toUser(row));
      await track("inactive_deleted");
      deleted++;
    } catch (err) {
      await logError("server", `Could not delete the unused account ${row.id}`, { route: "retention", detail: String(err) });
    }
  }

  // 2. Warn the accounts that will be due once the warning period has passed.
  const soon = await query<Row>(`SELECT ${columns} FROM users WHERE ${UNUSED} AND retention_warned_at IS NULL ORDER BY last_seen LIMIT $4`, [
    deleteBefore + warning,
    ACTIVE_STATUSES,
    kept,
    batch,
  ]);
  let warned = 0;
  for (const row of soon) {
    // The warning is claimed before the email goes out, so two sweeps at once can't both send it.
    // Only an account that is still unused is claimed: its owner may have signed in a moment ago.
    const claimed = await query(
      "UPDATE users SET retention_warned_at = $2 WHERE id = $1 AND retention_warned_at IS NULL AND COALESCE(last_seen_at, created_at) = $3 RETURNING id",
      [row.id, now, row.last_seen],
    );
    if (!claimed.length) continue;
    let sent = false;
    try {
      // Deleted when both hold: the warning is `warningDays` old, and the account has been unused for the full period.
      const deleteOn = new Date(Math.max(now + warning, monthsBefore(Number(row.last_seen), -RETENTION.inactiveMonths)));
      sent = await sendInactiveWarningEmail(row.email, RETENTION.inactiveMonths, deleteOn, `${config.appUrl}/login`);
    } catch (err) {
      await logError("server", `Could not warn the unused account ${row.id}`, { route: "retention", detail: String(err) });
    }
    if (sent) {
      await track("inactive_warned", { userId: row.id });
      warned++;
      continue;
    }
    // Not warned after all, so not on the way to being deleted.
    await query("UPDATE users SET retention_warned_at = NULL WHERE id = $1 AND retention_warned_at = $2", [row.id, now]);
    // No email service at all: nobody can be warned, so nobody is deleted.
    if (!config.email.resendKey) break;
  }
  return { warned, deleted };
}
