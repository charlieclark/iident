import { beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("what is happening on the site", () => {
  let insights: typeof import("../insights");
  let http: typeof import("../http");
  beforeAll(async () => {
    await freshDatabase("insights");
    insights = await import("../insights");
    http = await import("../http");
  });

  it("counts people, not clicks, at each step", async () => {
    await insights.track("signed_up", { userId: "u_a" });
    await insights.track("signed_up", { userId: "u_b" });
    await insights.track("selfie_uploaded", { userId: "u_a", avatarId: "a1" });
    await insights.track("previewed", { userId: "u_a", avatarId: "a1" });
    await insights.track("previewed", { userId: "u_a", avatarId: "a1" });
    await insights.track("previewed", { userId: "u_a", avatarId: "a2" });
    const steps = Object.fromEntries((await insights.funnel()).map((s) => [s.step, s]));
    expect(steps.signed_up).toMatchObject({ day: 2, week: 2, month: 2 });
    expect(steps.selfie_uploaded.month).toBe(1);
    expect(steps.previewed.month).toBe(1);
    expect(steps.published.month).toBe(0);
    // Steps come back in the order people take them.
    expect((await insights.funnel()).map((s) => s.step)).toEqual([...insights.STEPS]);
    // Something from two months ago is in none of the windows.
    expect(Object.fromEntries((await insights.funnel(Date.now() + 60 * 24 * 60 * 60 * 1000)).map((s) => [s.step, s.month])).signed_up).toBe(0);
  });

  it("still adds up after someone deletes their account", async () => {
    await insights.track("signed_up", { userId: "u_leaving" });
    await insights.track("selfie_uploaded", { userId: "u_leaving", avatarId: "a9" });
    const count = async () => Object.fromEntries((await insights.funnel()).map((s) => [s.step, s.month]));
    const before = await count();
    await insights.forgetUser("u_leaving");
    expect(await count()).toEqual(before);
    const pg = await import("../pg");
    expect(await pg.query("SELECT 1 FROM events WHERE user_id = 'u_leaving'")).toHaveLength(0);
  });

  it("counts builds by how they ended", async () => {
    for (const name of ["build_started", "build_started", "build_started", "build_ready", "build_failed"] as const) await insights.track(name, { avatarId: "a1" });
    expect(await insights.buildCounts()).toEqual({ started: 3, ready: 1, failed: 1 });
  });

  it("keeps what went wrong, newest first", async () => {
    await insights.logError("build", "Rigging returned no character", { route: "a1" });
    await insights.logError("browser", "x".repeat(900), { route: "/create", detail: "stack" });
    const [latest, earlier] = await insights.recentErrors();
    expect(latest).toMatchObject({ source: "browser", route: "/create", detail: "stack" });
    expect(latest.message.length).toBeLessThanOrEqual(501);
    expect(earlier).toMatchObject({ source: "build", message: "Rigging returned no character" });
  });

  it("records a failing route, but not a refusal", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = (await insights.recentErrors()).length;
    const refuse = http.handle<[Request]>(async () => {
      throw new http.HttpError(403, "No access.");
    });
    expect((await refuse(new Request("http://localhost/api/x", { method: "POST" }))).status).toBe(403);
    expect(await insights.recentErrors()).toHaveLength(before);

    const crash = http.handle<[Request]>(async () => {
      throw new Error("database exploded");
    });
    expect((await crash(new Request("http://localhost/api/avatars/abc/selfie", { method: "POST" }))).status).toBe(500);
    const [logged] = await insights.recentErrors();
    expect(logged).toMatchObject({ source: "server", route: "POST /api/avatars/abc/selfie", message: "database exploded" });
    error.mockRestore();
  });
});
