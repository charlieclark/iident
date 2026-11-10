import "server-only";
import { resolveBackdrop } from "@/lib/avatar/backdrop";
import type { AvatarRecord, PublicAvatar } from "@/lib/avatar/types";
import { HttpError } from "./config";
import { canEdit } from "./auth";
import { getAvatar } from "./db";
import { fileUrl } from "./storage";
import { monthlyReplyLimit, usageOf } from "./usage";

export { HttpError };

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Unexpected error";
  return Response.json({ error: message.slice(0, 300) }, { status: 500 });
}

/** Wraps a route handler so thrown HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Loads a draft/avatar and checks the caller may edit it (edit token, or signed in as its owner). */
export function requireOwner(req: Request, id: string): AvatarRecord {
  if (!canEdit(req, id)) throw new HttpError(403, "You don't have access to this avatar.");
  const record = getAvatar(id);
  if (!record) throw new HttpError(404, "Avatar not found.");
  return record;
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** Small in-memory token bucket; good enough for a single instance. */
export function rateLimit(req: Request, scope: string, perMinute: number) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) throw new HttpError(429, "Slow down a little and try again in a moment.");
  b.tokens -= 1;
  buckets.set(key, b);
}

export const RESERVED_SLUGS = new Set([
  "a",
  "api",
  "create",
  "edit",
  "admin",
  "dev",
  "login",
  "auth",
  "me",
  "pricing",
  "account",
  "signup",
  "settings",
  "about",
  "help",
  "new",
]);

export function normalizeSlug(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function validateSlug(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return "Use letters, numbers and dashes.";
  if (RESERVED_SLUGS.has(slug)) return "That name is reserved.";
  return null;
}

/** What the owner's editor needs (no secrets, files as URLs). */
export function ownerView(r: AvatarRecord) {
  return {
    usage: { ...usageOf(r), limit: monthlyReplyLimit() },
    backdrop: resolveBackdrop(r.backdrop, fileUrl),
    id: r.id,
    slug: r.slug,
    published: r.published,
    consent: r.consent,
    appearance: r.appearance,
    persona: r.persona,
    context: r.context,
    selfieUrl: r.selfie ? fileUrl(r.selfie.file) : null,
    concepts: r.concepts.map((c) => ({
      id: c.id,
      imageUrl: fileUrl(c.file),
      kind: c.kind ?? ("final" as const),
      parentId: c.parentId ?? null,
    })),
    selectedConceptId: r.selectedConceptId ?? null,
    model: r.model
      ? {
          status: r.model.status,
          conceptId: r.model.conceptId,
          startedAt: r.model.startedAt,
          finishedAt: r.model.finishedAt ?? null,
          error: r.model.error ?? null,
          url: r.model.file ? fileUrl(r.model.file) : null,
          /** Unrigged mesh, available while rigging runs (for a turntable preview). */
          previewUrl: r.model.status !== "ready" && r.model.status !== "failed" ? (r.model.sources?.mesh ?? null) : null,
          clips: r.model.clips ?? [],
          heightMeters: r.model.heightMeters,
        }
      : null,
    faceRig: r.faceRig ?? null,
    thumbnailUrl: r.thumbnail ? fileUrl(r.thumbnail) : null,
    voice: r.voice
      ? { mode: r.voice.mode, voiceId: r.voice.mode === "preset" ? r.voice.voiceId : null, previewUrl: r.voice.previewUrl ?? null }
      : null,
  };
}

export type OwnerView = ReturnType<typeof ownerView>;

/** One row of an account's list of avatars. */
export function summaryView(r: AvatarRecord) {
  // The character image is private to the owner; the list is only shown to them, signed in.
  const concept = r.concepts.find((c) => c.id === r.selectedConceptId) ?? r.concepts.findLast((c) => (c.kind ?? "final") === "final");
  return {
    id: r.id,
    name: r.persona.name,
    slug: r.slug,
    published: r.published,
    ready: r.model?.status === "ready",
    building: !!r.model && r.model.status !== "ready" && r.model.status !== "failed",
    imageUrl: r.thumbnail ? fileUrl(r.thumbnail) : concept ? fileUrl(concept.file) : null,
    updatedAt: r.updatedAt,
    usage: { ...usageOf(r), limit: monthlyReplyLimit() },
  };
}

export type AvatarSummary = ReturnType<typeof summaryView>;

export function publicView(r: AvatarRecord): PublicAvatar | null {
  if (!r.published || !r.slug || r.model?.status !== "ready" || !r.model.file) return null;
  return {
    id: r.id,
    slug: r.slug,
    persona: { name: r.persona.name, tagline: r.persona.tagline, language: r.persona.language },
    modelUrl: fileUrl(r.model.file),
    heightMeters: r.model.heightMeters,
    clips: r.model.clips ?? [],
    faceRig: r.faceRig ?? null,
    thumbnailUrl: r.thumbnail ? fileUrl(r.thumbnail) : null,
    hasVoice: !!r.voice,
    backdrop: resolveBackdrop(r.backdrop, fileUrl),
  };
}
