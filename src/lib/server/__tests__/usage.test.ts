import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

describe("reply metering", () => {
  let db: typeof import("../db");
  let usage: typeof import("../usage");
  let config: typeof import("../config").config;

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-usage-"));
    db = await import("../db");
    usage = await import("../usage");
    ({ config } = await import("../config"));
  });

  it("counts replies per calendar month and keeps a running total", () => {
    const { record } = db.createAvatar();
    const nov = new Date("2026-11-30T23:59:00Z");
    const dec = new Date("2026-12-01T00:01:00Z");
    usage.countReply(record.id, nov);
    usage.countReply(record.id, nov);
    expect(usage.usageOf(db.getAvatar(record.id)!, nov)).toEqual({ month: "2026-11", replies: 2, total: 2 });
    // A new month starts from zero without losing the total.
    expect(usage.usageOf(db.getAvatar(record.id)!, dec)).toEqual({ month: "2026-12", replies: 0, total: 2 });
    usage.countReply(record.id, dec);
    expect(db.getAvatar(record.id)!.usage).toEqual({ month: "2026-12", replies: 1, total: 3 });
  });

  it("stops at the monthly limit, and 0 means no limit", () => {
    const { record } = db.createAvatar();
    const now = new Date("2026-11-10T12:00:00Z");
    config.limits.monthlyReplies = 2;
    usage.countReply(record.id, now);
    expect(usage.overLimit(db.getAvatar(record.id)!, now)).toBe(false);
    usage.countReply(record.id, now);
    expect(usage.overLimit(db.getAvatar(record.id)!, now)).toBe(true);
    expect(usage.overLimit(db.getAvatar(record.id)!, new Date("2026-12-01T00:00:00Z"))).toBe(false);
    config.limits.monthlyReplies = 0;
    expect(usage.overLimit(db.getAvatar(record.id)!, now)).toBe(false);
    config.limits.monthlyReplies = 300;
  });
});
