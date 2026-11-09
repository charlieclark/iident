"use client";

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "chunk"; index: number; text: string }
  | { type: "pcm"; index: number; data: string; sampleRate: number }
  | { type: "pcm_end"; index: number }
  | { type: "audio"; index: number; url: string; durationMs: number }
  | { type: "audio_error"; index: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };

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
    body: JSON.stringify(body),
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
