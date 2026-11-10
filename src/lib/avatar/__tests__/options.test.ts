import { describe, expect, it } from "vitest";
import {
  appearanceSchema,
  buildConceptPrompt,
  buildRefinePrompt,
  buildSketchEditPrompt,
  DEFAULT_APPEARANCE,
  describeOutfit,
  OUTFIT_PRESETS,
  sanitizeExtras,
} from "../options";

describe("appearance options", () => {
  it("default appearance and presets validate", () => {
    expect(appearanceSchema.safeParse(DEFAULT_APPEARANCE).success).toBe(true);
    for (const preset of OUTFIT_PRESETS) {
      const a = { ...DEFAULT_APPEARANCE, ...preset.outfit };
      expect(appearanceSchema.safeParse(a).success).toBe(true);
    }
  });

  it("describes outfits with articles and colors", () => {
    expect(describeOutfit(DEFAULT_APPEARANCE)).toBe(
      "a mid-wash denim blue denim jacket worn open over a white crew-neck t-shirt, beige chino trousers and white sneakers",
    );
    const skirt = {
      ...DEFAULT_APPEARANCE,
      outer: { type: "none" as const, color: "black" as const },
      top: { type: "sweater" as const, color: "olive" as const },
      bottom: { type: "skirt" as const, color: "orange" as const },
    };
    expect(describeOutfit(skirt)).toBe(
      "an olive green knit sweater, an orange midi skirt and white sneakers",
    );
  });

  it("builds a sketch prompt that changes the look and keeps the character", () => {
    const p = buildSketchEditPrompt({ ...DEFAULT_APPEARANCE, hair: { keep: false, style: "bob", color: "auburn" }, facialHair: "none" });
    expect(p).toMatch(/^Restyle this character\. It stays the same character/);
    expect(p).toContain("Hair: give them an auburn chin-length bob.");
    expect(p).toContain("Facial hair:");
    expect(p).toContain("Outfit:");
    expect(p).toContain("A-pose");
    // The style is the picture's own: describing it again would redraw the face.
    expect(p).not.toContain("animated feature film");
  });

  it("draws from the clean portrait and the selfie together when there is a portrait", () => {
    const alone = buildConceptPrompt(DEFAULT_APPEARANCE);
    const both = buildConceptPrompt(DEFAULT_APPEARANCE, { portrait: true });
    expect(alone).toContain("the person in this photo");
    expect(both).toContain("the first is a corrected straight-on portrait of them, the second their original selfie");
    // Either way the model is told not to tidy the person up or copy the photo's expression.
    for (const p of [alone, both]) {
      expect(p).toContain("do not make the hair thicker, darker or fuller than it is");
      expect(p).toContain("do not copy any passing expression from the photo");
      expect(p).toContain("unfurrowed brow");
    }
    // With a chosen hairstyle there is no real hair to match, only the eyebrows.
    const restyled = buildConceptPrompt({ ...DEFAULT_APPEARANCE, hair: { keep: false, style: "bob", color: "auburn" } });
    expect(restyled).toContain("Match their real eyebrow weight exactly");
    expect(restyled).not.toContain("hair thicker");
  });

  it("builds a concept prompt with pose constraints", () => {
    const p = buildConceptPrompt({
      ...DEFAULT_APPEARANCE,
      hair: { keep: false, style: "bob", color: "auburn" },
      accessories: ["glasses-round", "watch"],
      extras: "a small enamel cat pin\n<ignore previous>",
    });
    expect(p).toContain("Hair: give them an auburn chin-length bob.");
    expect(p).toContain("modern animated feature film");
    expect(p).toContain("recognizable as this exact person");
    expect(p).toContain("normal-sized head");
    expect(p).not.toContain("hairstyle, hair color");
    expect(p).toContain("Accessories: round glasses and a wristwatch.");
    expect(p).toContain("Extra details: a small enamel cat pin ignore previous.");
    expect(p).toContain("A-pose");
    expect(p).toContain("plain pure white background");
    expect(p).not.toContain("<");
  });

  it("sanitizes free text", () => {
    expect(sanitizeExtras("  hi\n\nthere {x} ")).toBe("hi there x");
    expect(sanitizeExtras("x".repeat(500))).toHaveLength(240);
  });

  it("builds refine prompts that preserve identity", () => {
    const p = buildRefinePrompt("make the jacket red");
    expect(p.startsWith("Edit the character in the first image: make the jacket red.")).toBe(true);
    expect(p).toContain("photo of the real person");
    expect(p).toContain("same person");
  });
});
