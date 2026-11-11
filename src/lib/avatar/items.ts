import { ACCESSORIES, BOTTOMS, BUILDS, COLORS, FACIAL_HAIR, HAIR_COLORS, HAIR_STYLES, HEIGHTS, OUTERWEAR, SHOES, TOPS, type Appearance } from "./options";

/**
 * The look as a loadout: a handful of slots (hair, top, shoes, ...) and the
 * item sitting in each.
 *
 * Every item has one ready-made picture, drawn in white (public/items, made
 * by scripts/items/build.mjs). The browser tints it in whatever color is
 * chosen, so choosing shows the real item at once and no image model runs
 * until the person asks to see the loadout on themselves.
 */

/** The kinds of item picture there are, which is also the folder each lives in. */
export type ItemKind = "hair" | "beard" | "top" | "outer" | "bottom" | "shoes" | "extra";

export type ItemPicture = {
  /** The item in white with its shading, transparent elsewhere. */
  src: string;
  /** What it is shown on, for items that mean little alone (a beard, glasses). */
  base?: string;
  /** The color it is tinted in. */
  tint: string;
};

const ON_MANNEQUIN: ReadonlySet<ItemKind> = new Set(["hair", "beard", "extra"]);

export function itemPicture(kind: ItemKind, id: string, tint: string): ItemPicture {
  return { src: `/items/${kind}/${id}.webp`, tint, ...(ON_MANNEQUIN.has(kind) ? { base: `/items/${kind}/${id}.base.webp` } : {}) };
}

/** The bare head, for "bald" and "clean-shaven". */
export const HEAD_PICTURE = "/items/beard/mustache.base.webp";

/** Accessories come in one color each. */
export const EXTRA_TINTS: Record<Appearance["accessories"][number], string> = {
  "glasses-round": "#26262a",
  "glasses-square": "#26262a",
  sunglasses: "#17171a",
  cap: "#2f4b7c",
  beanie: "#6b6f76",
  "bucket-hat": "#c9b78f",
  headphones: "#1f1f22",
  "earrings-studs": "#c9a227",
  "earrings-hoops": "#c9a227",
  necklace: "#c9a227",
  watch: "#2e3035",
  scarf: "#b23a48",
};

const hex = (colors: readonly { id: string; hex: string }[], id: string) => colors.find((c) => c.id === id)?.hex ?? "#888888";
export const colorHex = (id: string) => hex(COLORS, id);
/** The chosen hair color; a neutral dark brown while the hair is kept as in the photo. */
export const hairHex = (a: Appearance) => (a.hair.keep ? "#3b2617" : hex(HAIR_COLORS, a.hair.color));

export type Slot = "hair" | "beard" | "top" | "outer" | "bottom" | "shoes" | "extras" | "body";

export const SLOTS: { id: Slot; label: string }[] = [
  { id: "hair", label: "Hair" },
  { id: "beard", label: "Face" },
  { id: "top", label: "Top" },
  { id: "outer", label: "Layer" },
  { id: "bottom", label: "Bottom" },
  { id: "shoes", label: "Shoes" },
  { id: "extras", label: "Extras" },
  { id: "body", label: "Body" },
];

/** What a slot holds, for its tile in the loadout. */
export type SlotView = {
  /** What is in it, in words. */
  name: string;
  /** The item's picture; several for accessories. */
  pictures: ItemPicture[];
  /** A bare head stands in for "bald" and "clean-shaven". */
  head?: boolean;
  /** Kept as in the person's photo: the tile shows the photo. */
  fromPhoto?: boolean;
  /** Nothing is worn here. */
  empty?: boolean;
};

const label = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;

export function slotView(a: Appearance, slot: Slot): SlotView {
  switch (slot) {
    case "hair":
      if (a.hair.keep) return { name: "As in photo", pictures: [], fromPhoto: true };
      if (a.hair.style === "bald") return { name: "Bald", pictures: [], head: true };
      return { name: label(HAIR_STYLES, a.hair.style), pictures: [itemPicture("hair", a.hair.style, hairHex(a))] };
    case "beard":
      if (a.facialHair === "keep") return { name: "As in photo", pictures: [], fromPhoto: true };
      if (a.facialHair === "none") return { name: "Clean-shaven", pictures: [], head: true };
      return { name: label(FACIAL_HAIR, a.facialHair), pictures: [itemPicture("beard", a.facialHair, hairHex(a))] };
    case "top":
      return { name: label(TOPS, a.top.type), pictures: [itemPicture("top", a.top.type, colorHex(a.top.color))] };
    case "outer":
      if (a.outer.type === "none") return { name: "None", pictures: [], empty: true };
      return { name: label(OUTERWEAR, a.outer.type), pictures: [itemPicture("outer", a.outer.type, colorHex(a.outer.color))] };
    case "bottom":
      return { name: label(BOTTOMS, a.bottom.type), pictures: [itemPicture("bottom", a.bottom.type, colorHex(a.bottom.color))] };
    case "shoes":
      return { name: label(SHOES, a.shoes.type), pictures: [itemPicture("shoes", a.shoes.type, colorHex(a.shoes.color))] };
    case "extras":
      if (!a.accessories.length) return { name: a.extras.trim() ? "A detail" : "None", pictures: [], empty: true };
      return {
        name: a.accessories.length === 1 ? label(ACCESSORIES, a.accessories[0]) : `${a.accessories.length} items`,
        pictures: a.accessories.map((id) => itemPicture("extra", id, EXTRA_TINTS[id])),
      };
    case "body":
      return { name: `${label(BUILDS, a.build)}, ${label(HEIGHTS, a.height).toLowerCase()}`, pictures: [] };
  }
}
