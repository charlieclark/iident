import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

const generateCharacterImage = vi.fn<(p: { engine: string; imageUrls: string[]; prompt: string }) => Promise<string>>();
const generatePortrait = vi.fn<(selfieUrl: string, prompt: string) => Promise<string>>();
vi.mock("../fal", () => ({
  generateCharacterImage: (p: { engine: string; imageUrls: string[]; prompt: string }) => generateCharacterImage(p),
  generatePortrait: (url: string, prompt: string) => generatePortrait(url, prompt),
}));
vi.mock("../storage", async (original) => ({
  ...(await original<typeof import("../storage")>()),
  download: async () => Buffer.from("png"),
}));

describe("starter character", () => {
  let db: typeof import("../db");
  let starter: typeof import("../starter");
  let concepts: typeof import("../concepts");

  beforeAll(async () => {
    await freshDatabase("starter");
    db = await import("../db");
    starter = await import("../starter");
    concepts = await import("../concepts");
  });
  beforeEach(() => {
    generateCharacterImage.mockReset();
    generatePortrait.mockReset();
    generateCharacterImage.mockResolvedValue("https://files.example/character.png");
    generatePortrait.mockResolvedValue("https://files.example/portrait.png");
  });

  const withSelfie = async (file = "selfie-a.jpg") => {
    const { record } = await db.createAvatar();
    await db.updateAvatar(record.id, (r) => {
      r.selfie = { file: `${record.id}/${file}`, url: `https://files.example/${file}` };
    });
    return record.id;
  };

  it("draws the person once, from their portrait and selfie, in the look they start with", async () => {
    const id = await withSelfie();
    const [a, b] = await Promise.all([starter.ensureStarter(id), starter.ensureStarter(id)]);
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBe(a!.id);
    expect(generateCharacterImage).toHaveBeenCalledTimes(1);
    const call = generateCharacterImage.mock.calls[0][0];
    expect(call.engine).toBe("main");
    expect(call.imageUrls).toEqual(["https://files.example/portrait.png", "https://files.example/selfie-a.jpg"]);
    expect(call.prompt).toMatch(/white crew-neck t-shirt/);

    // It is what quick previews are made from, and nothing is left claimed.
    const record = (await db.getAvatar(id))!;
    expect(concepts.sketchBase(record)?.id).toBe(a!.id);
    expect(record.concepts[0]).toMatchObject({ kind: "preview", drawnBy: "main", file: expect.stringMatching(new RegExp(`^${id}/concept-`)) });
    expect(record.selfie!.starterClaimedAt).toBeUndefined();
    // Asking again draws nothing.
    expect((await starter.ensureStarter(id))?.id).toBe(a!.id);
    expect(generateCharacterImage).toHaveBeenCalledTimes(1);
  });

  it("gives up quietly when drawing fails, and tries again the next time", async () => {
    const id = await withSelfie();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateCharacterImage.mockRejectedValueOnce(new Error("model down"));
    expect(await starter.ensureStarter(id)).toBeNull();
    expect((await db.getAvatar(id))!.concepts).toHaveLength(0);
    warn.mockRestore();
    expect((await starter.ensureStarter(id))?.id).toBeTruthy();
  });

  it("does not keep a drawing of a selfie that was replaced meanwhile", async () => {
    const id = await withSelfie("selfie-old.jpg");
    generateCharacterImage.mockImplementation(async () => {
      await db.updateAvatar(id, (r) => {
        r.selfie = { file: `${id}/selfie-new.jpg`, url: "https://files.example/selfie-new.jpg" };
      });
      return "https://files.example/of-old.png";
    });
    expect(await starter.ensureStarter(id)).toBeNull();
    expect((await db.getAvatar(id))!.concepts).toHaveLength(0);
  });

  it("has nothing to draw without a selfie", async () => {
    expect(await starter.ensureStarter((await db.createAvatar()).record.id)).toBeNull();
    expect(generateCharacterImage).not.toHaveBeenCalled();
  });
});
