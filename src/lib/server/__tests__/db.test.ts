import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

describe("avatar store", () => {
  let db: typeof import("../db");
  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-db-"));
    db = await import("../db");
  });

  it("creates drafts and verifies edit tokens", () => {
    const { record, editToken } = db.createAvatar();
    expect(db.verifyEditToken(record.id, editToken)).toBe(true);
    expect(db.verifyEditToken(record.id, "nope")).toBe(false);
    expect(db.verifyEditToken(record.id, null)).toBe(false);
  });

  it("persists in-place mutations", () => {
    const { record } = db.createAvatar();
    db.updateAvatar(record.id, (r) => {
      r.persona.name = "Sam";
    });
    expect(db.getAvatar(record.id)?.persona.name).toBe("Sam");
  });

  it("moves knowledge from the persona of older records into the context", () => {
    const legacy = { id: "x", persona: { name: "Sam", knowledge: "Loves trail running." } };
    const r = db.normalizeRecord(legacy as unknown as Parameters<typeof db.normalizeRecord>[0]);
    expect(r.persona).toEqual({ name: "Sam" });
    expect(r.context).toEqual({ knowledge: "Loves trail running.", items: [] });
    const { record } = db.createAvatar();
    expect(db.getAvatar(record.id)?.context).toEqual({ knowledge: "", items: [] });
  });

  it("finds published avatars by slug only", () => {
    const { record } = db.createAvatar();
    db.updateAvatar(record.id, (r) => {
      r.slug = "sam-test";
    });
    expect(db.getAvatarBySlug("sam-test")).toBeNull();
    db.updateAvatar(record.id, (r) => {
      r.published = true;
    });
    expect(db.getAvatarBySlug("SAM-TEST")?.id).toBe(record.id);
    expect(db.isSlugTaken("sam-test")).toBe(true);
    expect(db.isSlugTaken("sam-test", record.id)).toBe(false);
  });
});
