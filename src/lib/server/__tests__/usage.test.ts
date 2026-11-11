import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("reply metering", () => {
  let db: typeof import("../db");
  let usage: typeof import("../usage");
  let config: typeof import("../config").config;

  beforeAll(async () => {
    await freshDatabase("usage");
    db = await import("../db");
    usage = await import("../usage");
    ({ config } = await import("../config"));
  });

  it("counts replies per calendar month and keeps a running total", async () => {
    const { record } = await db.createAvatar();
    const nov = new Date("2026-11-30T23:59:00Z");
    const dec = new Date("2026-12-01T00:01:00Z");
    await usage.countReply(record.id, nov);
    await usage.countReply(record.id, nov);
    expect(usage.usageOf((await db.getAvatar(record.id))!, nov)).toEqual({ month: "2026-11", replies: 2, total: 2 });
    // A new month starts from zero without losing the total.
    expect(usage.usageOf((await db.getAvatar(record.id))!, dec)).toEqual({ month: "2026-12", replies: 0, total: 2 });
    await usage.countReply(record.id, dec);
    expect((await db.getAvatar(record.id))!.usage).toEqual({ month: "2026-12", replies: 1, total: 3 });
  });

  it("stops at the monthly limit, and 0 means no limit", async () => {
    const { record } = await db.createAvatar();
    const now = new Date("2026-11-10T12:00:00Z");
    config.limits.monthlyReplies = 2;
    await usage.countReply(record.id, now);
    expect(await usage.overLimit((await db.getAvatar(record.id))!, now)).toBe(false);
    await usage.countReply(record.id, now);
    expect(await usage.overLimit((await db.getAvatar(record.id))!, now)).toBe(true);
    expect(await usage.overLimit((await db.getAvatar(record.id))!, new Date("2026-12-01T00:00:00Z"))).toBe(false);
    config.limits.monthlyReplies = 0;
    expect(await usage.overLimit((await db.getAvatar(record.id))!, now)).toBe(false);
    config.limits.monthlyReplies = 300;
  });
});
