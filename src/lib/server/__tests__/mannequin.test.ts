import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, buildMannequinPrompt, type Appearance } from "@/lib/avatar/options";
import { freshDatabase } from "../../../../test/database";

const generateMannequinSketch = vi.fn<(mannequin: string, prompt: string) => Promise<string>>();
vi.mock("../fal", () => ({ generateMannequinSketch: (m: string, p: string) => generateMannequinSketch(m, p) }));
vi.mock("../storage", async (original) => ({
  ...(await original<typeof import("../storage")>()),
  download: async () => Buffer.from("jpeg bytes"),
}));

const look = (over: Partial<Appearance> = {}): Appearance => ({ ...DEFAULT_APPEARANCE, ...over });

describe("looks on the mannequin", () => {
  let mannequin: typeof import("../mannequin");
  let storage: typeof import("../storage");

  beforeAll(async () => {
    await freshDatabase("mannequin");
    mannequin = await import("../mannequin");
    storage = await import("../storage");
  });
  beforeEach(() => {
    generateMannequinSketch.mockReset();
    generateMannequinSketch.mockResolvedValue("https://fal.example/dressed.jpg");
  });

  it("draws a look once and shares the picture with everyone after", async () => {
    const hoodie = look({ top: { type: "hoodie", color: "red" } });
    const first = await mannequin.mannequinSketch(hoodie);
    expect(first.file).toMatch(/^shared\/mannequin-[0-9a-f]{32}\.jpg$/);
    // Drawn just now: the picture comes back with it.
    expect(first.image?.toString()).toBe("jpeg bytes");
    expect((await storage.getFile(first.file))?.data.toString()).toBe("jpeg bytes");
    // The model is given the mannequin itself and the look in words.
    const [picture, prompt] = generateMannequinSketch.mock.calls[0];
    expect(picture).toMatch(/^data:image\/jpeg;base64,/);
    expect(prompt).toBe(buildMannequinPrompt(hoodie));

    // Anyone asking for the same look later only looks it up.
    const again = await mannequin.mannequinSketch(look({ top: { type: "hoodie", color: "red" } }));
    expect(again).toEqual({ file: first.file });
    expect(generateMannequinSketch).toHaveBeenCalledTimes(1);
  });

  it("draws a new look once when it is asked for twice at the same moment", async () => {
    const jersey = look({ top: { type: "jersey", color: "royal" } });
    const [a, b] = await Promise.all([mannequin.mannequinSketch(jersey), mannequin.mannequinSketch(jersey)]);
    expect(a.file).toBe(b.file);
    expect(generateMannequinSketch).toHaveBeenCalledTimes(1);
  });

  it("files looks by what the mannequin can show", () => {
    const key = mannequin.mannequinKey;
    const base = look();
    // The mannequin has no face, no height and no hair of its own.
    expect(key(look({ height: "tall" }))).toBe(key(base));
    expect(key(look({ facialHair: "full-beard" }))).toBe(key(base));
    expect(key(look({ hair: { keep: true, style: "long-wavy", color: "blonde" } }))).toBe(key(base));
    // A layer that isn't worn has no color, and the order accessories were picked in doesn't matter.
    expect(key(look({ outer: { type: "none", color: "red" } }))).toBe(key(look({ outer: { type: "none", color: "black" } })));
    expect(key(look({ accessories: ["cap", "watch"] }))).toBe(key(look({ accessories: ["watch", "cap"] })));
    // What it can show makes a different picture.
    for (const other of [
      look({ top: { type: "tshirt", color: "black" } }),
      look({ shoes: { type: "boots", color: "white" } }),
      look({ accessories: ["cap"] }),
      look({ build: "athletic" }),
      look({ hair: { keep: false, style: "long-wavy", color: "blonde" } }),
      look({ extras: "a small enamel cat pin" }),
    ]) {
      expect(key(other)).not.toBe(key(base));
    }
  });

  it("asks for plain clothes on the same faceless mannequin", () => {
    const prompt = buildMannequinPrompt(look({ top: { type: "hoodie", color: "red" }, outer: { type: "none", color: "denim" }, accessories: ["cap"] }));
    expect(prompt).toMatch(/^Dress this mannequin\. It stays the same featureless light gray mannequin/);
    expect(prompt).toMatch(/Outfit: a red pullover hoodie, beige chino trousers and white sneakers\./);
    expect(prompt).toMatch(/Accessories: a .*cap/);
    expect(prompt).toMatch(/no logos, brand marks or lettering/);
    // Nothing about the person: no face, no age, no selfie.
    expect(prompt).not.toMatch(/person|selfie|Facial hair|Expression/i);
  });
});
