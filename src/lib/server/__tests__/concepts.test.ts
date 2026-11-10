import { describe, expect, it } from "vitest";
import type { Concept } from "@/lib/avatar/types";
import { withConcept } from "../concepts";
import { imageEditInput } from "../fal";

const concept = (id: string, kind?: "preview" | "final"): Concept => ({ id, url: "", file: "", prompt: "", kind, createdAt: 0 });

describe("character concepts", () => {
  it("keeps only the newest few drafts and never drops finals for them", () => {
    let list: Concept[] = [concept("old-final"), concept("f1", "final")];
    for (let i = 0; i < 10; i++) list = withConcept(list, concept(`p${i}`, "preview"));
    expect(list.filter((c) => c.kind === "preview").map((c) => c.id)).toEqual(["p9", "p8", "p7", "p6", "p5", "p4"]);
    // Concepts from before drafts existed have no kind and count as final.
    expect(list.filter((c) => c.kind !== "preview").map((c) => c.id)).toEqual(["old-final", "f1"]);
    expect(list[0].id).toBe("p9");
  });

  it("shapes requests for each image model family", () => {
    const urls = ["https://example.com/selfie.jpg"];
    expect(imageEditInput("openai/gpt-image-2.6/flare/edit", "p", urls)).toMatchObject({
      image_urls: urls,
      image_size: { width: 1024, height: 1536 },
      quality: "high",
      reasoning_effort: "low",
    });
    expect(imageEditInput("blackforestlabs/flux-3/klein/edit-image", "p", urls)).toMatchObject({
      image_size: { width: 576, height: 1024 },
      enable_prompt_expansion: false,
    });
    expect(imageEditInput("google/nano-banana-2.1/edit", "p", urls)).toMatchObject({ aspect_ratio: "9:16", resolution: "1K" });
  });
});
