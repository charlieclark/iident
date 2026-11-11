import "server-only";
import { resolveBackdrop } from "@/lib/avatar/backdrop";
import type { AvatarRecord, PublicAvatar } from "@/lib/avatar/types";
import { HttpError } from "./config";
import { createHash } from "node:crypto";
import { mayEdit } from "./auth";
import { loadAvatar } from "./db";
import { one, query } from "./pg";
import { fileUrl } from "./storage";
import { replyAllowance, usageOf, type Allowance } from "./usage";

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
      // Next.js signals of its own (such as a GET route declining to be prerendered at build time) pass through.
      if (typeof (err as { digest?: unknown } | null)?.digest === "string") throw err;
      return errorResponse(err);
    }
  };
}

/** Loads a draft/avatar and checks the caller may edit it (edit token, or signed in as its owner). */
export async function requireOwner(req: Request, id: string): Promise<AvatarRecord> {
  const avatar = await loadAvatar(id);
  // The same answer whether or not the avatar exists, so ids can't be probed.
  if (!avatar || !(await mayEdit(req, avatar))) throw new HttpError(403, "You don't have access to this avatar.");
  return avatar.record;
}

/**
 * A token bucket per caller and scope, kept in the database so that every
 * server instance counts against the same bucket. One statement refills the
 * bucket for the time passed and takes a token, or matches no row when it is
 * empty.
 */
export async function rateLimit(req: Request, scope: string, perMinute: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  // Hashed, so the table holds no addresses.
  const key = createHash("sha256").update(`${scope}:${ip}`).digest("base64url").slice(0, 32);
  const now = Date.now();
  const refilled = "LEAST($2::float8, rate_limits.tokens + ($3::bigint - rate_limits.at) / 60000.0 * $2::float8)";
  const row = await one(
    `INSERT INTO rate_limits (key, tokens, at) VALUES ($1, $2::float8 - 1, $3::bigint)
     ON CONFLICT (key) DO UPDATE SET tokens = ${refilled} - 1, at = $3::bigint WHERE ${refilled} >= 1
     RETURNING tokens`,
    [key, perMinute, now],
  );
  // Now and then, forget buckets nobody has used for an hour.
  if (Math.random() < 0.01) void query("DELETE FROM rate_limits WHERE at < $1", [now - 3_600_000]).catch(() => {});
  if (!row) throw new HttpError(429, "Slow down a little and try again in a moment.");
}

/**
 * The largest file a request may carry. Vercel turns away request bodies
 * over 4.5 MB before they reach the app, so the app's own limit sits just
 * under that everywhere, and the browser shrinks pictures and recordings to
 * fit before sending them.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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
export async function ownerView(r: AvatarRecord) {
  return {
    usage: { ...usageOf(r), ...(await replyAllowance(r)) },
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

export type OwnerView = Awaited<ReturnType<typeof ownerView>>;

/** One row of an account's list of avatars, with the reply allowance its account gives it. */
export function summaryView(r: AvatarRecord, allowance: Allowance) {
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
    usage: { ...usageOf(r), ...allowance },
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
