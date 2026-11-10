import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

describe("accounts", () => {
  let auth: typeof import("../auth");
  let db: typeof import("../db");
  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-auth-"));
    db = await import("../db");
    auth = await import("../auth");
  });

  const withCookie = (setCookie: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { headers: { cookie: setCookie.split(";")[0], ...headers } });
  const signIn = (email: string) => {
    const user = auth.consumeLoginToken(auth.createLoginToken(email)!)!;
    return { user, cookie: auth.startSession(user.id) };
  };

  it("signs in with a link once, and creates the account on first use", () => {
    const token = auth.createLoginToken("  Sam@Example.com ")!;
    const user = auth.consumeLoginToken(token)!;
    expect(user.email).toBe("sam@example.com");
    expect(auth.consumeLoginToken(token)).toBeNull();
    expect(auth.consumeLoginToken("made-up")).toBeNull();
    // A later sign-in is the same account.
    expect(auth.consumeLoginToken(auth.createLoginToken("sam@example.com")!)!.id).toBe(user.id);
  });

  it("refuses expired links", () => {
    const now = Date.now();
    const token = auth.createLoginToken("late@example.com", now)!;
    expect(auth.consumeLoginToken(token, now + 21 * 60 * 1000)).toBeNull();
    expect(auth.userByEmail("late@example.com")).toBeNull();
  });

  it("limits how many links one address can request in an hour", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(auth.createLoginToken("busy@example.com", now + i)).toBeTruthy();
    expect(auth.createLoginToken("busy@example.com", now + 10)).toBeNull();
    expect(auth.createLoginToken("busy@example.com", now + 61 * 60 * 1000)).toBeTruthy();
  });

  it("keeps a session in an httpOnly cookie until sign-out or expiry", () => {
    const { user, cookie } = signIn("cookie@example.com");
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax/);
    expect(auth.sessionUser(withCookie(cookie))?.id).toBe(user.id);
    expect(auth.sessionUser(new Request("http://localhost/x"))).toBeNull();
    expect(auth.sessionUser(withCookie(`${auth.SESSION_COOKIE}=forged`))).toBeNull();
    expect(auth.sessionUser(withCookie(cookie), Date.now() + 61 * 24 * 60 * 60 * 1000)).toBeNull();
    auth.endSession(withCookie(cookie));
    expect(auth.sessionUser(withCookie(cookie))).toBeNull();
  });

  it("lets the edit token or the owning account edit, and nobody else", () => {
    const owner = signIn("owner@example.com");
    const other = signIn("other@example.com");
    const { record, editToken } = db.createAvatar();
    const anonymous = new Request("http://localhost/x");

    expect(auth.canEdit(new Request("http://localhost/x", { headers: { "x-edit-token": editToken } }), record.id)).toBe(true);
    expect(auth.canEdit(anonymous, record.id)).toBe(false);
    // Signed in is not enough until the avatar belongs to the account.
    expect(auth.canEdit(withCookie(owner.cookie), record.id)).toBe(false);

    expect(db.claimAvatar(record.id, owner.user.id)).toBe(true);
    expect(auth.canEdit(withCookie(owner.cookie), record.id)).toBe(true);
    expect(auth.canEdit(withCookie(other.cookie), record.id)).toBe(false);
    // An avatar that has an owner can't be taken over.
    expect(db.claimAvatar(record.id, other.user.id)).toBe(false);
    expect(db.avatarOwner(record.id)).toBe(owner.user.id);
  });

  it("lists an account's avatars, including ones created while signed in", () => {
    const { user } = signIn("list@example.com");
    const made = db.createAvatar(user.id).record;
    const claimed = db.createAvatar().record;
    db.createAvatar();
    db.claimAvatar(claimed.id, user.id);
    expect(db.avatarsOwnedBy(user.id).map((r) => r.id).sort()).toEqual([made.id, claimed.id].sort());
  });
});
