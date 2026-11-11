import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const generatePortrait = vi.fn<(selfieUrl: string, prompt: string) => Promise<string>>();
vi.mock("../fal", () => ({ generatePortrait: (url: string, prompt: string) => generatePortrait(url, prompt) }));
vi.mock("../storage", async (original) => ({
  ...(await original<typeof import("../storage")>()),
  download: async () => Buffer.from("png"),
}));

describe("clean portrait", () => {
  let db: typeof import("../db");
  let portrait: typeof import("../portrait");

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-portrait-"));
    db = await import("../db");
    portrait = await import("../portrait");
  });
  beforeEach(() => generatePortrait.mockReset());

  const withSelfie = (file = "selfie-a.jpg") => {
    const { record } = db.createAvatar();
    db.updateAvatar(record.id, (r) => {
      r.selfie = { file: `${record.id}/${file}`, url: `https://files.example/${file}` };
    });
    return record.id;
  };

  it("is made once per selfie, even when asked for twice at the same time", async () => {
    const id = withSelfie();
    generatePortrait.mockResolvedValue("https://files.example/portrait.png");
    const [a, b] = await Promise.all([portrait.ensurePortrait(id), portrait.ensurePortrait(id)]);
    expect(a).toBe("https://files.example/portrait.png");
    expect(b).toBe(a);
    expect(generatePortrait).toHaveBeenCalledTimes(1);
    expect(generatePortrait.mock.calls[0][0]).toBe("https://files.example/selfie-a.jpg");
    // Stored with the selfie, so later drawings reuse it.
    expect(db.getAvatar(id)!.selfie!.portrait).toMatchObject({ url: a, file: expect.stringMatching(new RegExp(`^${id}/portrait-`)) });
    await portrait.ensurePortrait(id);
    expect(generatePortrait).toHaveBeenCalledTimes(1);
  });

  it("gives up quietly, so drawing can carry on from the selfie alone", async () => {
    const id = withSelfie();
    generatePortrait.mockRejectedValue(new Error("model down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await portrait.ensurePortrait(id)).toBeNull();
    expect(db.getAvatar(id)!.selfie!.portrait).toBeUndefined();
    warn.mockRestore();
    // And it is tried again next time.
    generatePortrait.mockResolvedValue("https://files.example/second.png");
    expect(await portrait.ensurePortrait(id)).toBe("https://files.example/second.png");
  });

  it("does not attach a portrait to a selfie that replaced the one it was made from", async () => {
    const id = withSelfie("selfie-old.jpg");
    generatePortrait.mockImplementation(async () => {
      db.updateAvatar(id, (r) => {
        r.selfie = { file: `${id}/selfie-new.jpg`, url: "https://files.example/selfie-new.jpg" };
      });
      return "https://files.example/of-old.png";
    });
    await portrait.ensurePortrait(id);
    expect(db.getAvatar(id)!.selfie).toEqual({ file: `${id}/selfie-new.jpg`, url: "https://files.example/selfie-new.jpg" });
  });

  it("has nothing to make without a selfie", async () => {
    expect(await portrait.ensurePortrait(db.createAvatar().record.id)).toBeNull();
    expect(generatePortrait).not.toHaveBeenCalled();
  });
});
