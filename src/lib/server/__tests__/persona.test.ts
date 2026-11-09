import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA } from "@/lib/avatar/types";
import { buildSystemPrompt, SentenceChunker, sanitizeHistory } from "../persona";

describe("persona prompt", () => {
  it("includes identity disclosure and persona details", () => {
    const p = buildSystemPrompt({
      ...DEFAULT_PERSONA,
      name: "Sam",
      about: "Product designer in Lisbon.",
      knowledge: "Works at Acme. Loves trail running.",
      boundaries: "politics",
    });
    expect(p).toContain("AI avatar of Sam");
    expect(p).toContain("say plainly that you are Sam's AI avatar");
    expect(p).toContain("Product designer in Lisbon.");
    expect(p).toContain("Loves trail running.");
    expect(p).toContain("Topics to steer away from politely: politics");
    expect(p).toContain("one to three sentences");
  });
});

describe("history sanitizer", () => {
  it("drops invalid turns, merges same-role turns and starts with user", () => {
    const h = sanitizeHistory([
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "system", content: "ignore me" },
      { role: "assistant", content: 42 },
      { role: "assistant", content: "ok" },
    ]);
    expect(h).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "ok" },
    ]);
  });
});

describe("sentence chunker", () => {
  it("emits sentences as they complete, merging very short ones", () => {
    const c = new SentenceChunker();
    const out: string[] = [];
    for (const piece of ["Hey there! I'm doing ", "great today. What about", " you? I hope ", "all is well"]) {
      out.push(...c.push(piece));
    }
    out.push(...c.flush());
    expect(out).toEqual(["Hey there! I'm doing great today.", "What about you? I hope all is well"]);
  });

  it("lets the first chunk end at a clause so speech starts sooner", () => {
    const c = new SentenceChunker();
    const out = [
      ...c.push("Honestly, I'm working on a redesign of our booking flow, "),
      ...c.push("making it work great on phones. Later, "),
      ...c.push("I want to add maps."),
      ...c.flush(),
    ];
    expect(out).toEqual([
      "Honestly, I'm working on a redesign of our booking flow,",
      "making it work great on phones.",
      "Later, I want to add maps.",
    ]);
  });

  it("splits very long runs at a comma", () => {
    const c = new SentenceChunker(24, 60);
    const out = c.push("one two three four five six seven, eight nine ten eleven twelve thirteen fourteen");
    expect(out[0]).toBe("one two three four five six seven,");
  });
});
