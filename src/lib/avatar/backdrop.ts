import { z } from "zod";

/**
 * What sits behind an avatar on its page. The 3D canvas is transparent, so a
 * backdrop is a CSS layer: a curated gradient, a color of the creator's own,
 * or an image (uploaded, or generated from a description).
 *
 * Each backdrop has a tone, which decides whether the text and chat drawn
 * over it are light or dark.
 */

export type Tone = "dark" | "light";

export const BACKDROP_PRESETS = [
  {
    id: "midnight",
    label: "Midnight",
    tone: "dark",
    css: "radial-gradient(80% 60% at 50% 15%, rgb(108 77 250 / 0.28) 0%, rgb(108 77 250 / 0) 70%), radial-gradient(70% 50% at 50% 100%, rgb(255 159 115 / 0.18) 0%, rgb(255 159 115 / 0) 70%), linear-gradient(180deg, #1b1830 0%, #121117 100%)",
  },
  {
    id: "studio",
    label: "Studio",
    tone: "light",
    css: "radial-gradient(120% 80% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 60%), radial-gradient(90% 60% at 50% 100%, #ffeadf 0%, rgb(255 234 223 / 0) 70%), linear-gradient(180deg, #efeaf9 0%, #f6efe9 100%)",
  },
  {
    id: "sunset",
    label: "Sunset",
    tone: "dark",
    css: "radial-gradient(90% 55% at 50% 100%, rgb(255 184 140 / 0.9) 0%, rgb(255 184 140 / 0) 70%), linear-gradient(180deg, #2b1055 0%, #8a2c6d 55%, #d9577a 100%)",
  },
  {
    id: "ocean",
    label: "Ocean",
    tone: "dark",
    css: "radial-gradient(80% 50% at 50% 10%, rgb(99 201 216 / 0.35) 0%, rgb(99 201 216 / 0) 70%), linear-gradient(180deg, #0b1f3a 0%, #135a82 60%, #2c8fa8 100%)",
  },
  {
    id: "forest",
    label: "Forest",
    tone: "dark",
    css: "radial-gradient(80% 50% at 50% 10%, rgb(160 214 150 / 0.3) 0%, rgb(160 214 150 / 0) 70%), linear-gradient(180deg, #0f2417 0%, #1f5136 60%, #3f7a57 100%)",
  },
  {
    id: "graphite",
    label: "Graphite",
    tone: "dark",
    css: "radial-gradient(80% 60% at 50% 18%, #3d404a 0%, rgb(61 64 74 / 0) 70%), linear-gradient(180deg, #22242b 0%, #0e0f12 100%)",
  },
  {
    id: "lilac",
    label: "Lilac",
    tone: "light",
    css: "radial-gradient(110% 70% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 60%), linear-gradient(180deg, #ece4ff 0%, #d7c9ff 60%, #f3e8ff 100%)",
  },
  {
    id: "peach",
    label: "Peach",
    tone: "light",
    css: "radial-gradient(110% 70% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 60%), linear-gradient(180deg, #fff1e6 0%, #ffd5bf 60%, #ffeadb 100%)",
  },
  {
    id: "sky",
    label: "Sky",
    tone: "light",
    css: "radial-gradient(110% 70% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 60%), linear-gradient(180deg, #dff1ff 0%, #b9dcfb 60%, #e9f6ff 100%)",
  },
] as const satisfies readonly { id: string; label: string; tone: Tone; css: string }[];

export type BackdropPresetId = (typeof BACKDROP_PRESETS)[number]["id"];
export const DEFAULT_BACKDROP_ID: BackdropPresetId = "midnight";

const presetIds = BACKDROP_PRESETS.map((p) => p.id) as [BackdropPresetId, ...BackdropPresetId[]];

/** Backdrops a creator can pick directly. Images are set by the upload and generate endpoint. */
export const backdropChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), id: z.enum(presetIds) }),
  z.object({ kind: z.literal("color"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #6c4dfa.") }),
]);

export type Backdrop =
  | z.infer<typeof backdropChoiceSchema>
  | {
      kind: "image";
      /** Storage key of the image (public, like the model and thumbnail). */
      file: string;
      tone: Tone;
      /** The description it was generated from, when it wasn't uploaded. */
      prompt?: string;
    };

/** A backdrop ready to draw: CSS for gradients, a URL for images. */
export type BackdropView = { kind: Backdrop["kind"]; tone: Tone; css?: string; imageUrl?: string; id?: string; color?: string; prompt?: string };

/** Perceived brightness of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Light text reads better on anything darker than a mid grey. */
export const toneFor = (luminance: number): Tone => (luminance < 0.4 ? "dark" : "light");

/** A soft gradient built around one color, so a plain pick still has some depth. */
function colorCss(color: string): string {
  return `radial-gradient(85% 60% at 50% 12%, color-mix(in srgb, ${color} 72%, white) 0%, transparent 70%), linear-gradient(180deg, ${color} 0%, color-mix(in srgb, ${color} 78%, black) 100%)`;
}

export function resolveBackdrop(backdrop: Backdrop | undefined, fileUrl: (key: string) => string): BackdropView {
  if (backdrop?.kind === "image") {
    return { kind: "image", tone: backdrop.tone, imageUrl: fileUrl(backdrop.file), prompt: backdrop.prompt };
  }
  if (backdrop?.kind === "color") {
    return { kind: "color", tone: toneFor(luminance(backdrop.color)), css: colorCss(backdrop.color), color: backdrop.color };
  }
  const preset = BACKDROP_PRESETS.find((p) => p.id === (backdrop?.id ?? DEFAULT_BACKDROP_ID)) ?? BACKDROP_PRESETS[0];
  return { kind: "preset", tone: preset.tone, css: preset.css, id: preset.id };
}

/** Prompt for a generated backdrop: a scene with room for the avatar and nobody else in it. */
export function buildBackdropPrompt(description: string): string {
  const scene = description.replace(/[\r\n<>{}`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return (
    `${scene}. A background scene photographed at eye level with a softly blurred depth of field, even gentle lighting, ` +
    "and open empty space in the middle and lower part of the frame where a person could stand. " +
    "Nobody in the scene: no people, no characters, no faces. No text, no logos, no watermarks."
  );
}
