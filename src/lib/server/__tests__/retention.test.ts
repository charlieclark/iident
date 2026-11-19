import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";
import { RETENTION } from "../../retention";

vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: async () => {} }));

const DAY = 24 * 60 * 60 * 1000;

describe("unused accounts", () => {
  let auth: typeof import("../auth");
  let db: typeof import("../db");
  let pg: typeof import("../pg");
  let storage: typeof import("../storage");
  let retention: typeof import("../retention");
  let config: typeof import("../config").config;
  let sent: { to: string[]; subject: string; text: string }[];

  beforeAll(async () => {
    await freshDatabase("retention");
    auth = await import("../auth");
    db = await import("../db");
    pg = await import("../pg");
    storage = await import("../storage");
    retention = await import("../retention");
    ({ config } = await import("../config"));
  });
  beforeEach(() => {
    sent = [];
    config.email.resendKey = "re_placeholder";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    config.email.resendKey = undefined;
    // Each test starts with no accounts, so a sweep only meets its own.
    await pg.query("DELETE FROM users");
  });

  const now = Date.UTC(2030, 5, 15);
  /** `months` and `days` before `now`. */
  const ago = (months: number, days = 0) => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.getTime() - days * DAY;
  };
  let n = 0;
  /** An account with one avatar and its photo, last used at `lastSeen`. */
  async function account(lastSeen: number, data: Record<string, unknown> = {}, email = `quiet${++n}@example.com`) {
    const user = (await auth.consumeLoginToken((await auth.createLoginToken(email))!))!;
    const { record } = await db.createAvatar(user.id);
    const selfie = await storage.putFile(record.id, "selfie-1.jpg", Buffer.from("face"));
    await pg.query("UPDATE users SET last_seen_at = $2, data = $3::jsonb WHERE id = $1", [user.id, lastSeen, JSON.stringify(data)]);
    return { user, avatarId: record.id, selfie };
  }
  const exists = async (id: string) => !!(await auth.userById(id));
  const warnedAt = async (id: string) => (await pg.one<{ w: number | null }>("SELECT retention_warned_at AS w FROM users WHERE id = $1", [id]))?.w ?? null;

  it("leaves an account alone while it is in use", async () => {
    const recent = await account(now - 10 * DAY);
    const almost = await account(ago(RETENTION.inactiveMonths, -(RETENTION.warningDays + 5)));
    expect(await retention.sweepInactive(now)).toEqual({ warned: 0, deleted: 0 });
    expect(sent).toHaveLength(0);
    expect(await exists(recent.user.id)).toBe(true);
    expect(await warnedAt(almost.user.id)).toBeNull();
  });

  it("warns first, once, and deletes only after the warning has run out", async () => {
    const a = await account(ago(RETENTION.inactiveMonths, 3));
    expect(await retention.sweepInactive(now)).toEqual({ warned: 1, deleted: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([a.user.email]);
    // The email names the day, which is the warning period away.
    const day = new Date(now + RETENTION.warningDays * DAY).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    expect(sent[0].text).toContain(day);
    expect(sent[0].text).toContain("/login");

    // The next days: no second email, and nothing is deleted.
    expect(await retention.sweepInactive(now + DAY)).toEqual({ warned: 0, deleted: 0 });
    expect(await retention.sweepInactive(now + (RETENTION.warningDays - 1) * DAY)).toEqual({ warned: 0, deleted: 0 });
    expect(sent).toHaveLength(1);
    expect(await exists(a.user.id)).toBe(true);

    // Once the warning has run out, the account goes with everything in it.
    expect(await retention.sweepInactive(now + RETENTION.warningDays * DAY)).toEqual({ warned: 0, deleted: 1 });
    expect(await exists(a.user.id)).toBe(false);
    expect(await db.getAvatar(a.avatarId)).toBeNull();
    expect(await storage.getFile(a.selfie)).toBeNull();
  });

  it("is warned ahead, so the full period has passed by the time it is deleted", async () => {
    // Unused for the period less ten days: inside the warning window, not yet due.
    const a = await account(ago(RETENTION.inactiveMonths, -10));
    expect(await retention.sweepInactive(now)).toEqual({ warned: 1, deleted: 0 });
    // Ten days on, the period is up but the warning is only ten days old.
    expect(await retention.sweepInactive(now + 11 * DAY)).toEqual({ warned: 0, deleted: 0 });
    expect(await exists(a.user.id)).toBe(true);
    expect(await retention.sweepInactive(now + RETENTION.warningDays * DAY)).toEqual({ warned: 0, deleted: 1 });
  });

  it("keeps an account whose owner signs in after the warning", async () => {
    const a = await account(ago(RETENTION.inactiveMonths, 3));
    await retention.sweepInactive(now);
    expect(await warnedAt(a.user.id)).not.toBeNull();
    // Signing in withdraws the warning and starts the clock again.
    await auth.startSession(a.user.id, now + 5 * DAY);
    expect(await warnedAt(a.user.id)).toBeNull();
    expect(await retention.sweepInactive(now + (RETENTION.warningDays + 1) * DAY)).toEqual({ warned: 0, deleted: 0 });
    expect(await exists(a.user.id)).toBe(true);
  });

  it("never touches an account with a plan, or the site's own", async () => {
    const old = ago(RETENTION.inactiveMonths + 12);
    const paying = await account(old, { subscription: { id: "sub_1", status: "active", plan: "creator" } });
    const retrying = await account(old, { subscription: { id: "sub_2", status: "past_due", plan: "pro" } });
    const comped = await account(old, { comp: "pro" });
    config.adminEmails = ["owner@example.com"];
    const owner = await account(old, {}, "owner@example.com");
    // A plan that ended does not keep an account.
    const lapsed = await account(old, { subscription: { id: "sub_3", status: "canceled", plan: "creator" } });

    expect(await retention.sweepInactive(now)).toEqual({ warned: 1, deleted: 0 });
    expect(sent.map((m) => m.to[0])).toEqual([lapsed.user.email]);
    await retention.sweepInactive(now + (RETENTION.warningDays + 1) * DAY);
    for (const kept of [paying, retrying, comped, owner]) expect(await exists(kept.user.id)).toBe(true);
    expect(await exists(lapsed.user.id)).toBe(false);
    config.adminEmails = [];
  });

  it("deletes nobody when nobody can be warned", async () => {
    config.email.resendKey = undefined;
    const a = await account(ago(RETENTION.inactiveMonths + 6));
    expect(await retention.sweepInactive(now)).toEqual({ warned: 0, deleted: 0 });
    expect(await retention.sweepInactive(now + 90 * DAY)).toEqual({ warned: 0, deleted: 0 });
    expect(await exists(a.user.id)).toBe(true);
    expect(await warnedAt(a.user.id)).toBeNull();
  });

  it("counts being signed in as using the account, noted once a day", async () => {
    const user = (await auth.consumeLoginToken((await auth.createLoginToken("here@example.com", now))!, now))!;
    const cookie = (await auth.startSession(user.id, now)).split(";")[0];
    const lastSeen = async () => Number((await pg.one<{ t: number }>("SELECT last_seen_at AS t FROM users WHERE id = $1", [user.id]))!.t);
    const request = () => new Request("http://localhost/x", { headers: { cookie } });
    expect(await lastSeen()).toBe(now);
    await auth.sessionUser(request(), now + 60 * 60 * 1000);
    expect(await lastSeen()).toBe(now);
    await auth.sessionUser(request(), now + 2 * DAY);
    expect(await lastSeen()).toBe(now + 2 * DAY);
  });
});
