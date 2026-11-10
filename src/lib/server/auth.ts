import "server-only";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { avatarOwner, db, hashToken, verifyEditToken } from "./db";

/**
 * Accounts without passwords: a person asks for a sign-in link by email,
 * opening it starts a session kept in an httpOnly cookie. Only hashes of
 * link and session tokens are stored.
 */

export type User = { id: string; email: string; createdAt: number };

export const SESSION_COOKIE = "iident_session";
const LINK_TTL = 20 * 60 * 1000;
const SESSION_TTL = 60 * 24 * 60 * 60 * 1000;
const LINKS_PER_HOUR = 5;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Creates a one-time sign-in token for an email, or null when too many were requested recently. */
export function createLoginToken(email: string, now = Date.now()): string | null {
  const address = normalizeEmail(email);
  const conn = db();
  conn.prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(now);
  const recent = conn.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?").get(address, now - 60 * 60 * 1000) as { n: number };
  if (recent.n >= LINKS_PER_HOUR) return null;
  const token = randomBytes(32).toString("base64url");
  conn.prepare("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashToken(token), address, now, now + LINK_TTL);
  return token;
}

/** Uses up a sign-in token and returns its account, creating the account on first sign-in. */
export function consumeLoginToken(token: string, now = Date.now()): User | null {
  const conn = db();
  const hash = hashToken(token);
  const row = conn.prepare("SELECT email, expires_at FROM login_tokens WHERE token_hash = ?").get(hash) as { email: string; expires_at: number } | undefined;
  if (!row) return null;
  conn.prepare("DELETE FROM login_tokens WHERE token_hash = ?").run(hash);
  if (row.expires_at < now) return null;
  const existing = userByEmail(row.email);
  if (existing) return existing;
  const user: User = { id: `u_${randomBytes(9).toString("hex")}`, email: row.email, createdAt: now };
  conn.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(user.id, user.email, user.createdAt);
  return user;
}

type UserRow = { id: string; email: string; created_at: number };
const toUser = (row: UserRow | undefined): User | null => (row ? { id: row.id, email: row.email, createdAt: row.created_at } : null);

export const userByEmail = (email: string) => toUser(db().prepare("SELECT id, email, created_at FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined);
export const userById = (id: string) => toUser(db().prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(id) as UserRow | undefined);

/** Starts a session and returns the cookie to set. */
export function startSession(userId: string, now = Date.now()): string {
  const token = randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now, now + SESSION_TTL);
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

/** The signed-in account for a request, if any. */
export function sessionUser(req: Request, now = Date.now()): User | null {
  const token = sessionToken(req);
  if (!token) return null;
  const row = db().prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as { user_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  return userById(row.user_id);
}

/** Ends the request's session and returns the cookie that clears it. */
export function endSession(req: Request): string {
  const token = sessionToken(req);
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  return sessionCookie("", 0);
}

/**
 * Whether the caller may edit an avatar: they hold its edit token (the
 * browser that created it) or are signed in to the account that owns it.
 */
export function canEdit(req: Request, avatarId: string, editToken = req.headers.get("x-edit-token")): boolean {
  if (verifyEditToken(avatarId, editToken)) return true;
  const user = sessionUser(req);
  return !!user && avatarOwner(avatarId) === user.id;
}
