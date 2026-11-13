import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

const dropped = vi.fn<(tag: string) => Promise<void>>(async () => {});
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: (tag: string) => dropped(tag) }));

describe("deleting", () => {
  let db: typeof import("../db");
  let auth: typeof import("../auth");
  let removal: typeof import("../removal");
  let storage: typeof import("../storage");
  let billing: typeof import("../billing");
  let insights: typeof import("../insights");
  let pg: typeof import("../pg");

  beforeAll(async () => {
    await freshDatabase("removal");
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    db = await import("../db");
    auth = await import("../auth");
    removal = await import("../removal");
    storage = await import("../storage");
    billing = await import("../billing");
    insights = await import("../insights");
    pg = await import("../pg");
  });
  afterEach(() => vi.unstubAllGlobals());

  let n = 0;
  const newUser = async () => (await auth.consumeLoginToken((await auth.createLoginToken(`gone${++n}@example.com`))!))!;
  /** An avatar with a selfie and a model on disk. */
  async function avatarWithFiles(ownerId?: string) {
    const { record } = await db.createAvatar(ownerId);
    const selfie = await storage.putFile(record.id, "selfie-1.jpg", Buffer.from("face"));
    const model = await storage.putFile(record.id, "model-1.glb", Buffer.from("glb"));
    await db.updateAvatar(record.id, (r) => {
      r.selfie = { file: selfie, url: "https://files.example/selfie.jpg" };
      r.slug = `gone-${record.id.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      r.published = true;
    });
    return { id: record.id, selfie, model, slug: (await db.getAvatar(record.id))!.slug! };
  }

  it("removes an avatar with every file stored for it", async () => {
    const a = await avatarWithFiles();
    const other = await avatarWithFiles();
    expect(await removal.deleteAvatar(a.id)).toBe(true);
    expect(await db.getAvatar(a.id)).toBeNull();
    expect(await db.getAvatarBySlug(a.slug)).toBeNull();
    expect(await storage.getFile(a.selfie)).toBeNull();
    expect(await storage.getFile(a.model)).toBeNull();
    // The CDN's copies of its public files (the 3D model) are dropped too.
    expect(dropped).toHaveBeenCalledWith(`avatar-${a.id}`);
    expect(dropped).not.toHaveBeenCalledWith(`avatar-${other.id}`);
    // Nobody else's files are touched, and deleting twice is harmless.
    expect((await storage.getFile(other.selfie))?.data.toString()).toBe("face");
    expect(await removal.deleteAvatar(a.id)).toBe(false);
  });

  it("removes an account with its avatars, sessions and plan", async () => {
    const user = await newUser();
    const cookie = await auth.startSession(user.id);
    const mine = await avatarWithFiles(user.id);
    const someoneElses = await avatarWithFiles();
    // The account has a plan, which has to be ended at Stripe.
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      const body = url.includes("checkout/sessions/")
        ? { id: "cs_test_12345678", status: "complete", client_reference_id: user.id, customer: "cus_1", subscription: { id: "sub_9", status: "active", customer: "cus_1", metadata: { plan: "creator" }, items: { data: [{}] } } }
        : { id: "sub_9", status: "canceled" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await billing.confirmCheckout(user, "cs_test_12345678");
    await insights.track("selfie_uploaded", { userId: user.id, avatarId: mine.id });

    expect(await removal.deleteAccount(user)).toEqual({ avatars: 1, cancelled: true });
    expect(calls).toContain("DELETE /v1/subscriptions/sub_9");
    expect(await auth.userById(user.id)).toBeNull();
    expect(await auth.sessionUser(new Request("http://localhost/x", { headers: { cookie: cookie.split(";")[0] } }))).toBeNull();
    expect(await db.getAvatar(mine.id)).toBeNull();
    expect(await storage.getFile(mine.selfie)).toBeNull();
    expect(await db.getAvatar(someoneElses.id)).not.toBeNull();
    // What they did is still counted, but no longer tied to them.
    expect(await pg.query("SELECT 1 FROM events WHERE user_id = $1", [user.id])).toHaveLength(0);
    expect((await pg.query("SELECT 1 FROM events WHERE avatar_id = $1", [mine.id])).length).toBeGreaterThan(0);
    // The same email can start again from nothing.
    const again = (await auth.consumeLoginToken((await auth.createLoginToken(user.email))!))!;
    expect(again.id).not.toBe(user.id);
    expect(await billing.planOf(again)).toBe("free");
  });

  it("doesn't keep a picture that arrives after its avatar was deleted", async () => {
    const { saveFile } = await import("../avatarFiles");
    const mine = await avatarWithFiles();
    // A drawing still under way when the avatar is deleted...
    await removal.deleteAvatar(mine.id);
    // ...finishes afterwards, and is thrown away rather than stored.
    await expect(saveFile(mine.id, "portrait-late.png", Buffer.from("face"))).rejects.toThrow(/deleted/);
    expect(await storage.getFile(`${mine.id}/portrait-late.png`)).toBeNull();
    // For an avatar that exists it is simply stored.
    const other = await avatarWithFiles();
    const key = await saveFile(other.id, "portrait-1.png", Buffer.from("face"));
    expect(await storage.getFile(key)).not.toBeNull();
  });

  it("keeps the account if its plan can't be ended, so nobody pays for an account that is gone", async () => {
    const user = await newUser();
    const mine = await avatarWithFiles(user.id);
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("checkout/sessions/")) {
        return new Response(JSON.stringify({ id: "cs_test_22345678", status: "complete", client_reference_id: user.id, customer: "cus_2", subscription: { id: "sub_x", status: "active", customer: "cus_2", metadata: { plan: "pro" }, items: { data: [{}] } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 });
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await billing.confirmCheckout(user, "cs_test_22345678");
    await expect(removal.deleteAccount(user)).rejects.toMatchObject({ status: 502 });
    error.mockRestore();
    expect(await auth.userById(user.id)).not.toBeNull();
    expect(await db.getAvatar(mine.id)).not.toBeNull();
    expect(await billing.planOf(user)).toBe("pro");
  });
});
