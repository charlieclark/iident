"use client";

import type { z } from "zod";
import type { backdropChoiceSchema } from "@/lib/avatar/backdrop";
import type { AvatarContext } from "@/lib/avatar/context";
import type { Appearance } from "@/lib/avatar/options";
import type { FaceRig, Persona } from "@/lib/avatar/types";
import type { AvatarSummary, OwnerView } from "@/lib/server/http";
import type { PaidPlanId, PlanId } from "@/lib/billing/plans";
import { shrinkImage } from "./image";

export type Avatar = OwnerView;
export type { AvatarSummary };
export type Billing = {
  /** False when payments aren't configured: nothing is paywalled. */
  enabled: boolean;
  plan?: PlanId;
  builds?: { used: number; limit: number };
  live?: { used: number; limit: number };
  /** Replies to visitors this month across the account's avatars. */
  replies?: { used: number; limit: number };
  manageable?: boolean;
  status?: string | null;
  renewsAt?: number | null;
  cancelAtPeriodEnd?: boolean;
};
export type Account = { user: { email: string } | null; avatars: AvatarSummary[]; billing: Billing };
export type BackdropChoice = z.infer<typeof backdropChoiceSchema>;

const DRAFTS_KEY = "iident:drafts";

type Draft = { id: string; token: string; updatedAt: number };

export function listDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    const drafts = raw ? (JSON.parse(raw) as Draft[]) : [];
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveDraft(id: string, token: string) {
  try {
    const drafts = listDrafts().filter((d) => d.id !== id);
    drafts.unshift({ id, token, updatedAt: Date.now() });
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 20)));
  } catch {}
}

export function tokenFor(id: string): string | null {
  return listDrafts().find((d) => d.id === id)?.token ?? null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("x-edit-token", init.token);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A request the platform turns away for its size never reaches the app, so it carries no message of ours.
    const fallback = res.status === 413 ? "That file is too large to upload." : `Request failed (${res.status})`;
    throw new ApiError((data as { error?: string }).error ?? fallback, res.status);
  }
  return data as T;
}

/**
 * Adds the owner token to URLs of private files (selfie, concepts, voice).
 * With no token (an avatar opened through the account) the session cookie gives access.
 */
export const ownerUrl = (url: string | null | undefined, token: string | null) =>
  url && token ? `${url}?t=${encodeURIComponent(token)}` : (url ?? "");

export const api = {
  /** Asks for a sign-in link. `devLink` only comes back in development with no email service. */
  startSignIn: (email: string) => request<{ sent: true; devLink?: string }>("/api/auth/start", { method: "POST", body: JSON.stringify({ email }) }),
  finishSignIn: (token: string) => request<{ user: { email: string } }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  signOut: () => request<{ ok: true }>("/api/auth/signout", { method: "POST" }),
  me: () => request<Account>("/api/me"),
  /** Starts checkout for a plan; open the returned URL. */
  checkout: (plan: PaidPlanId) => request<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) }),
  confirmCheckout: (sessionId: string) => request<{ plan: PlanId }>("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId }) }),
  billingPortal: () => request<{ url: string }>("/api/billing/portal", { method: "POST" }),
  /** Attaches the drafts stored in this browser to the signed-in account. */
  claimDrafts: () => {
    const drafts = listDrafts().map(({ id, token }) => ({ id, token }));
    if (!drafts.length) return Promise.resolve({ claimed: [] as string[] });
    return request<{ claimed: string[] }>("/api/me/claim", { method: "POST", body: JSON.stringify({ drafts }) });
  },
  create: () => request<{ avatar: Avatar; editToken: string }>("/api/avatars", { method: "POST" }),
  get: (id: string, token: string) => request<{ avatar: Avatar }>(`/api/avatars/${id}`, { token }),
  patch: (
    id: string,
    token: string,
    body: { appearance?: Appearance; persona?: Persona; context?: AvatarContext; backdrop?: BackdropChoice; consent?: boolean; voicePreset?: string },
  ) => request<{ avatar: Avatar }>(`/api/avatars/${id}`, { method: "PATCH", token, body: JSON.stringify(body) }),
  /** Uses an uploaded picture as the backdrop. */
  uploadBackdrop: async (id: string, token: string, file: Blob) => {
    const form = new FormData();
    form.set("file", await shrinkImage(file, 2000));
    return request<{ avatar: Avatar }>(`/api/avatars/${id}/backdrop`, { method: "POST", token, body: form });
  },
  /** Generates a backdrop scene from a short description. */
  generateBackdrop: (id: string, token: string, prompt: string) =>
    request<{ avatar: Avatar }>(`/api/avatars/${id}/backdrop`, { method: "POST", token, body: JSON.stringify({ prompt }) }),
  uploadSelfie: async (id: string, token: string, file: Blob) => {
    const form = new FormData();
    form.set("file", await shrinkImage(file, 1600), "selfie.jpg");
    form.set("consent", "true");
    return request<{ avatar: Avatar }>(`/api/avatars/${id}/selfie`, { method: "POST", token, body: form });
  },
  /** "preview": a quick draft of the look. "final": the high-likeness render the 3D model is built from. */
  drawCharacter: (id: string, token: string, appearance: Appearance, kind: "preview" | "final", signal?: AbortSignal) =>
    request<{ avatar: Avatar; created: string[]; inline?: string }>(`/api/avatars/${id}/concepts`, {
      method: "POST",
      token,
      body: JSON.stringify({ appearance, kind }),
      signal,
    }),
  /** The shared mannequin wearing a look. `inline` is the picture itself when it was drawn just now. */
  mannequin: (appearance: Appearance, signal?: AbortSignal) =>
    request<{ url: string; inline?: string }>("/api/mannequin", { method: "POST", body: JSON.stringify({ appearance }), signal }),
  refineConcept: (id: string, token: string, conceptId: string, instruction: string) =>
    request<{ avatar: Avatar; created: string[] }>(`/api/avatars/${id}/concepts/refine`, {
      method: "POST",
      token,
      body: JSON.stringify({ conceptId, instruction }),
    }),
  buildModel: (id: string, token: string, conceptId: string) =>
    request<{ avatar: Avatar }>(`/api/avatars/${id}/model`, { method: "POST", token, body: JSON.stringify({ conceptId }) }),
  saveFaceRig: (id: string, token: string, rig: FaceRig, thumbnail?: string) =>
    request<{ avatar: Avatar }>(`/api/avatars/${id}/face-rig`, {
      method: "PUT",
      token,
      body: JSON.stringify({ rig, thumbnail }),
    }),
  cloneVoice: (id: string, token: string, file: Blob, name: string) => {
    const form = new FormData();
    form.set("file", file, name);
    form.set("consent", "true");
    return request<{ avatar: Avatar }>(`/api/avatars/${id}/voice`, { method: "POST", token, body: form });
  },
  previewVoice: (id: string, token: string, body: { text?: string; preset?: string }) =>
    request<{ url: string; durationMs: number }>(`/api/avatars/${id}/voice/preview`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  publish: (id: string, token: string, slug: string, published = true) =>
    request<{ avatar: Avatar; url?: string }>(`/api/avatars/${id}/publish`, {
      method: "POST",
      token,
      body: JSON.stringify({ slug, published }),
    }),
  transcribe: (audio: Blob, language?: string) => {
    const form = new FormData();
    form.set("file", audio, `message.${audio.type.includes("mp4") ? "m4a" : "webm"}`);
    if (language) form.set("language", language);
    return request<{ text: string }>("/api/stt", { method: "POST", body: form });
  },
};
