"use client";

import type { PublicItem } from "@/lib/avatar/context";

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "chunk"; index: number; text: string }
  | { type: "pcm"; index: number; data: string; sampleRate: number }
  | { type: "pcm_end"; index: number }
  | { type: "audio"; index: number; url: string; durationMs: number }
  | { type: "audio_error"; index: number }
  | { type: "show"; items: PublicItem[] }
  | { type: "done"; text: string; shown?: string[]; limited?: boolean }
  | { type: "error"; message: string };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Cards the avatar put on screen with this reply. */
  items?: PublicItem[];
};

/** POSTs a turn and invokes `onEvent` for each server-sent event. */
export async function streamChat(
  slug: string,
  body: { messages?: ChatMessage[]; greet?: boolean; previewId?: string },
  onEvent: (e: ChatEvent) => void,
  opts: { token?: string | null; signal?: AbortSignal } = {},
) {
  const res = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.token ? { "x-edit-token": opts.token } : {}) },
    body: JSON.stringify({
      ...body,
      // The server only needs the ids of the cards shown, to replay them for the model.
      messages: body.messages?.map(({ role, content, items }) =>
        items?.length ? { role, content, shown: items.map((item) => item.id) } : { role, content },
      ),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "The avatar is unavailable right now.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatEvent);
      } catch {}
    }
  }
}
