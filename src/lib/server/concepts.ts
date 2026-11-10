import type { Concept } from "@/lib/avatar/types";

/** Drafts are cheap and replace each other quickly, so only a few are kept. */
const KEEP = { preview: 6, final: 18 };

/** Adds a concept at the front, dropping the oldest drafts and finals beyond what is kept. */
export function withConcept(concepts: Concept[], added: Concept): Concept[] {
  const all = [added, ...concepts];
  const previews = all.filter((c) => c.kind === "preview").slice(0, KEEP.preview);
  const finals = all.filter((c) => c.kind !== "preview").slice(0, KEEP.final);
  return all.filter((c) => previews.includes(c) || finals.includes(c));
}
