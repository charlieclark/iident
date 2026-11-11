import { COLORS, HAIR_COLORS, type Appearance } from "./options";

/**
 * Trying a look on the mannequin.
 *
 * Before someone has a character of their own, their choices are shown on a
 * mannequin dressed from ready-made pieces: one picture per option, each the
 * garment alone in white (public/doll, made by scripts/doll/build.mjs). The
 * browser lays the pieces over the mannequin and tints each in its color, so
 * a change shows at once and no image model runs.
 *
 * This file decides which pieces a look is made of, in which order and in
 * which colors; `Doll.tsx` draws them.
 */

export const DOLL = { width: 576, height: 1032, mannequin: "/doll/mannequin.webp" };

export type DollLayer = {
  /** The piece: white cloth with its shading, transparent elsewhere. */
  src: string;
  /** The color it is tinted in. */
  tint: string;
  /** Pieces worn over this one that hide where it would stick out: a hoodie's sleeves under a jacket, hair under a hat. */
  under: string[];
};

const piece = (slot: string, id: string) => `/doll/${slot}/${id}.webp`;
const cover = (slot: string, id: string) => `/doll/${slot}/${id}.cover.webp`;
const hex = (colors: readonly { id: string; hex: string }[], id: string) => colors.find((c) => c.id === id)?.hex ?? "#888888";

/** Accessories come in one color each. */
const EXTRAS: Record<string, string> = {
  scarf: "#b23a48",
  necklace: "#c9a227",
  watch: "#2e3035",
  headphones: "#1f1f22",
  "earrings-studs": "#c9a227",
  "earrings-hoops": "#c9a227",
  "glasses-round": "#26262a",
  "glasses-square": "#26262a",
  sunglasses: "#17171a",
  cap: "#2f4b7c",
  beanie: "#6b6f76",
  "bucket-hat": "#c9b78f",
};
/** Drawn in this order, hats last. */
const EXTRA_ORDER = Object.keys(EXTRAS);
const HATS = new Set(["cap", "beanie", "bucket-hat"]);
/** A beard is shown in the chosen hair color, or in this when the hair is kept as in the photo. */
const DEFAULT_HAIR = "#3b2617";
const BEARDS = new Set(["stubble", "short-beard", "full-beard", "mustache"]);

/** The pieces a look is made of, from the feet up and from the skin out. */
export function dollLayers(a: Appearance): DollLayer[] {
  const layers: DollLayer[] = [];
  const add = (slot: string, id: string, tint: string, under: string[] = []) => layers.push({ src: piece(slot, id), tint, under });
  add("shoes", a.shoes.type, hex(COLORS, a.shoes.color));
  add("bottom", a.bottom.type, hex(COLORS, a.bottom.color));
  const layered = a.outer.type !== "none";
  add("top", a.top.type, hex(COLORS, a.top.color), layered ? [cover("outer", a.outer.type)] : []);
  if (layered) add("outer", a.outer.type, hex(COLORS, a.outer.color));
  // "As in the photo" has nothing to show yet: the mannequin has no hair or beard of its own.
  const hairColor = a.hair.keep ? DEFAULT_HAIR : hex(HAIR_COLORS, a.hair.color);
  if (BEARDS.has(a.facialHair)) add("beard", a.facialHair, hairColor);
  const hats = a.accessories.filter((id) => HATS.has(id));
  if (!a.hair.keep && a.hair.style !== "bald") add("hair", a.hair.style, hairColor, hats.map((id) => cover("extra", id)));
  for (const id of EXTRA_ORDER) if (a.accessories.includes(id as Appearance["accessories"][number])) add("extra", id, EXTRAS[id]);
  return layers;
}

/** How much wider or narrower than the mannequin a build is shown. A hint, not a likeness: the character is drawn to the real build. */
export function dollWidth(a: Appearance): number {
  return { slim: 0.93, average: 1, athletic: 1.02, curvy: 1.04, broad: 1.08, plus: 1.14 }[a.build] ?? 1;
}

/** Every picture a look needs, for loading. */
export function dollFiles(a: Appearance): string[] {
  return [DOLL.mannequin, ...dollLayers(a).flatMap((l) => [l.src, ...l.under])];
}
