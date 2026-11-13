import { beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

// The CDN keeps public files (the 3D model) for a year unless told to drop them.
const dropped = vi.fn<(tag: string) => Promise<void>>(async () => {});
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: (tag: string) => dropped(tag) }));

describe("reports and takedowns", () => {
  let db: typeof import("../db");
  let http: typeof import("../http");
  let moderation: typeof import("../moderation");
  let config: typeof import("../config").config;

  beforeAll(async () => {
    await freshDatabase("moderation");
    db = await import("../db");
    http = await import("../http");
    moderation = await import("../moderation");
    ({ config } = await import("../config"));
    config.adminEmails = ["owner@example.com"];
  });

  let n = 0;
  async function published() {
    const { record } = await db.createAvatar();
    const slug = `live-${++n}`;
    await db.updateAvatar(record.id, (r) => {
      r.slug = slug;
      r.published = true;
      r.persona.name = "Sam";
      r.model = { status: "ready", conceptId: "c", heightMeters: 1.7, startedAt: 1, updatedAt: 2, file: `${record.id}/model-1.glb` };
    });
    return { id: record.id, slug };
  }
  const user = (email: string) => ({ id: "u_1", email, createdAt: 1 });

  it("lets only the site's owners in", () => {
    expect(moderation.isAdmin(user("owner@example.com"))).toBe(true);
    expect(moderation.isAdmin(user("someone@example.com"))).toBe(false);
    expect(moderation.isAdmin(null)).toBe(false);
    expect(() => moderation.requireAdmin(user("someone@example.com"))).toThrow(/Not found/);
    expect(() => moderation.requireAdmin(null)).toThrow(/Not found/);
  });

  it("records a report about a live avatar, and ignores one about a page that isn't there", async () => {
    const a = await published();
    await moderation.fileReport({ slug: a.slug, reason: "impersonation", details: "This is me.", email: "me@example.com" });
    await moderation.fileReport({ slug: "no-such-page", reason: "other", details: "" });
    const open = await moderation.openReports();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ avatarId: a.id, slug: a.slug, reason: "impersonation", details: "This is me.", reporterEmail: "me@example.com", status: "open" });
  });

  it("takes an avatar down at once, and puts it back", async () => {
    const a = await published();
    await moderation.fileReport({ slug: a.slug, reason: "inappropriate", details: "" });
    await moderation.fileReport({ slug: a.slug, reason: "other", details: "again" });
    expect(http.publicView((await db.getAvatar(a.id))!)).not.toBeNull();

    await moderation.takeDown(a.id, "inappropriate");
    // Its link finds nothing, its page has nothing to show, and nobody else can take the link.
    expect(await db.getAvatarBySlug(a.slug)).toBeNull();
    expect(http.publicView((await db.getAvatar(a.id))!)).toBeNull();
    expect(await db.isSlugTaken(a.slug)).toBe(true);
    expect((await db.suspendedAvatars()).map((r) => r.id)).toContain(a.id);
    // Its 3D model stops being public, and the copies the CDN holds are dropped.
    expect(await db.isSuspended(a.id)).toBe(true);
    expect(dropped).toHaveBeenCalledWith(`avatar-${a.id}`);
    // Every report about it is closed.
    expect((await moderation.openReports()).filter((r) => r.avatarId === a.id)).toHaveLength(0);
    // A report can't be filed against a page that is down.
    await moderation.fileReport({ slug: a.slug, reason: "other", details: "" });
    expect((await moderation.openReports()).filter((r) => r.avatarId === a.id)).toHaveLength(0);

    await moderation.restore(a.id);
    expect(await db.isSuspended(a.id)).toBe(false);
    expect((await db.getAvatarBySlug(a.slug))?.id).toBe(a.id);
    expect(http.publicView((await db.getAvatar(a.id))!)).not.toBeNull();
  });

  it("dismisses a report without touching the avatar", async () => {
    const a = await published();
    await moderation.fileReport({ slug: a.slug, reason: "other", details: "" });
    const report = (await moderation.openReports()).find((r) => r.avatarId === a.id)!;
    await moderation.dismissReport(report.id);
    expect((await moderation.openReports()).filter((r) => r.avatarId === a.id)).toHaveLength(0);
    expect((await db.getAvatarBySlug(a.slug))?.id).toBe(a.id);
    await expect(moderation.dismissReport("nope")).rejects.toMatchObject({ status: 404 });
    await expect(moderation.takeDown("nope", "x")).rejects.toMatchObject({ status: 404 });
  });
});
