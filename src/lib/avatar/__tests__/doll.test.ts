import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dollFiles, dollLayers, dollWidth } from "../doll";
import { ACCESSORIES, BOTTOMS, BUILDS, DEFAULT_APPEARANCE, FACIAL_HAIR, HAIR_STYLES, OUTERWEAR, OUTFIT_PRESETS, SHOES, TOPS, type Appearance } from "../options";

const look = (over: Partial<Appearance> = {}): Appearance => ({ ...DEFAULT_APPEARANCE, ...over });
const names = (a: Appearance) => dollLayers(a).map((l) => l.src.replace("/doll/", "").replace(".webp", ""));
const onDisk = (src: string) => existsSync(path.join(process.cwd(), "public", src));

describe("the mannequin's pieces", () => {
  it("dresses from the feet up and from the skin out", () => {
    expect(names(look())).toEqual(["shoes/sneakers", "bottom/chinos", "top/tshirt", "outer/denim-jacket"]);
    const full = look({
      hair: { keep: false, style: "long-wavy", color: "blonde" },
      facialHair: "full-beard",
      accessories: ["cap", "glasses-round", "scarf"],
    });
    expect(names(full)).toEqual([
      "shoes/sneakers",
      "bottom/chinos",
      "top/tshirt",
      "outer/denim-jacket",
      "beard/full-beard",
      "hair/long-wavy",
      "extra/scarf",
      "extra/glasses-round",
      "extra/cap",
    ]);
  });

  it("tints each piece in its chosen color", () => {
    const layers = dollLayers(look({ top: { type: "hoodie", color: "red" }, outer: { type: "none", color: "denim" }, hair: { keep: false, style: "bob", color: "blonde" }, facialHair: "mustache" }));
    const tint = (part: string) => layers.find((l) => l.src.includes(part))?.tint;
    expect(tint("top/hoodie")).toMatch(/^#[0-9a-f]{6}$/);
    expect(tint("top/hoodie")).not.toBe(tint("bottom/chinos"));
    // A beard takes the chosen hair color.
    expect(tint("beard/mustache")).toBe(tint("hair/bob"));
    // No layer piece when none is worn.
    expect(layers.some((l) => l.src.includes("/outer/"))).toBe(false);
  });

  it("shows nothing for what is left as in the photo", () => {
    // The mannequin has no hair or beard of its own.
    expect(names(look()).some((n) => n.startsWith("hair/") || n.startsWith("beard/"))).toBe(false);
    expect(names(look({ facialHair: "none" })).some((n) => n.startsWith("beard/"))).toBe(false);
    expect(names(look({ hair: { keep: false, style: "bald", color: "black" } })).some((n) => n.startsWith("hair/"))).toBe(false);
    // A beard picked while the hair is kept still shows, in a neutral dark brown.
    expect(dollLayers(look({ facialHair: "stubble" })).find((l) => l.src.includes("beard/"))?.tint).toBe("#3b2617");
  });

  it("hides what would stick out from under a jacket or a hat", () => {
    const top = (a: Appearance) => dollLayers(a).find((l) => l.src.includes("/top/"))!;
    expect(top(look()).under).toEqual(["/doll/outer/denim-jacket.cover.webp"]);
    expect(top(look({ outer: { type: "none", color: "denim" } })).under).toEqual([]);
    const hair = dollLayers(look({ hair: { keep: false, style: "afro", color: "black" }, accessories: ["beanie", "watch"] })).find((l) => l.src.includes("/hair/"))!;
    expect(hair.under).toEqual(["/doll/extra/beanie.cover.webp"]);
  });

  it("hints at a build by the figure's width", () => {
    expect(dollWidth(look())).toBe(1);
    expect(dollWidth(look({ build: "slim" }))).toBeLessThan(1);
    expect(dollWidth(look({ build: "plus" }))).toBeGreaterThan(dollWidth(look({ build: "broad" })));
    for (const b of BUILDS) expect(dollWidth(look({ build: b.id }))).toBeGreaterThan(0.85);
  });

  it("has a picture for every option there is to pick", () => {
    const missing: string[] = [];
    const need = (src: string) => onDisk(src) || missing.push(src);
    need("/doll/mannequin.webp");
    for (const t of TOPS) need(`/doll/top/${t.id}.webp`);
    for (const b of BOTTOMS) need(`/doll/bottom/${b.id}.webp`);
    for (const s of SHOES) need(`/doll/shoes/${s.id}.webp`);
    for (const o of OUTERWEAR) {
      if (o.id === "none") continue;
      need(`/doll/outer/${o.id}.webp`);
      need(`/doll/outer/${o.id}.cover.webp`);
    }
    for (const h of HAIR_STYLES) if (h.id !== "bald") need(`/doll/hair/${h.id}.webp`);
    for (const f of FACIAL_HAIR) if (f.id !== "keep" && f.id !== "none") need(`/doll/beard/${f.id}.webp`);
    for (const a of ACCESSORIES) need(`/doll/extra/${a.id}.webp`);
    for (const hat of ["cap", "beanie", "bucket-hat"]) need(`/doll/extra/${hat}.cover.webp`);
    expect(missing).toEqual([]);
    // And every look the presets lead to can be drawn from what is there.
    for (const preset of OUTFIT_PRESETS) for (const src of dollFiles(look(preset.outfit))) expect(onDisk(src), src).toBe(true);
  });

  it("gives every accessory a color", () => {
    for (const a of ACCESSORIES) {
      const layer = dollLayers(look({ accessories: [a.id] })).find((l) => l.src.includes(`/extra/${a.id}.`));
      expect(layer?.tint, a.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
