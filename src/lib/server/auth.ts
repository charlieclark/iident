import "server-only";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { hashToken, loadAvatar, tokenMatches, type LoadedAvatar } from "./db";
import { track } from "./insights";
import { one, query } from "./pg";

/**
 * Accounts without passwords: a person asks for a sign-in link by email,
 * opening it starts a session kept in an httpOnly cookie. Only hashes of
 * link and session tokens are stored.
 */

export type User = { id: string; email: string; createdAt: number };

export const SESSION_COOKIE = "aliike_session";
const LINK_TTL = 20 * 60 * 1000;
const SESSION_TTL = 60 * 24 * 60 * 60 * 1000;
const LINKS_PER_HOUR = 5;
/** How often an account's "last used" time is refreshed. It only has to be right to the day. */
const SEEN_EVERY = 24 * 60 * 60 * 1000;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Creates a one-time sign-in token for an email, or null when too many were requested recently. */
export async function createLoginToken(email: string, now = Date.now()): Promise<string | null> {
  const address = normalizeEmail(email);
  await query("DELETE FROM login_tokens WHERE expires_at < $1", [now]);
  const recent = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM login_tokens WHERE email = $1 AND created_at > $2", [address, now - 60 * 60 * 1000]);
  if ((recent?.n ?? 0) >= LINKS_PER_HOUR) return null;
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES ($1, $2, $3, $4)", [hashToken(token), address, now, now + LINK_TTL]);
  return token;
}

/** Uses up a sign-in token and returns its account, creating the account on first sign-in. */
export async function consumeLoginToken(token: string, now = Date.now()): Promise<User | null> {
  // Deleting and reading in one statement makes the token single use even when two requests race.
  const row = await one<{ email: string; expires_at: number }>("DELETE FROM login_tokens WHERE token_hash = $1 RETURNING email, expires_at", [hashToken(token)]);
  if (!row || Number(row.expires_at) < now) return null;
  const created = await query<{ id: string }>("INSERT INTO users (id, email, created_at, last_seen_at) VALUES ($1, $2, $3, $3) ON CONFLICT (email) DO NOTHING RETURNING id", [
    `u_${randomBytes(9).toString("hex")}`,
    row.email,
    now,
  ]);
  if (created[0]) await track("signed_up", { userId: created[0].id });
  return userByEmail(row.email);
}

type UserRow = { id: string; email: string; created_at: number };
const toUser = (row: UserRow | undefined): User | null => (row ? { id: row.id, email: row.email, createdAt: Number(row.created_at) } : null);

export const userByEmail = async (email: string) => toUser(await one<UserRow>("SELECT id, email, created_at FROM users WHERE email = $1", [normalizeEmail(email)]));
export const userById = async (id: string) => toUser(await one<UserRow>("SELECT id, email, created_at FROM users WHERE id = $1", [id]));

/** Starts a session and returns the cookie to set. */
export async function startSession(userId: string, now = Date.now()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Sessions that ran out are cleared whenever a new one starts, so the table doesn't grow for ever.
  await query("DELETE FROM sessions WHERE expires_at < $1", [now]);
  await query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [hashToken(token), userId, now, now + SESSION_TTL]);
  await seen(userId, now);
  return sessionCookie(token, SESSION_TTL / 1000);
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = config.appUrl.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function sessionToken(req: Request): string | null {
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? match.slice(SESSION_COOKIE.length + 1) : null;
}

/**
 * Notes that the account was used just now. Unused accounts are deleted on a
 * schedule (see ./retention.ts), and using one also withdraws a warning that
 * it was about to be.
 */
async function seen(userId: string, now: number): Promise<void> {
  await query("UPDATE users SET last_seen_at = $2, retention_warned_at = NULL WHERE id = $1", [userId, now]).catch((err) =>
    console.warn(`[auth] could not note that ${userId} was here:`, err),
  );
}

/** The signed-in account for a request, if any. */
export async function sessionUser(req: Request, now = Date.now()): Promise<User | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const row = await one<UserRow & { last_seen_at: number | null }>(
    "SELECT u.id, u.email, u.created_at, u.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at >= $2",
    [hashToken(token), now],
  );
  if (row && now - Number(row.last_seen_at ?? 0) > SEEN_EVERY) await seen(row.id, now);
  return toUser(row);
}

/** Ends the request's session and returns the cookie that clears it. */
export async function endSession(req: Request): Promise<string> {
  const token = sessionToken(req);
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  return sessionCookie("", 0);
}

/**
 * Whether the caller may edit a loaded avatar: they hold its edit token (the
 * browser that created it) or are signed in to the account that owns it.
 */
export async function mayEdit(req: Request, avatar: LoadedAvatar, editToken = req.headers.get("x-edit-token")): Promise<boolean> {
  if (tokenMatches(avatar.editTokenHash, editToken)) return true;
  if (!avatar.ownerId) return false;
  return (await sessionUser(req))?.id === avatar.ownerId;
}

/** As `mayEdit`, for an avatar known only by id. */
export async function canEdit(req: Request, avatarId: string, editToken = req.headers.get("x-edit-token")): Promise<boolean> {
  const avatar = await loadAvatar(avatarId);
  return !!avatar && mayEdit(req, avatar, editToken);
}
