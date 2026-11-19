import { describe, expect, it } from "vitest";
import type { Concept } from "@/lib/avatar/types";
import { STYLE_ID } from "@/lib/avatar/options";
import { sketchBase, withConcept } from "../concepts";
import { imageEditInput } from "../fal";

const concept = (id: string, kind?: "preview" | "final"): Concept => ({ id, url: "", file: "", prompt: "", kind, createdAt: 0 });

describe("character concepts", () => {
  it("keeps only the newest few drafts and never drops finals for them", () => {
    let list: Concept[] = [concept("old-final"), concept("f1", "final")];
    for (let i = 0; i < 16; i++) list = withConcept(list, concept(`p${i}`, "preview"));
    // Twelve are kept: enough to go back to a look tried a moment ago.
    expect(list.filter((c) => c.kind === "preview").map((c) => c.id)).toEqual(Array.from({ length: 12 }, (_, i) => `p${15 - i}`));
    // Concepts from before drafts existed have no kind and count as final.
    expect(list.filter((c) => c.kind !== "preview").map((c) => c.id)).toEqual(["old-final", "f1"]);
    expect(list[0].id).toBe("p15");
  });

  it("sketches from the newest picture the main model drew of the current selfie in the current style", () => {
    const main = (id: string, over: Partial<Concept> = {}): Concept => ({ ...concept(id, "final"), drawnBy: "main", style: STYLE_ID, selfie: "selfie-a.jpg", ...over });
    const selfie = { file: "selfie-a.jpg", url: "" };
    expect(sketchBase({ concepts: [], selfie })).toBeNull();
    // Pictures from before the current style, of an earlier selfie, or drawn by the sketch model don't count.
    const others = [concept("legacy", "final"), main("old-style", { style: "figure-0" }), main("old-selfie", { selfie: "selfie-b.jpg" }), main("sketch", { drawnBy: "sketch", kind: "preview" })];
    expect(sketchBase({ concepts: others, selfie })).toBeNull();
    expect(sketchBase({ concepts: [...others, main("first", { kind: "preview" }), main("older")], selfie })?.id).toBe("first");
    expect(sketchBase({ concepts: [main("x")], selfie: undefined })).toBeNull();

    // The picture sketches are made from survives however many sketches follow it.
    let list: Concept[] = [main("first", { kind: "preview" })];
    for (let i = 0; i < 16; i++) {
      const next = main(`s${i}`, { drawnBy: "sketch", kind: "preview" });
      list = withConcept(list, next, sketchBase({ concepts: [next, ...list], selfie }));
    }
    expect(list.map((c) => c.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `s${15 - i}`), "first"]);
  });

  it("shapes requests for each image model family", () => {
    const urls = ["https://example.com/selfie.jpg"];
    expect(imageEditInput("openai/gpt-image-2.6/flare/edit", "p", urls)).toMatchObject({
      image_urls: urls,
      image_size: { width: 1024, height: 1536 },
      quality: "high",
      reasoning_effort: "low",
    });
    expect(imageEditInput("openai/gpt-image-2.6/flare/edit", "p", urls, "low")).toMatchObject({ quality: "low" });
    expect(imageEditInput("blackforestlabs/flux-3/klein/edit-image", "p", urls)).toMatchObject({
      image_size: { width: 576, height: 1024 },
      enable_prompt_expansion: false,
    });
    expect(imageEditInput("google/nano-banana-2.1/edit", "p", urls)).toMatchObject({ aspect_ratio: "9:16", resolution: "1K" });
    // The clean portrait is a square head and shoulders.
    expect(imageEditInput("openai/gpt-image-2.6/flare/edit", "p", urls, "high", "portrait")).toMatchObject({ image_size: { width: 1024, height: 1024 } });
    expect(imageEditInput("google/nano-banana-2.1/edit", "p", urls, "high", "portrait")).toMatchObject({ aspect_ratio: "1:1" });
  });
});
