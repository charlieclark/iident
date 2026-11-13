import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

// The 3D service: each step is submitted once and collected when it is done.
const fal = {
  submitMesh: vi.fn<(imageUrl: string, webhookUrl?: string) => Promise<string>>(),
  meshResult: vi.fn<(requestId: string) => Promise<{ glbUrl: string } | null>>(),
  submitRig: vi.fn<(params: { glbUrl: string; heightMeters: number }, webhookUrl?: string) => Promise<string>>(),
  rigResult: vi.fn<(requestId: string) => Promise<{ riggedGlbUrl: string; clips: { name: string; glbUrl: string }[] } | null>>(),
};
vi.mock("../fal", () => ({
  submitMesh: (...a: Parameters<typeof fal.submitMesh>) => fal.submitMesh(...a),
  meshResult: (...a: Parameters<typeof fal.meshResult>) => fal.meshResult(...a),
  submitRig: (...a: Parameters<typeof fal.submitRig>) => fal.submitRig(...a),
  rigResult: (...a: Parameters<typeof fal.rigResult>) => fal.rigResult(...a),
}));
const mergeCharacter = vi.fn(async () => ({ glb: new Uint8Array([1, 2, 3]), clips: ["idle", "wave"] }));
vi.mock("../glb", () => ({ mergeCharacter: () => mergeCharacter() }));
vi.mock("../storage", async (original) => ({
  ...(await original<typeof import("../storage")>()),
  download: async () => Buffer.from("glb"),
}));

describe("3D build", () => {
  let db: typeof import("../db");
  let jobs: typeof import("../jobs");
  let config: typeof import("../config").config;

  beforeAll(async () => {
    await freshDatabase("jobs");
    db = await import("../db");
    jobs = await import("../jobs");
    ({ config } = await import("../config"));
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const f of Object.values(fal)) f.mockReset();
    mergeCharacter.mockClear();
    fal.submitMesh.mockResolvedValue("req-mesh");
    fal.submitRig.mockResolvedValue("req-rig");
    fal.meshResult.mockResolvedValue(null);
    fal.rigResult.mockResolvedValue(null);
    config.appUrl = "http://localhost:3000";
  });

  const rigged = { riggedGlbUrl: "https://fal.example/rigged.glb", clips: [{ name: "idle", glbUrl: "https://fal.example/idle.glb" }] };
  /** A draft with one final character image, ready to build. */
  async function draft() {
    const { record } = await db.createAvatar();
    await db.updateAvatar(record.id, (r) => {
      r.concepts = [{ id: "c1", url: "https://fal.example/character.png", file: `${record.id}/concept-c1.png`, prompt: "", kind: "final", createdAt: 1 }];
    });
    return record.id;
  }
  const load = async (id: string) => (await db.getAvatar(id))!;
  const advance = async (id: string) => jobs.advanceModelJob(await load(id));

  it("goes from the character image to a stored model, one short step at a time", async () => {
    const id = await draft();
    const started = await jobs.startModelJob(id, "c1", 1.7);
    expect(started.record.model).toMatchObject({ status: "sculpting", requests: { mesh: "req-mesh" } });
    expect(fal.submitMesh).toHaveBeenCalledWith("https://fal.example/character.png", undefined);

    // Still sculpting: nothing changes, and nothing is written.
    const before = (await load(id)).updatedAt;
    expect((await advance(id)).record.model!.status).toBe("sculpting");
    expect((await load(id)).updatedAt).toBe(before);

    fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
    expect((await advance(id)).record.model).toMatchObject({ status: "rigging", sources: { mesh: "https://fal.example/mesh.glb" }, requests: { mesh: "req-mesh", rig: "req-rig" } });
    expect(fal.submitRig).toHaveBeenCalledWith({ glbUrl: "https://fal.example/mesh.glb", heightMeters: 1.7 }, undefined);

    fal.rigResult.mockResolvedValue(rigged);
    const last = await advance(id);
    expect(last.record.model!.status).toBe("finishing");
    expect(last.finish).toBeTypeOf("function");
    // While the model is being put together, other calls leave it alone.
    expect((await advance(id)).finish).toBeUndefined();

    await last.finish!();
    const model = (await load(id)).model!;
    expect(model).toMatchObject({ status: "ready", clips: ["idle", "wave"], file: expect.stringMatching(new RegExp(`^${id}/model-.*\\.glb$`)) });
    expect(model.lease).toBeUndefined();
    expect(mergeCharacter).toHaveBeenCalledTimes(1);
    expect(fal.submitMesh).toHaveBeenCalledTimes(1);
    expect(fal.submitRig).toHaveBeenCalledTimes(1);
  });

  it("submits each step once when several calls arrive together", async () => {
    const id = await draft();
    await jobs.startModelJob(id, "c1", 1.7);
    fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
    const record = await load(id);
    // The creator's poll, the account page and the webhook can all notice a finished step at once.
    await Promise.all([jobs.advanceModelJob(record), jobs.advanceModelJob(record), jobs.advanceModelJob(record)]);
    expect(fal.submitRig).toHaveBeenCalledTimes(1);
    expect((await load(id)).model!.status).toBe("rigging");

    fal.rigResult.mockResolvedValue(rigged);
    const again = await load(id);
    const results = await Promise.all([jobs.advanceModelJob(again), jobs.advanceModelJob(again), jobs.advanceModelJob(again)]);
    expect(results.filter((r) => r.finish)).toHaveLength(1);
  });

  it("emails the owner when the build ends, since they may have closed the page", async () => {
    const auth = await import("../auth");
    const owner = (await auth.consumeLoginToken((await auth.createLoginToken("builder@example.com"))!))!;
    const sent: { to: string[]; subject: string; text: string }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    });
    config.email.resendKey = "re_placeholder";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const owned = async () => {
        const { record } = await db.createAvatar(owner.id);
        await db.updateAvatar(record.id, (r) => {
          r.persona.name = "Marco";
          r.concepts = [{ id: "c1", url: "https://fal.example/character.png", file: `${record.id}/concept-c1.png`, prompt: "", kind: "final", createdAt: 1 }];
        });
        return record.id;
      };
      const good = await owned();
      await jobs.startModelJob(good, "c1", 1.7);
      fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
      await advance(good);
      fal.rigResult.mockResolvedValue(rigged);
      await (await advance(good)).finish!();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: ["builder@example.com"], subject: "Marco is ready" });
      expect(sent[0].text).toContain(`http://localhost:3000/create?id=${good}`);
      // Looking at it again sends nothing more.
      await advance(good);
      expect(sent).toHaveLength(1);

      const bad = await owned();
      await jobs.startModelJob(bad, "c1", 1.7);
      fal.meshResult.mockRejectedValue(Object.assign(new Error("Unprocessable"), { status: 422, body: { detail: "No person found." } }));
      expect((await advance(bad)).record.model!.status).toBe("failed");
      await advance(bad);
      expect(sent).toHaveLength(2);
      expect(sent[1].to).toEqual(["builder@example.com"]);
      expect(sent[1].text).toContain(`http://localhost:3000/create?id=${bad}`);

      // An email that can't be sent doesn't undo the build.
      vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const third = await owned();
      await jobs.startModelJob(third, "c1", 1.7);
      fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
      await advance(third);
      await (await advance(third)).finish!();
      expect((await load(third)).model!.status).toBe("ready");
      warn.mockRestore();
    } finally {
      config.email.resendKey = undefined;
      vi.unstubAllGlobals();
      error.mockRestore();
    }
  });

  it("refuses a second build while one is under way", async () => {
    const id = await draft();
    await jobs.startModelJob(id, "c1", 1.7);
    await expect(jobs.startModelJob(id, "c1", 1.7)).rejects.toMatchObject({ status: 409 });
    await expect(jobs.startModelJob(id, "nope", 1.7)).rejects.toMatchObject({ status: 404 });
    expect(fal.submitMesh).toHaveBeenCalledTimes(1);
  });

  it("fails with the 3D service's reason, and a retry reuses the mesh", async () => {
    const id = await draft();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await jobs.startModelJob(id, "c1", 1.7);
    fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
    await advance(id);
    fal.rigResult.mockRejectedValue(Object.assign(new Error("Unprocessable"), { status: 422, body: { detail: "Could not find a humanoid in this model." } }));
    expect((await advance(id)).record.model).toMatchObject({ status: "failed", error: "Could not find a humanoid in this model." });

    fal.rigResult.mockResolvedValue(null);
    const retry = await jobs.startModelJob(id, "c1", 1.7);
    expect(retry.record.model).toMatchObject({ status: "rigging", meshReused: true });
    expect(fal.submitMesh).toHaveBeenCalledTimes(1);
    expect(fal.submitRig).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("keeps going after a passing error, and gives up on a step that never finishes", async () => {
    const id = await draft();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await jobs.startModelJob(id, "c1", 1.7);
    fal.meshResult.mockRejectedValueOnce(new Error("fetch failed"));
    expect((await advance(id)).record.model!.status).toBe("sculpting");
    expect((await advance(id)).record.model!.status).toBe("sculpting");

    const later = Date.now() + 26 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect((await advance(id)).record.model).toMatchObject({ status: "failed", error: expect.stringMatching(/took too long/) });
    error.mockRestore();
  });

  it("starts the final merge again if it was cut short, a limited number of times", async () => {
    const id = await draft();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await jobs.startModelJob(id, "c1", 1.7);
    fal.meshResult.mockResolvedValue({ glbUrl: "https://fal.example/mesh.glb" });
    await advance(id);
    fal.rigResult.mockResolvedValue(rigged);

    mergeCharacter.mockRejectedValue(new Error("out of memory"));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const step = await advance(id);
      expect(step.record.model).toMatchObject({ status: "finishing", finishAttempts: attempt });
      await step.finish!();
    }
    expect((await advance(id)).record.model).toMatchObject({ status: "failed" });
    error.mockRestore();
  });

  it("asks the 3D service to call back when the site has a public address", async () => {
    const id = await draft();
    config.appUrl = "https://twiins.example";
    const { record } = await jobs.startModelJob(id, "c1", 1.7);
    const hook = fal.submitMesh.mock.calls[0][1]!;
    expect(hook).toBe(`https://twiins.example/api/fal/webhook?avatar=${id}&key=${record.model!.hookKey}`);
    expect(record.model!.hookKey).toMatch(/^[\w-]{20,}$/);
  });
});
