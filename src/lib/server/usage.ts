import "server-only";
import type { AvatarRecord, Usage } from "@/lib/avatar/types";
import { config } from "./config";
import { updateAvatar } from "./db";

/**
 * Counts the replies an avatar gives visitors each calendar month (UTC).
 * Every reply costs a model call plus speech, so this is both the basis for
 * pricing and a ceiling on what one avatar can spend. Owner previews and
 * greetings are not counted.
 */

export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

/** This month's usage (a new month starts from zero). */
export function usageOf(record: AvatarRecord, now = new Date()): Usage {
  const month = currentMonth(now);
  const u = record.usage;
  return { month, replies: u?.month === month ? u.replies : 0, total: u?.total ?? 0 };
}

export const monthlyReplyLimit = () => config.limits.monthlyReplies;

/** Whether the avatar has used up this month's replies. */
export function overLimit(record: AvatarRecord, now = new Date()): boolean {
  const limit = monthlyReplyLimit();
  return limit > 0 && usageOf(record, now).replies >= limit;
}

export function countReply(id: string, now = new Date()) {
  updateAvatar(id, (r) => {
    const u = usageOf(r, now);
    r.usage = { month: u.month, replies: u.replies + 1, total: u.total + 1 };
  });
}

/** What the avatar says, in text only, once the month's replies are used up. */
export function limitMessage(record: AvatarRecord): string {
  const name = record.persona.name.trim();
  return `I've had so many conversations this month that I need to rest my voice until next month.${name ? ` You can still reach ${name} directly.` : ""}`;
}
