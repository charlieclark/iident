import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("avatar store", () => {
  let db: typeof import("../db");
  beforeAll(async () => {
    await freshDatabase("db");
    db = await import("../db");
  });

  it("creates drafts and verifies edit tokens", async () => {
    const { record, editToken } = await db.createAvatar();
    expect(await db.verifyEditToken(record.id, editToken)).toBe(true);
    expect(await db.verifyEditToken(record.id, "nope")).toBe(false);
    expect(await db.verifyEditToken(record.id, null)).toBe(false);
  });

  it("only makes ids that are valid storage folder names", async () => {
    for (let i = 0; i < 3000; i++) expect(db.newAvatarId()).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{11}$/);
  });

  it("persists in-place mutations", async () => {
    const { record } = await db.createAvatar();
    await db.updateAvatar(record.id, (r) => {
      r.persona.name = "Sam";
    });
    expect((await db.getAvatar(record.id))?.persona.name).toBe("Sam");
  });

  it("moves knowledge from the persona of older records into the context", async () => {
    const legacy = { id: "x", persona: { name: "Sam", knowledge: "Loves trail running." } };
    const r = db.normalizeRecord(legacy as unknown as Parameters<typeof db.normalizeRecord>[0]);
    expect(r.persona).toEqual({ name: "Sam" });
    expect(r.context).toEqual({ knowledge: "Loves trail running.", items: [] });
    const { record } = await db.createAvatar();
    expect((await db.getAvatar(record.id))?.context).toEqual({ knowledge: "", items: [] });
  });

  it("finds published avatars by slug only", async () => {
    const { record } = await db.createAvatar();
    await db.updateAvatar(record.id, (r) => {
      r.slug = "sam-test";
    });
    expect(await db.getAvatarBySlug("sam-test")).toBeNull();
    await db.updateAvatar(record.id, (r) => {
      r.published = true;
    });
    expect((await db.getAvatarBySlug("SAM-TEST"))?.id).toBe(record.id);
    expect(await db.isSlugTaken("sam-test")).toBe(true);
    expect(await db.isSlugTaken("sam-test", record.id)).toBe(false);
  });

  it("applies updates that arrive together one after another, losing none", async () => {
    const { record } = await db.createAvatar();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db.updateAvatar(record.id, (r) => {
          r.usage = { month: "2026-11", replies: (r.usage?.replies ?? 0) + 1, total: (r.usage?.total ?? 0) + 1 };
        }),
      ),
    );
    expect((await db.getAvatar(record.id))!.usage).toEqual({ month: "2026-11", replies: 12, total: 12 });
  });

  it("leaves the record untouched when an update declines to change it", async () => {
    const { record } = await db.createAvatar();
    const before = (await db.getAvatar(record.id))!;
    const result = await db.updateAvatar(record.id, (r) => {
      r.persona.name = "Changed my mind";
      return false;
    });
    expect(result).toEqual(before);
    expect(await db.getAvatar(record.id)).toEqual(before);
    await expect(db.updateAvatar("missing", () => {})).rejects.toThrow(/not found/);
  });

  it("stores text that Postgres JSON cannot hold as is", async () => {
    const { record } = await db.createAvatar();
    await db.updateAvatar(record.id, (r) => {
      r.persona.about = "Pasted\u0000 text with an emoji 🎉 and a quote \" and a backslash \\";
    });
    expect((await db.getAvatar(record.id))!.persona.about).toBe("Pasted text with an emoji 🎉 and a quote \" and a backslash \\");
  });

  it("attaches an avatar to the first account that claims it", async () => {
    const { record } = await db.createAvatar();
    const [a, b] = await Promise.all([db.claimAvatar(record.id, "u_a"), db.claimAvatar(record.id, "u_b")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await db.claimAvatar("missing", "u_a")).toBe(false);
  });
});
