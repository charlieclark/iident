import { describe, expect, it } from "vitest";
import { BACKDROP_PRESETS, backdropChoiceSchema, buildBackdropPrompt, luminance, resolveBackdrop, toneFor } from "../backdrop";

const url = (key: string) => `/api/files/${key}`;

describe("backdrops", () => {
  it("defaults to the midnight gradient with light text", () => {
    expect(resolveBackdrop(undefined, url)).toMatchObject({ kind: "preset", id: "midnight", tone: "dark" });
    expect(resolveBackdrop(undefined, url).css).toBe(BACKDROP_PRESETS[0].css);
  });

  it("picks light or dark text from a custom color", () => {
    expect(resolveBackdrop({ kind: "color", color: "#101828" }, url)).toMatchObject({ tone: "dark", color: "#101828" });
    expect(resolveBackdrop({ kind: "color", color: "#ffe9d6" }, url)).toMatchObject({ tone: "light" });
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(toneFor(luminance("#6c4dfa"))).toBe("dark");
  });

  it("serves images by URL with their stored tone", () => {
    const view = resolveBackdrop({ kind: "image", file: "a1/backdrop-1.webp", tone: "light", prompt: "a cafe" }, url);
    expect(view).toEqual({ kind: "image", tone: "light", imageUrl: "/api/files/a1/backdrop-1.webp", prompt: "a cafe" });
  });

  it("only accepts known presets and plain hex colors as choices", () => {
    expect(backdropChoiceSchema.safeParse({ kind: "preset", id: "ocean" }).success).toBe(true);
    expect(backdropChoiceSchema.safeParse({ kind: "preset", id: "nope" }).success).toBe(false);
    expect(backdropChoiceSchema.safeParse({ kind: "color", color: "red; background:url(x)" }).success).toBe(false);
    // Images can only be set through the upload and generate endpoint.
    expect(backdropChoiceSchema.safeParse({ kind: "image", file: "x/y.webp", tone: "dark" }).success).toBe(false);
  });

  it("asks for an empty scene and strips markup from the description", () => {
    const p = buildBackdropPrompt("a cozy <b>cafe</b>\nin the evening");
    expect(p.startsWith("a cozy b cafe /b in the evening.")).toBe(true);
    expect(p).toContain("no people");
  });
});
