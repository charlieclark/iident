import "server-only";
import type { AvatarRecord, Usage } from "@/lib/avatar/types";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { userById } from "./auth";
import { billingEnabled, planOf } from "./billing";
import { config } from "./config";
import { avatarOwner, avatarsOwnedBy, updateAvatar } from "./db";
import { currentMonth } from "./time";

export { currentMonth };

/**
 * Counts the replies an avatar gives visitors each calendar month (UTC).
 * Every reply costs a model call plus speech, so this is both the basis for
 * pricing and a ceiling on what one avatar can spend. Owner previews and
 * greetings are not counted.
 */


/** This month's usage (a new month starts from zero). */
export function usageOf(record: AvatarRecord, now = new Date()): Usage {
  const month = currentMonth(now);
  const u = record.usage;
  return { month, replies: u?.month === month ? u.replies : 0, total: u?.total ?? 0 };
}

export type Allowance = { limit: number; used: number; paused: boolean };

/**
 * The replies an avatar may give this month: the limit (0 = none), how many
 * count against it so far, and whether the avatar is paused because its
 * account has no plan.
 *
 * With billing on, an avatar that belongs to an account draws on its plan's
 * allowance, which all of the account's avatars share. Otherwise the
 * configured default applies to each avatar on its own.
 */
export async function replyAllowance(record: AvatarRecord, now = new Date()): Promise<Allowance> {
  const ownerId = billingEnabled() ? await avatarOwner(record.id) : null;
  if (!ownerId) return { limit: config.limits.monthlyReplies, used: usageOf(record, now).replies, paused: false };
  const [user, owned] = await Promise.all([userById(ownerId), avatarsOwnedBy(ownerId)]);
  return accountAllowance(await planOf(user), owned, now);
}

/** The allowance shared by an account's avatars, from records already loaded. */
export function accountAllowance(plan: PlanId, owned: AvatarRecord[], now = new Date()): Allowance {
  const { replies } = PLANS[plan];
  return { limit: replies, used: owned.reduce((n, r) => n + usageOf(r, now).replies, 0), paused: replies === 0 };
}

/** Whether an allowance is used up, so the avatar should stop answering with a model call and speech. */
export const isOver = ({ limit, used, paused }: Allowance) => paused || (limit > 0 && used >= limit);

export async function overLimit(record: AvatarRecord, now = new Date()): Promise<boolean> {
  return isOver(await replyAllowance(record, now));
}

export async function countReply(id: string, now = new Date()) {
  await updateAvatar(id, (r) => {
    const u = usageOf(r, now);
    r.usage = { month: u.month, replies: u.replies + 1, total: u.total + 1 };
  });
}

/** What the avatar says, in text only, once the month's replies are used up. */
export function limitMessage(record: AvatarRecord, allowance: Allowance): string {
  const name = record.persona.name.trim();
  if (allowance.paused) return `I'm taking a break right now.${name ? ` You can still reach ${name} directly.` : ""}`;
  return `I've had so many conversations this month that I need to rest my voice until next month.${name ? ` You can still reach ${name} directly.` : ""}`;
}
