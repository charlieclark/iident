import { STYLE_ID } from "@/lib/avatar/options";
import type { AvatarRecord, Concept } from "@/lib/avatar/types";

/** Drafts are cheap and replace each other quickly, so only a few are kept. */
const KEEP = { preview: 6, final: 18 };

/**
 * The picture quick sketches are edits of: the newest one the main model
 * drew of the current selfie in the current house style.
 */
export function sketchBase(record: Pick<AvatarRecord, "concepts" | "selfie">): Concept | null {
  const selfie = record.selfie?.file;
  return record.concepts.find((c) => c.drawnBy === "main" && c.style === STYLE_ID && !!selfie && c.selfie === selfie) ?? null;
}

/** Adds a concept at the front, dropping the oldest drafts and finals beyond what is kept. `keep` is never dropped. */
export function withConcept(concepts: Concept[], added: Concept, keep?: Concept | null): Concept[] {
  const all = [added, ...concepts];
  const previews = all.filter((c) => c.kind === "preview").slice(0, KEEP.preview);
  const finals = all.filter((c) => c.kind !== "preview").slice(0, KEEP.final);
  return all.filter((c) => previews.includes(c) || finals.includes(c) || c.id === keep?.id);
}
