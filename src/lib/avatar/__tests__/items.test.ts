import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXTRA_TINTS, HEAD_PICTURE, SLOTS, itemPicture, slotView, type ItemPicture } from "../items";
import { ACCESSORIES, BOTTOMS, DEFAULT_APPEARANCE, FACIAL_HAIR, HAIR_STYLES, OUTERWEAR, SHOES, TOPS, type Appearance } from "../options";

const look = (over: Partial<Appearance> = {}): Appearance => ({ ...DEFAULT_APPEARANCE, ...over });
const onDisk = (src: string) => existsSync(path.join(process.cwd(), "public", src));

describe("the loadout", () => {
  it("has a slot for everything there is to choose", () => {
    expect(SLOTS.map((s) => s.id)).toEqual(["hair", "beard", "top", "outer", "bottom", "shoes", "extras", "body"]);
  });

  it("shows each slot's item in its chosen color", () => {
    const a = look({ top: { type: "hoodie", color: "red" }, shoes: { type: "boots", color: "black" } });
    expect(slotView(a, "top")).toMatchObject({ name: "Hoodie", pictures: [{ src: "/items/top/hoodie.webp" }] });
    expect(slotView(a, "top").pictures[0].tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(slotView(a, "top").pictures[0].tint).not.toBe(slotView(a, "shoes").pictures[0].tint);
    expect(slotView(a, "shoes")).toMatchObject({ name: "Boots", pictures: [{ src: "/items/shoes/boots.webp" }] });
    // Clothes are shown alone; nothing to sit on.
    expect(slotView(a, "top").pictures[0].base).toBeUndefined();
  });

  it("shows the photo for what is kept as in the photo, and a bare head for none", () => {
    expect(slotView(look(), "hair")).toMatchObject({ name: "As in photo", fromPhoto: true, pictures: [] });
    expect(slotView(look(), "beard")).toMatchObject({ fromPhoto: true });
    expect(slotView(look({ hair: { keep: false, style: "bald", color: "black" } }), "hair")).toMatchObject({ name: "Bald", head: true });
    expect(slotView(look({ facialHair: "none" }), "beard")).toMatchObject({ name: "Clean-shaven", head: true });
    // A picked hairstyle or beard sits on the mannequin's head, in the hair color.
    const hair = slotView(look({ hair: { keep: false, style: "bob", color: "blonde" }, facialHair: "mustache" }), "hair").pictures[0];
    const beard = slotView(look({ hair: { keep: false, style: "bob", color: "blonde" }, facialHair: "mustache" }), "beard").pictures[0];
    expect(hair).toMatchObject({ src: "/items/hair/bob.webp", base: "/items/hair/bob.base.webp" });
    expect(beard.tint).toBe(hair.tint);
  });

  it("marks empty slots and counts accessories", () => {
    expect(slotView(look({ outer: { type: "none", color: "denim" } }), "outer")).toMatchObject({ name: "None", empty: true });
    expect(slotView(look(), "extras")).toMatchObject({ name: "None", empty: true });
    expect(slotView(look({ extras: "a small pin" }), "extras").name).toBe("A detail");
    expect(slotView(look({ accessories: ["cap"] }), "extras")).toMatchObject({ name: "Cap", pictures: [{ src: "/items/extra/cap.webp" }] });
    const three = slotView(look({ accessories: ["cap", "watch", "scarf"] }), "extras");
    expect(three.name).toBe("3 items");
    expect(three.pictures).toHaveLength(3);
    expect(slotView(look({ build: "athletic", height: "tall" }), "body").name).toBe("Athletic, taller");
  });

  it("has a picture for every option there is to pick", () => {
    const missing: string[] = [];
    const need = (p: ItemPicture) => {
      for (const src of [p.src, ...(p.base ? [p.base] : [])]) if (!onDisk(src)) missing.push(src);
    };
    for (const t of TOPS) need(itemPicture("top", t.id, "#ffffff"));
    for (const b of BOTTOMS) need(itemPicture("bottom", b.id, "#ffffff"));
    for (const s of SHOES) need(itemPicture("shoes", s.id, "#ffffff"));
    for (const o of OUTERWEAR) if (o.id !== "none") need(itemPicture("outer", o.id, "#ffffff"));
    for (const h of HAIR_STYLES) if (h.id !== "bald") need(itemPicture("hair", h.id, "#ffffff"));
    for (const f of FACIAL_HAIR) if (f.id !== "keep" && f.id !== "none") need(itemPicture("beard", f.id, "#ffffff"));
    for (const a of ACCESSORIES) need(itemPicture("extra", a.id, EXTRA_TINTS[a.id]));
    expect(missing).toEqual([]);
    expect(onDisk(HEAD_PICTURE)).toBe(true);
  });

  it("gives every accessory a color", () => {
    for (const a of ACCESSORIES) expect(EXTRA_TINTS[a.id], a.id).toMatch(/^#[0-9a-f]{6}$/);
  });
});
