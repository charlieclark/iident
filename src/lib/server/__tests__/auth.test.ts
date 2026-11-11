import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("accounts", () => {
  let auth: typeof import("../auth");
  let db: typeof import("../db");
  beforeAll(async () => {
    await freshDatabase("auth");
    db = await import("../db");
    auth = await import("../auth");
  });

  const withCookie = (setCookie: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { headers: { cookie: setCookie.split(";")[0], ...headers } });
  const signIn = async (email: string) => {
    const user = (await auth.consumeLoginToken((await auth.createLoginToken(email))!))!;
    return { user, cookie: (await auth.startSession(user.id)) };
  };

  it("signs in with a link once, and creates the account on first use", async () => {
    const token = (await auth.createLoginToken("  Sam@Example.com "))!;
    const user = (await auth.consumeLoginToken(token))!;
    expect(user.email).toBe("sam@example.com");
    expect(await auth.consumeLoginToken(token)).toBeNull();
    expect(await auth.consumeLoginToken("made-up")).toBeNull();
    // A later sign-in is the same account.
    expect((await auth.consumeLoginToken((await auth.createLoginToken("sam@example.com"))!))!.id).toBe(user.id);
  });

  it("refuses expired links", async () => {
    const now = Date.now();
    const token = (await auth.createLoginToken("late@example.com", now))!;
    expect(await auth.consumeLoginToken(token, now + 21 * 60 * 1000)).toBeNull();
    expect(await auth.userByEmail("late@example.com")).toBeNull();
  });

  it("limits how many links one address can request in an hour", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(await auth.createLoginToken("busy@example.com", now + i)).toBeTruthy();
    expect(await auth.createLoginToken("busy@example.com", now + 10)).toBeNull();
    expect(await auth.createLoginToken("busy@example.com", now + 61 * 60 * 1000)).toBeTruthy();
  });

  it("keeps a session in an httpOnly cookie until sign-out or expiry", async () => {
    const { user, cookie } = await signIn("cookie@example.com");
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax/);
    expect((await auth.sessionUser(withCookie(cookie)))?.id).toBe(user.id);
    expect(await auth.sessionUser(new Request("http://localhost/x"))).toBeNull();
    expect(await auth.sessionUser(withCookie(`${auth.SESSION_COOKIE}=forged`))).toBeNull();
    expect(await auth.sessionUser(withCookie(cookie), Date.now() + 61 * 24 * 60 * 60 * 1000)).toBeNull();
    await auth.endSession(withCookie(cookie));
    expect(await auth.sessionUser(withCookie(cookie))).toBeNull();
  });

  it("lets the edit token or the owning account edit, and nobody else", async () => {
    const owner = await signIn("owner@example.com");
    const other = await signIn("other@example.com");
    const { record, editToken } = await db.createAvatar();
    const anonymous = new Request("http://localhost/x");

    expect(await auth.canEdit(new Request("http://localhost/x", { headers: { "x-edit-token": editToken } }), record.id)).toBe(true);
    expect(await auth.canEdit(anonymous, record.id)).toBe(false);
    // Signed in is not enough until the avatar belongs to the account.
    expect(await auth.canEdit(withCookie(owner.cookie), record.id)).toBe(false);

    expect(await db.claimAvatar(record.id, owner.user.id)).toBe(true);
    expect(await auth.canEdit(withCookie(owner.cookie), record.id)).toBe(true);
    expect(await auth.canEdit(withCookie(other.cookie), record.id)).toBe(false);
    // An avatar that has an owner can't be taken over.
    expect(await db.claimAvatar(record.id, other.user.id)).toBe(false);
    expect(await db.avatarOwner(record.id)).toBe(owner.user.id);
  });

  it("lists an account's avatars, including ones created while signed in", async () => {
    const { user } = await signIn("list@example.com");
    const made = (await db.createAvatar(user.id)).record;
    const claimed = (await db.createAvatar()).record;
    await db.createAvatar();
    await db.claimAvatar(claimed.id, user.id);
    expect((await db.avatarsOwnedBy(user.id)).map((r) => r.id).sort()).toEqual([made.id, claimed.id].sort());
  });
});
