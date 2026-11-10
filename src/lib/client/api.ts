"use client";

import type { z } from "zod";
import type { backdropChoiceSchema } from "@/lib/avatar/backdrop";
import type { AvatarContext } from "@/lib/avatar/context";
import type { Appearance } from "@/lib/avatar/options";
import type { FaceRig, Persona } from "@/lib/avatar/types";
import type { OwnerView } from "@/lib/server/http";

export type Avatar = OwnerView;
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
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Adds the owner token to URLs of private files (selfie, concepts, voice). */
export const ownerUrl = (url: string | null | undefined, token: string | null) =>
  url && token ? `${url}?t=${encodeURIComponent(token)}` : (url ?? "");

export const api = {
  create: () => request<{ avatar: Avatar; editToken: string }>("/api/avatars", { method: "POST" }),
  get: (id: string, token: string) => request<{ avatar: Avatar }>(`/api/avatars/${id}`, { token }),
  patch: (
    id: string,
    token: string,
    body: { appearance?: Appearance; persona?: Persona; context?: AvatarContext; backdrop?: BackdropChoice; consent?: boolean; voicePreset?: string },
  ) => request<{ avatar: Avatar }>(`/api/avatars/${id}`, { method: "PATCH", token, body: JSON.stringify(body) }),
  /** Uses an uploaded picture as the backdrop. */
  uploadBackdrop: (id: string, token: string, file: Blob) => {
    const form = new FormData();
    form.set("file", file);
    return request<{ avatar: Avatar }>(`/api/avatars/${id}/backdrop`, { method: "POST", token, body: form });
  },
  /** Generates a backdrop scene from a short description. */
  generateBackdrop: (id: string, token: string, prompt: string) =>
    request<{ avatar: Avatar }>(`/api/avatars/${id}/backdrop`, { method: "POST", token, body: JSON.stringify({ prompt }) }),
  uploadSelfie: (id: string, token: string, file: Blob) => {
    const form = new FormData();
    form.set("file", file, "selfie.jpg");
    form.set("consent", "true");
    return request<{ avatar: Avatar }>(`/api/avatars/${id}/selfie`, { method: "POST", token, body: form });
  },
  /** "preview": a quick draft of the look. "final": the high-likeness render the 3D model is built from. */
  drawCharacter: (id: string, token: string, appearance: Appearance, kind: "preview" | "final", signal?: AbortSignal) =>
    request<{ avatar: Avatar; created: string[] }>(`/api/avatars/${id}/concepts`, {
      method: "POST",
      token,
      body: JSON.stringify({ appearance, kind }),
      signal,
    }),
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
