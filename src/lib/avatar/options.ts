import { z } from "zod";

/**
 * Character customization model.
 *
 * Every choice the creator makes maps to a short, concrete prompt fragment.
 * `buildConceptPrompt` assembles them into a single instruction for the image
 * model, which turns the selfie into a full-body character sheet. That image
 * is then converted to a rigged 3D model, so the prompt also enforces the
 * things the 3D and rigging steps need (A-pose, closed mouth, plain
 * background, nothing held in the hands).
 */

/**
 * The one look every iident character shares: an animated film character
 * with natural proportions. This is the look the product started with.
 * Later looks traded it for a higher measured face likeness and ended up
 * with a near-photographic face (uncomfortable on a stylized body, and
 * creepy on a realistic head); see docs/character-pipeline.md.
 */
export const STYLE_ID = "animated-2";

export const HOUSE_STYLE =
  "a modern animated feature film (stylized but grounded proportions, soft clean shading, appealing friendly design)";

/** Stated outright because image models like to enlarge the head of a stylized character. */
const PROPORTIONS = "Natural adult body proportions with a normal-sized head, about seven and a half heads tall.";

export const BUILDS = [
  { id: "slim", label: "Slim", prompt: "slim, slender build" },
  { id: "average", label: "Average", prompt: "average build" },
  { id: "athletic", label: "Athletic", prompt: "athletic, toned build" },
  { id: "curvy", label: "Curvy", prompt: "curvy build with fuller hips and bust" },
  { id: "broad", label: "Broad", prompt: "broad-shouldered, sturdy build" },
  { id: "plus", label: "Plus-size", prompt: "plus-size, fuller figure with a soft rounded body" },
] as const;

export const HEIGHTS = [
  { id: "petite", label: "Shorter", prompt: "shorter than average", meters: 1.6 },
  { id: "average", label: "Average", prompt: "average height", meters: 1.72 },
  { id: "tall", label: "Taller", prompt: "taller than average with long legs", meters: 1.86 },
] as const;

/** `{c}` is replaced with the chosen hair color name. */
export const HAIR_STYLES = [
  { id: "short-crop", label: "Short crop", prompt: "short cropped {c} hair" },
  { id: "buzz", label: "Buzz cut", prompt: "a {c} buzz cut" },
  { id: "side-part", label: "Side part", prompt: "neat short {c} hair with a side part" },
  { id: "curly-short", label: "Short curls", prompt: "short curly {c} hair" },
  { id: "wavy-medium", label: "Wavy medium", prompt: "medium-length wavy {c} hair" },
  { id: "bob", label: "Bob", prompt: "a {c} chin-length bob" },
  { id: "pixie", label: "Pixie", prompt: "a {c} pixie cut" },
  { id: "long-straight", label: "Long straight", prompt: "long straight {c} hair falling past the shoulders" },
  { id: "long-wavy", label: "Long wavy", prompt: "long wavy {c} hair falling past the shoulders" },
  { id: "ponytail", label: "Ponytail", prompt: "{c} hair pulled back into a ponytail" },
  { id: "bun", label: "Top bun", prompt: "{c} hair tied up in a top bun" },
  { id: "braids", label: "Braids", prompt: "long {c} braids" },
  { id: "afro", label: "Afro", prompt: "a rounded {c} afro" },
  { id: "locs", label: "Locs", prompt: "shoulder-length {c} locs" },
  { id: "bald", label: "Bald", prompt: "a clean-shaven bald head" },
] as const;

export const FACIAL_HAIR = [
  { id: "keep", label: "As in photo", prompt: "" },
  { id: "none", label: "Clean-shaven", prompt: "clean-shaven face" },
  { id: "stubble", label: "Stubble", prompt: "light stubble" },
  { id: "short-beard", label: "Short beard", prompt: "a short neat beard" },
  { id: "full-beard", label: "Full beard", prompt: "a full beard" },
  { id: "mustache", label: "Mustache", prompt: "a mustache" },
] as const;

export const TOPS = [
  { id: "tshirt", label: "T-shirt", noun: "crew-neck t-shirt" },
  { id: "polo", label: "Polo", noun: "polo shirt" },
  { id: "button-up", label: "Button-up", noun: "long-sleeve button-up shirt" },
  { id: "blouse", label: "Blouse", noun: "soft blouse" },
  { id: "tank", label: "Tank top", noun: "tank top" },
  { id: "sweater", label: "Sweater", noun: "knit sweater" },
  { id: "turtleneck", label: "Turtleneck", noun: "fitted turtleneck" },
  { id: "hoodie", label: "Hoodie", noun: "pullover hoodie" },
  { id: "sweatshirt", label: "Sweatshirt", noun: "crew-neck sweatshirt" },
  { id: "jersey", label: "Sports jersey", noun: "sports jersey" },
] as const;

export const OUTERWEAR = [
  { id: "none", label: "None", noun: "" },
  { id: "denim-jacket", label: "Denim jacket", noun: "denim jacket" },
  { id: "bomber", label: "Bomber", noun: "bomber jacket" },
  { id: "blazer", label: "Blazer", noun: "tailored blazer" },
  { id: "leather-jacket", label: "Leather jacket", noun: "leather jacket" },
  { id: "cardigan", label: "Cardigan", noun: "cardigan" },
  { id: "overshirt", label: "Overshirt", noun: "overshirt" },
  { id: "vest", label: "Puffer vest", noun: "puffer vest" },
] as const;

export const BOTTOMS = [
  { id: "jeans", label: "Jeans", noun: "straight-leg jeans", plural: true },
  { id: "slim-jeans", label: "Slim jeans", noun: "slim-fit jeans", plural: true },
  { id: "wide-jeans", label: "Wide-leg jeans", noun: "high-waisted wide-leg jeans", plural: true },
  { id: "chinos", label: "Chinos", noun: "chino trousers", plural: true },
  { id: "trousers", label: "Tailored trousers", noun: "tailored trousers", plural: true },
  { id: "joggers", label: "Joggers", noun: "joggers", plural: true },
  { id: "cargo", label: "Cargo pants", noun: "cargo pants", plural: true },
  { id: "shorts", label: "Shorts", noun: "knee-length shorts", plural: true },
  { id: "skirt", label: "Midi skirt", noun: "midi skirt", plural: false },
  { id: "mini-skirt", label: "Mini skirt", noun: "mini skirt", plural: false },
] as const;

export const SHOES = [
  { id: "sneakers", label: "Sneakers", noun: "sneakers" },
  { id: "high-tops", label: "High-tops", noun: "high-top sneakers" },
  { id: "boots", label: "Boots", noun: "ankle boots" },
  { id: "loafers", label: "Loafers", noun: "loafers" },
  { id: "dress-shoes", label: "Dress shoes", noun: "polished dress shoes" },
  { id: "heels", label: "Heels", noun: "low block heels" },
  { id: "sandals", label: "Sandals", noun: "sandals" },
] as const;

export const ACCESSORIES = [
  { id: "glasses-round", label: "Round glasses", prompt: "round glasses" },
  { id: "glasses-square", label: "Square glasses", prompt: "rectangular glasses" },
  { id: "sunglasses", label: "Sunglasses", prompt: "sunglasses" },
  { id: "cap", label: "Cap", prompt: "a baseball cap" },
  { id: "beanie", label: "Beanie", prompt: "a beanie" },
  { id: "bucket-hat", label: "Bucket hat", prompt: "a bucket hat" },
  { id: "headphones", label: "Headphones", prompt: "headphones resting around the neck" },
  { id: "earrings-studs", label: "Stud earrings", prompt: "small stud earrings" },
  { id: "earrings-hoops", label: "Hoop earrings", prompt: "small hoop earrings" },
  { id: "necklace", label: "Necklace", prompt: "a delicate chain necklace" },
  { id: "watch", label: "Watch", prompt: "a wristwatch" },
  { id: "scarf", label: "Scarf", prompt: "a light scarf" },
] as const;

/** Named colors: the swatch shows the hex, the prompt uses the name. */
export const COLORS = [
  { id: "white", name: "white", hex: "#f7f7f5" },
  { id: "cream", name: "cream", hex: "#efe6d2" },
  { id: "beige", name: "beige", hex: "#d6c3a3" },
  { id: "tan", name: "tan", hex: "#b48a5a" },
  { id: "brown", name: "brown", hex: "#6b4429" },
  { id: "olive", name: "olive green", hex: "#5d6b3a" },
  { id: "sage", name: "sage green", hex: "#9aae8f" },
  { id: "forest", name: "forest green", hex: "#2f5a3b" },
  { id: "mint", name: "mint", hex: "#b9e4cf" },
  { id: "teal", name: "teal", hex: "#1f7a7a" },
  { id: "sky", name: "sky blue", hex: "#8fc3ea" },
  { id: "light-wash", name: "light-wash denim blue", hex: "#9db7d3" },
  { id: "denim", name: "mid-wash denim blue", hex: "#4f6f99" },
  { id: "royal", name: "royal blue", hex: "#2b4cc4" },
  { id: "navy", name: "navy", hex: "#1f2a44" },
  { id: "lavender", name: "lavender", hex: "#c7b8ea" },
  { id: "purple", name: "purple", hex: "#6a3fa0" },
  { id: "pink", name: "soft pink", hex: "#f2b8c6" },
  { id: "hot-pink", name: "hot pink", hex: "#e0408a" },
  { id: "red", name: "red", hex: "#c8312f" },
  { id: "burgundy", name: "burgundy", hex: "#6e1f2d" },
  { id: "orange", name: "orange", hex: "#e8742c" },
  { id: "mustard", name: "mustard yellow", hex: "#d4a72c" },
  { id: "yellow", name: "yellow", hex: "#f3d548" },
  { id: "gray", name: "light gray", hex: "#c4c6c8" },
  { id: "charcoal", name: "charcoal gray", hex: "#3c3f44" },
  { id: "black", name: "black", hex: "#16171a" },
] as const;

export const HAIR_COLORS = [
  { id: "black", name: "black", hex: "#141414" },
  { id: "dark-brown", name: "dark brown", hex: "#3b2617" },
  { id: "brown", name: "brown", hex: "#6a4428" },
  { id: "light-brown", name: "light brown", hex: "#9a7048" },
  { id: "blonde", name: "golden blonde", hex: "#d8b46a" },
  { id: "platinum", name: "platinum blonde", hex: "#ece2c6" },
  { id: "auburn", name: "auburn", hex: "#8a3a1e" },
  { id: "ginger", name: "ginger red", hex: "#c0592a" },
  { id: "gray", name: "silver gray", hex: "#a9aaa9" },
  { id: "white", name: "white", hex: "#efefef" },
  { id: "pink", name: "pastel pink", hex: "#f0a5c2" },
  { id: "blue", name: "electric blue", hex: "#3a6ff0" },
  { id: "green", name: "emerald green", hex: "#1f9a63" },
  { id: "purple", name: "violet", hex: "#7a4fd6" },
] as const;

type Ids<T extends readonly { id: string }[]> = T[number]["id"];

export type BuildId = Ids<typeof BUILDS>;
export type HeightId = Ids<typeof HEIGHTS>;
export type HairStyleId = Ids<typeof HAIR_STYLES>;
export type FacialHairId = Ids<typeof FACIAL_HAIR>;
export type TopId = Ids<typeof TOPS>;
export type OuterId = Ids<typeof OUTERWEAR>;
export type BottomId = Ids<typeof BOTTOMS>;
export type ShoeId = Ids<typeof SHOES>;
export type AccessoryId = Ids<typeof ACCESSORIES>;
export type ColorId = Ids<typeof COLORS>;
export type HairColorId = Ids<typeof HAIR_COLORS>;

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((x) => x.id) as unknown as [Ids<T>, ...Ids<T>[]];

export const appearanceSchema = z.object({
  build: z.enum(ids(BUILDS)),
  height: z.enum(ids(HEIGHTS)),
  hair: z.object({
    keep: z.boolean(),
    style: z.enum(ids(HAIR_STYLES)),
    color: z.enum(ids(HAIR_COLORS)),
  }),
  facialHair: z.enum(ids(FACIAL_HAIR)),
  top: z.object({ type: z.enum(ids(TOPS)), color: z.enum(ids(COLORS)) }),
  outer: z.object({ type: z.enum(ids(OUTERWEAR)), color: z.enum(ids(COLORS)) }),
  bottom: z.object({ type: z.enum(ids(BOTTOMS)), color: z.enum(ids(COLORS)) }),
  shoes: z.object({ type: z.enum(ids(SHOES)), color: z.enum(ids(COLORS)) }),
  accessories: z.array(z.enum(ids(ACCESSORIES))).max(5),
  extras: z.string().max(240),
});

export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = {
  build: "average",
  height: "average",
  hair: { keep: true, style: "short-crop", color: "dark-brown" },
  facialHair: "keep",
  top: { type: "tshirt", color: "white" },
  outer: { type: "denim-jacket", color: "denim" },
  bottom: { type: "chinos", color: "beige" },
  shoes: { type: "sneakers", color: "white" },
  accessories: [],
  extras: "",
};

/** One-tap outfit presets. They only touch outfit fields. */
export const OUTFIT_PRESETS: {
  id: string;
  label: string;
  outfit: Pick<Appearance, "top" | "outer" | "bottom" | "shoes">;
}[] = [
  {
    id: "casual",
    label: "Casual",
    outfit: {
      top: { type: "tshirt", color: "white" },
      outer: { type: "denim-jacket", color: "denim" },
      bottom: { type: "chinos", color: "beige" },
      shoes: { type: "sneakers", color: "white" },
    },
  },
  {
    id: "smart",
    label: "Smart casual",
    outfit: {
      top: { type: "button-up", color: "sky" },
      outer: { type: "blazer", color: "navy" },
      bottom: { type: "chinos", color: "tan" },
      shoes: { type: "loafers", color: "brown" },
    },
  },
  {
    id: "business",
    label: "Business",
    outfit: {
      top: { type: "button-up", color: "white" },
      outer: { type: "blazer", color: "charcoal" },
      bottom: { type: "trousers", color: "charcoal" },
      shoes: { type: "dress-shoes", color: "black" },
    },
  },
  {
    id: "street",
    label: "Streetwear",
    outfit: {
      top: { type: "hoodie", color: "black" },
      outer: { type: "none", color: "black" },
      bottom: { type: "cargo", color: "olive" },
      shoes: { type: "high-tops", color: "white" },
    },
  },
  {
    id: "cozy",
    label: "Cozy",
    outfit: {
      top: { type: "sweater", color: "cream" },
      outer: { type: "none", color: "cream" },
      bottom: { type: "wide-jeans", color: "light-wash" },
      shoes: { type: "loafers", color: "brown" },
    },
  },
  {
    id: "sporty",
    label: "Sporty",
    outfit: {
      top: { type: "sweatshirt", color: "gray" },
      outer: { type: "none", color: "gray" },
      bottom: { type: "joggers", color: "charcoal" },
      shoes: { type: "sneakers", color: "white" },
    },
  },
  {
    id: "creative",
    label: "Creative",
    outfit: {
      top: { type: "turtleneck", color: "black" },
      outer: { type: "overshirt", color: "mustard" },
      bottom: { type: "slim-jeans", color: "black" },
      shoes: { type: "boots", color: "brown" },
    },
  },
  {
    id: "summer",
    label: "Summer",
    outfit: {
      top: { type: "polo", color: "mint" },
      outer: { type: "none", color: "mint" },
      bottom: { type: "shorts", color: "beige" },
      shoes: { type: "sneakers", color: "white" },
    },
  },
];

function find<T extends readonly { id: string }[]>(list: T, id: string): T[number] {
  const item = list.find((x) => x.id === id);
  if (!item) throw new Error(`Unknown option: ${id}`);
  return item;
}

export const colorName = (id: string) => find(COLORS, id).name;
export const colorHex = (id: string) => find(COLORS, id).hex;
export const heightMeters = (id: HeightId) => find(HEIGHTS, id).meters;

/** Removes anything that could steer the image model away from the brief. */
export function sanitizeExtras(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>{}\[\]`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 240);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const fixArticles = (text: string) => text.replace(/\ba ([aeiou])/gi, "an $1");

const withArticle = (phrase: string) => `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;

export function describeOutfit(a: Appearance): string {
  const top = `${colorName(a.top.color)} ${find(TOPS, a.top.type).noun}`;
  const upper =
    a.outer.type === "none"
      ? withArticle(top)
      : `${withArticle(`${colorName(a.outer.color)} ${find(OUTERWEAR, a.outer.type).noun}`)} worn open over ${withArticle(top)}`;
  const bottomItem = find(BOTTOMS, a.bottom.type);
  const bottomPhrase = `${colorName(a.bottom.color)} ${bottomItem.noun}`;
  const bottom = bottomItem.plural ? bottomPhrase : withArticle(bottomPhrase);
  const shoes = `${colorName(a.shoes.color)} ${find(SHOES, a.shoes.type).noun}`;
  return `${upper}, ${bottom} and ${shoes}`;
}

/**
 * Prompt for the selfie -> full-body character sheet step. The wording of
 * the pose/framing block was tuned so the result converts cleanly to 3D and
 * rigs well; change it carefully.
 */
export function buildConceptPrompt(a: Appearance, source: { portrait?: boolean } = {}): string {
  // Naming the features to carry over keeps the person recognizable; asking
  // for them to be translated into the style, not copied, keeps a realistic
  // face from being pasted onto a stylized body.
  const hair = a.hair.keep
    ? "hairline, hairstyle, hair color and any facial hair"
    : "and any facial hair";
  const photos = source.portrait
    ? "these two photos (the first is a corrected straight-on portrait of them, the second their original selfie)"
    : "this photo";
  const lines = [
    `Turn the person in ${photos} into a full-body 3D character in the style of ${HOUSE_STYLE}.`,
    "The whole character, the face included, is drawn in that one style: no photographic or realistic face.",
    `Keep them recognizable as this exact person the way a good character designer would: carry their face shape, jawline, nose, eye shape and spacing, eyebrows, lips, skin tone, ${hair} over into the style, keep what is distinctive about them, and keep glasses, moles, freckles and piercings if they have them. Keep their apparent age.`,
    // Without this the model tidies people up: fuller, darker hair, heavier
    // brows, and whatever expression the photo happened to catch.
    `Match their real ${a.hair.keep ? "hair length, hairline, hair color and " : ""}eyebrow weight exactly: do not make ${a.hair.keep ? "the hair thicker, darker or fuller" : "the eyebrows heavier or darker"} than it is, and do not copy any passing expression from the photo.`,
    PROPORTIONS,
  ];
  lines.push(...describeLook(a), POSE_AND_FRAMING);
  return lines.join(" ");
}

/**
 * Prompt for the clean portrait made from a selfie before anything is drawn
 * from it. Real selfies are taken from below, against a window, mid-frown;
 * a cartoon drawn straight from one inherits all of that. The portrait is
 * the same person seen properly, and stays photographic on purpose: it is a
 * reference, never shown as the character.
 */
export const PORTRAIT_PROMPT =
  "Make a photorealistic head-and-shoulders portrait of the person in this photo, as a reference picture of what they really look like. " +
  "It must be unmistakably the same real person: keep their exact face shape, jawline, nose, eyes, eyebrows, lips, ears, skin tone, hairline, hairstyle, hair length, hair color and any facial hair, and details such as glasses, moles and freckles. Keep their real age. Do not beautify, smooth, slim or stylize anything. " +
  "The photo may be taken from an odd angle, in poor light or with a passing expression. Correct for all three: show them straight on at eye level with the head upright, in flat even studio lighting on a plain white background, and with a relaxed, friendly resting face: brow smooth and unfurrowed, eyes open normally and looking at the camera, lips gently closed in the faintest smile.";

/** The parts of a look that are described the same way wherever they are drawn. */
function describeLook(a: Appearance): string[] {
  const lines: string[] = [];
  if (!a.hair.keep) {
    lines.push(`Hair: give them ${fixArticles(find(HAIR_STYLES, a.hair.style).prompt.replace("{c}", find(HAIR_COLORS, a.hair.color).name))}.`);
  }
  const facial = find(FACIAL_HAIR, a.facialHair).prompt;
  if (facial) lines.push(`Facial hair: ${facial}.`);
  lines.push(`Body type: ${find(BUILDS, a.build).prompt}, ${find(HEIGHTS, a.height).prompt}.`);
  lines.push(`Outfit: ${describeOutfit(a)}.`);
  if (a.accessories.length) {
    lines.push(`Accessories: ${joinList(a.accessories.map((id) => find(ACCESSORIES, id).prompt))}.`);
  }
  const extras = sanitizeExtras(a.extras);
  if (extras) lines.push(`Extra details: ${extras}.`);
  return lines;
}

/**
 * Prompt for a quick sketch: the fast model restyles a picture of the
 * character that already exists, changing only the look. Drawing from the
 * selfie instead loses the person in this style (it turns adults into
 * generic cartoon children), while an edit keeps the face it is given.
 */
export function buildSketchEditPrompt(a: Appearance): string {
  return [
    "Restyle this character. It stays the same character: the same face, skin tone, age, art style, rendering and pose, with everything not listed below unchanged.",
    ...describeLook(a),
    POSE_AND_FRAMING,
  ].join(" ");
}

/**
 * What a look comes down to on the mannequin outfits are tried on before the
 * person has a character of their own. The mannequin has no face, no hair of
 * its own and no height, so two looks that differ only in those are the same
 * picture: the parts listed here are both what is drawn and what the shared
 * picture is filed under.
 */
export function mannequinLook(a: Appearance): string[] {
  const lines: string[] = [];
  if (!a.hair.keep) {
    lines.push(`Hair: give it ${fixArticles(find(HAIR_STYLES, a.hair.style).prompt.replace("{c}", find(HAIR_COLORS, a.hair.color).name))}.`);
  }
  if (a.build !== "average") lines.push(`Body type: ${find(BUILDS, a.build).prompt}.`);
  lines.push(`Outfit: ${describeOutfit(a)}.`);
  if (a.accessories.length) {
    lines.push(`Accessories: ${joinList([...a.accessories].sort().map((id) => find(ACCESSORIES, id).prompt))}.`);
  }
  const extras = sanitizeExtras(a.extras);
  if (extras) lines.push(`Extra details: ${extras}.`);
  return lines;
}

/** Prompt for dressing the mannequin: the fast model edits the one mannequin picture every sketch starts from. */
export function buildMannequinPrompt(a: Appearance): string {
  return [
    "Dress this mannequin. It stays the same featureless light gray mannequin: the same smooth blank head with no face, the same body, size, pose and rendering. Only what is listed below is added.",
    ...mannequinLook(a),
    "Plain clothes with no logos, brand marks or lettering.",
    "Pose: neutral A-pose, standing straight, facing the camera, arms straight and angled about 30 degrees away from the body, empty hands, feet slightly apart. " +
      "Full figure visible from head to shoes, centered, flat even studio lighting, plain pure white background, no props, no text, no floor shadow.",
  ].join(" ");
}

const POSE_AND_FRAMING =
  "Pose: neutral A-pose, standing straight, facing the camera, arms straight and angled about 30 degrees away from the body, palms facing the thighs, empty hands, feet slightly apart. " +
  "Expression: relaxed and friendly with an unfurrowed brow, lips gently closed in the faintest smile, eyes open looking at the camera. " +
  "Full figure visible from head to shoes, centered, orthographic front view, flat even studio lighting, plain pure white background, no props, no text, no floor shadow.";

/**
 * Prompt for "edit this character" requests (e.g. "make the jacket red").
 * The character image goes first and the selfie second, so the face stays
 * anchored to the real person through repeated edits.
 */
export function buildRefinePrompt(instruction: string): string {
  const change = sanitizeExtras(instruction);
  return (
    `Edit the character in the first image: ${change}. ` +
    "Keep everything else exactly the same: same person, face, identity, art style, proportions and outfit except for the requested change. " +
    "The second image is a photo of the real person: use it only to keep the character recognizable as them, in the character's own style, never to make the face realistic. " +
    POSE_AND_FRAMING
  );
}
