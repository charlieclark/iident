// Makes the pieces the look step dresses its mannequin in (public/doll).
//
// Every outfit option is one picture: the garment alone, in white, cut out so
// the browser can layer the pieces and tint each one in the chosen color. No
// image model runs when someone tries a look.
//
// How a piece is made:
//   1. The image model puts the garment, in pure white, on the keyed
//      mannequin (base.png: dark gray on bright green), changing nothing else.
//   2. The garment is cut out: whatever is not green, is bright, and is
//      brighter than the mannequin was at that spot. Its lightness becomes
//      the shading the tint is multiplied with.
//
//   FAL_KEY=... node scripts/doll/build.mjs                  draw what is missing, cut everything
//   FAL_KEY=... node scripts/doll/build.mjs top/hoodie ...   draw these again, then cut
//   node scripts/doll/build.mjs --cut                        only cut again from the kept drawings
//
// The drawings are kept in scripts/doll/raw (not committed). After adding an
// option to src/lib/avatar/options.ts, add its piece to PIECES here and run this.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFalClient } from "@fal-ai/client";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
const OUT = path.join(HERE, "../../public/doll");
const MODEL = process.env.FAL_CONCEPT_MODEL ?? "google/nano-banana-2.1/edit";
/** The size pieces are shown at is small; this is twice the largest. */
const WIDTH = 576;

const SAME =
  "Change nothing else: the same dark gray mannequin in exactly the same pose, size and position, on the same flat pure bright green background. No other clothing or accessories, no logos, no text.";
const WHITE = "It is entirely pure white, with soft gray shading in its folds";
const top = (noun) => `Put a plain pure white ${noun} on the mannequin. ${WHITE}. The legs and feet stay bare. ${SAME}`;
const outer = (noun) =>
  `Put a plain pure white ${noun} on the mannequin, worn open so the mannequin's bare chest shows between its two sides. ${WHITE}, and its buttons, zips and seams are white too. The legs stay bare. ${SAME}`;
const bottom = (noun) => `Put plain pure white ${noun} on the mannequin. ${WHITE} and seams. The upper body and the feet stay bare. ${SAME}`;
const shoes = (noun) => `Put plain pure white ${noun} on the mannequin's feet. They are entirely pure white, soles and laces too, with soft gray shading. ${SAME}`;
const hair = (style) =>
  `Give the mannequin ${style}, like a white wig: entirely pure white, with soft gray shading between the strands. The face stays blank and featureless. ${SAME}`;
const beard = (style) =>
  `Give the mannequin ${style}, entirely pure white with soft gray shading, on its blank featureless face. No other facial features and no hair on the head. ${SAME}`;
const wear = (what) => `Put ${what} on the mannequin. It is entirely pure white with soft gray shading. ${SAME}`;

/** slot/id -> what to ask for. Ids are the option ids in src/lib/avatar/options.ts. */
const PIECES = {
  "top/tshirt": top("crew-neck t-shirt"),
  "top/polo": top("polo shirt"),
  "top/button-up": top("long-sleeve button-up shirt"),
  "top/blouse": top("soft blouse"),
  "top/tank": top("tank top"),
  "top/sweater": top("knit sweater"),
  "top/turtleneck": top("fitted turtleneck"),
  "top/hoodie": top("pullover hoodie"),
  "top/sweatshirt": top("crew-neck sweatshirt"),
  "top/jersey": top("short-sleeve sports jersey"),
  "outer/denim-jacket": outer("denim jacket"),
  "outer/bomber": outer("bomber jacket"),
  "outer/blazer": outer("tailored blazer"),
  "outer/leather-jacket": outer("leather jacket"),
  "outer/cardigan": outer("cardigan"),
  "outer/overshirt": outer("overshirt"),
  "outer/vest": outer("sleeveless puffer vest"),
  "bottom/jeans": bottom("straight-leg jeans"),
  "bottom/slim-jeans": bottom("slim-fit jeans"),
  "bottom/wide-jeans": bottom("high-waisted wide-leg jeans"),
  "bottom/chinos": bottom("chino trousers"),
  "bottom/trousers": bottom("tailored trousers"),
  "bottom/joggers": bottom("joggers with cuffed ankles"),
  "bottom/cargo": bottom("cargo pants with side pockets"),
  "bottom/shorts": bottom("knee-length shorts"),
  "bottom/skirt": bottom("a midi skirt").replace("Put plain pure white a", "Put a plain pure white"),
  "bottom/mini-skirt": bottom("a mini skirt").replace("Put plain pure white a", "Put a plain pure white"),
  "shoes/sneakers": shoes("sneakers"),
  "shoes/high-tops": shoes("high-top sneakers"),
  "shoes/boots": shoes("ankle boots"),
  "shoes/loafers": shoes("loafers"),
  "shoes/dress-shoes": shoes("dress shoes"),
  "shoes/heels": shoes("low block heels"),
  "shoes/sandals": shoes("sandals"),
  "hair/short-crop": hair("short cropped hair"),
  "hair/buzz": hair("a buzz cut"),
  "hair/side-part": hair("neat short hair with a side part"),
  "hair/curly-short": hair("short curly hair"),
  "hair/wavy-medium": hair("medium-length wavy hair"),
  "hair/bob": hair("a chin-length bob"),
  "hair/pixie": hair("a pixie cut"),
  "hair/long-straight": hair("long straight hair falling past the shoulders"),
  "hair/long-wavy": hair("long wavy hair falling past the shoulders"),
  "hair/ponytail": hair("hair pulled back into a ponytail"),
  "hair/bun": hair("hair tied up in a top bun"),
  "hair/braids": hair("long braids"),
  "hair/afro": hair("a rounded afro"),
  "hair/locs": hair("shoulder-length locs"),
  "beard/stubble": beard("short stubble along the jaw and chin"),
  "beard/short-beard": beard("a short neat beard"),
  "beard/full-beard": beard("a full beard"),
  "beard/mustache": beard("a mustache"),
  "extra/glasses-round": wear("round glasses with thin pure white frames and completely clear, see-through lenses"),
  "extra/glasses-square": wear("rectangular glasses with thin pure white frames and completely clear, see-through lenses"),
  "extra/sunglasses": wear("sunglasses with pure white frames and opaque pure white lenses"),
  "extra/cap": wear("a plain pure white baseball cap"),
  "extra/beanie": wear("a plain pure white knit beanie"),
  "extra/bucket-hat": wear("a plain pure white bucket hat"),
  "extra/headphones": wear("pure white over-ear headphones resting around its neck"),
  "extra/earrings-studs": wear("a pair of small pure white stud earrings, one at each side of the head where the ears would be,"),
  "extra/earrings-hoops": wear("a pair of small pure white hoop earrings, one at each side of the head where the ears would be,"),
  "extra/necklace": wear("a delicate pure white chain necklace"),
  "extra/watch": wear("a pure white wristwatch on its left wrist"),
  "extra/scarf": wear("a light pure white scarf around its neck"),
};
/** Pieces that hide what is worn under them where it would stick out (a hoodie's sleeves under a jacket, hair under a hat). */
const COVERS = { outer: "body", "extra/cap": "head", "extra/beanie": "head", "extra/bucket-hat": "head" };

const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function pixels(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Lightness from red and blue only, so green spill at an edge doesn't read as bright cloth. */
const light = (d, i) => Math.max(d[i], d[i + 2]) / 255;
/** How much of a pixel is not the green background. */
const solid = (d, i) => 1 - smooth((d[i + 1] - Math.max(d[i], d[i + 2])) / 255, 0.1, 0.3);

/** Groups of touching pixels where `inside(i)` holds; calls `each(pixels, touchesEdge)` for every group. */
function regions(width, height, inside, each) {
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !inside(start)) continue;
    const group = [];
    let edge = false;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      group.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && !seen[q] && inside(q)) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    each(group, edge);
  }
}

/**
 * How a slot's cut-outs are repaired. Dark seams and deep folds fall under
 * the brightness bar and leave cracks and holes in a garment: cracks up to
 * twice `close` pixels wide are sealed, and holes up to `fill` (a share of
 * the picture) are filled. Clothes are solid, so they are repaired freely.
 * Glasses, hoops and a necklace are mostly opening, which has to stay open.
 */
const REPAIR = {
  top: { close: 4, fill: 0.012 },
  outer: { close: 4, fill: 0.012 },
  bottom: { close: 4, fill: 0.012 },
  shoes: { close: 3, fill: 0.004 },
  hair: { close: 0, fill: 0.001 },
  beard: { close: 0, fill: 0.0005 },
  extra: { close: 2, fill: 0.003 },
  "extra/glasses-round": { close: 0, fill: 0.0001 },
  "extra/glasses-square": { close: 0, fill: 0.0001 },
  "extra/earrings-hoops": { close: 0, fill: 0.0001 },
  "extra/necklace": { close: 0, fill: 0.0001 },
};

/** Grows (or, with `shrink`, shrinks) a mask by `r` pixels in every direction. */
function grow(mask, width, height, r, shrink = false) {
  const want = shrink ? 0 : 1;
  const pass = (src, step, count, lines) => {
    const out = new Uint8Array(src.length);
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < count; k++) {
        const at = (j) => (step === 1 ? line * width + j : j * width + line);
        let hit = false;
        for (let j = Math.max(0, k - r); j <= Math.min(count - 1, k + r) && !hit; j++) hit = src[at(j)] === want;
        out[at(k)] = hit ? want : 1 - want;
      }
    }
    return out;
  };
  return pass(pass(mask, 1, width, height), width, height, width);
}

/** Cuts a white piece out of its drawing: coverage and shading for every pixel. */
function cut(piece, base, repair) {
  const { data, width, height } = piece;
  const n = width * height;
  const alpha = new Float32Array(n);
  const shade = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 3;
    const l = light(data, i);
    // Bright, and brighter than the mannequin was here: its own highlights are not cloth.
    alpha[p] = solid(data, i) * smooth(l, 0.42, 0.56) * smooth(l - light(base.data, i) * solid(base.data, i), 0.1, 0.22);
    shade[p] = l;
  }
  // Stray specks pass the brightness bar; drop them.
  regions(width, height, (p) => alpha[p] >= 0.5, (group) => {
    if (group.length < n * 0.00015) for (const p of group) alpha[p] = 0;
  });
  // Seal cracks, then fill what is enclosed.
  let mask = Uint8Array.from(alpha, (a) => (a >= 0.5 ? 1 : 0));
  if (repair.close) mask = grow(grow(mask, width, height, repair.close), width, height, repair.close, true);
  regions(width, height, (p) => !mask[p], (group, edge) => {
    if (!edge && group.length < n * repair.fill) for (const p of group) mask[p] = 1;
  });
  for (let p = 0; p < n; p++) if (mask[p] && alpha[p] < 1) alpha[p] = Math.max(alpha[p], 0.999);
  // Shading is relative to the cloth's own lit areas, and never so dark that a tint turns to black.
  const lit = [];
  for (let p = 0; p < n; p += 7) if (alpha[p] > 0.9 && shade[p] > 0.5) lit.push(shade[p]);
  lit.sort((a, b) => a - b);
  const white = lit.length ? lit[Math.floor(lit.length * 0.92)] : 1;
  let covered = 0;
  for (let p = 0; p < n; p++) {
    shade[p] = Math.min(1, Math.max(0.3, shade[p] / white));
    covered += alpha[p];
  }
  return { alpha, shade, width, height, coverage: covered / n };
}

/** How far the mannequin itself moved in a drawing: mean change where it is neither cloth nor background. */
function drift(piece, base, alpha) {
  let sum = 0;
  let count = 0;
  for (let p = 0; p < alpha.length; p += 3) {
    const i = p * 3;
    if (alpha[p] > 0.05 || solid(base.data, i) < 0.95 || solid(piece.data, i) < 0.95) continue;
    sum += Math.abs(light(piece.data, i) - light(base.data, i));
    count++;
  }
  return count ? sum / count : 0;
}

function toImage({ width, height }, gray, alpha) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const v = Math.round(gray(p) * 255);
    rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = v;
    rgba[p * 4 + 3] = Math.round(alpha(p) * 255);
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).resize({ width: WIDTH }).webp({ quality: 84, alphaQuality: 90 });
}

/**
 * What a covering piece hides of the layers under it. A jacket hides what
 * sticks out to its sides below the shoulders; a hat hides hair beside and
 * above it.
 */
function cover({ alpha, width, height }, kind) {
  const spans = [];
  let widest = 0;
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 0.5) {
        if (left < 0) left = x;
        right = x;
      }
    }
    spans.push(left < 0 ? null : [left, right]);
    if (left >= 0) widest = Math.max(widest, right - left);
  }
  const first = spans.findIndex(Boolean);
  const last = spans.findLastIndex(Boolean);
  // Hair comes out from under a hat's rim: only the upper part of a hat hides what is beside it.
  const rim = first + (last - first) * 0.6;
  const hide = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const span = spans[y];
    if (kind === "head" && first >= 0 && y < first) hide.fill(1, y * width, (y + 1) * width);
    if (!span) continue;
    if (kind === "head" && y > rim) continue;
    // A jacket's collar is narrower than the shoulders under it: only rows where it is at full width count.
    if (kind === "body" && span[1] - span[0] < widest * 0.6) continue;
    // Under a hat, big hair is let out gradually towards the rim, so it swells out from under it instead of ending in a flat edge.
    const out = kind === "head" ? 1 + ((y - first) / Math.max(1, rim - first)) * width * 0.22 : 1;
    for (let x = 0; x < width; x++) if (x < span[0] - out || x > span[1] + out) hide[y * width + x] = 1;
  }
  return hide;
}

async function draw(names) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not set: needed to draw pieces (use --cut to only cut again).");
  const fal = createFalClient({ credentials: process.env.FAL_KEY });
  const baseUrl = await fal.storage.upload(new File([readFileSync(path.join(HERE, "base.png"))], "base.png", { type: "image/png" }));
  const queue = [...names];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try {
          const out = await fal.subscribe(MODEL, { input: { prompt: PIECES[name], image_urls: [baseUrl], num_images: 1, output_format: "png", aspect_ratio: "9:16", resolution: "1K" } });
          const res = await fetch(out.data.images[0].url);
          writeFileSync(path.join(RAW, `${name.replace("/", "--")}.png`), Buffer.from(await res.arrayBuffer()));
          console.log("drew", name);
        } catch (err) {
          console.log("FAILED", name, err?.status ?? "", String(err?.message ?? err).slice(0, 200));
        }
      }
    }),
  );
}

const args = process.argv.slice(2);
const cutOnly = args.includes("--cut");
const asked = args.filter((a) => !a.startsWith("--"));
for (const name of asked) if (!PIECES[name]) throw new Error(`Unknown piece: ${name}`);
mkdirSync(RAW, { recursive: true });
const rawFile = (name) => path.join(RAW, `${name.replace("/", "--")}.png`);
if (!cutOnly) {
  const todo = asked.length ? asked : Object.keys(PIECES).filter((name) => !existsSync(rawFile(name)));
  if (todo.length) await draw(todo);
}

const base = await pixels(path.join(HERE, "base.png"));
mkdirSync(OUT, { recursive: true });
// The mannequin itself, lightened from the dark gray it is drawn in (dark, so that white cloth stands out from it).
await toImage(base, (p) => Math.min(0.93, 0.56 + light(base.data, p * 3) * 0.62), (p) => solid(base.data, p * 3)).toFile(path.join(OUT, "mannequin.webp"));

const report = [];
for (const name of Object.keys(PIECES)) {
  if (!existsSync(rawFile(name))) {
    report.push(`${name.padEnd(24)} MISSING`);
    continue;
  }
  const piece = await pixels(rawFile(name));
  if (piece.width !== base.width || piece.height !== base.height) {
    report.push(`${name.padEnd(24)} WRONG SIZE ${piece.width}x${piece.height}`);
    continue;
  }
  const [slot] = name.split("/");
  const made = cut(piece, base, REPAIR[name] ?? REPAIR[slot]);
  mkdirSync(path.join(OUT, slot), { recursive: true });
  await toImage(made, (p) => made.shade[p], (p) => made.alpha[p]).toFile(path.join(OUT, `${name}.webp`));
  const kind = COVERS[name] ?? COVERS[slot];
  if (kind) {
    const hide = cover(made, kind);
    await toImage(made, () => 0, (p) => hide[p]).toFile(path.join(OUT, `${name}.cover.webp`));
  }
  const moved = drift(piece, base, made.alpha);
  report.push(`${name.padEnd(24)} covers ${(made.coverage * 100).toFixed(1).padStart(5)}%  mannequin moved ${(moved * 100).toFixed(1)}${moved > 0.04 ? "  <-- check" : ""}${made.coverage < 0.0004 ? "  <-- nearly empty" : ""}`);
}
console.log(report.join("\n"));
