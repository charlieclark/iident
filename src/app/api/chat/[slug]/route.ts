import { z } from "zod";
import type { AvatarRecord } from "@/lib/avatar/types";
import { getAvatar, getAvatarBySlug, verifyEditToken } from "@/lib/server/db";
import { HttpError, handle, rateLimit } from "@/lib/server/http";
import { SentenceChunker, sanitizeHistory, streamReply } from "@/lib/server/persona";
import { greetingFor, speakAs } from "@/lib/server/voice";

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })).max(60).default([]),
  /** Speak the persona's greeting instead of replying. */
  greet: z.boolean().optional(),
  /** Owner preview of an unpublished avatar (requires x-edit-token). */
  previewId: z.string().max(32).optional(),
});

function resolveAvatar(req: Request, slug: string, previewId?: string): AvatarRecord {
  if (previewId) {
    if (!verifyEditToken(previewId, req.headers.get("x-edit-token"))) throw new HttpError(403, "No access.");
    const r = getAvatar(previewId);
    if (r) return r;
  }
  const r = getAvatarBySlug(slug);
  if (!r) throw new HttpError(404, "This avatar doesn't exist or isn't published.");
  return r;
}

/**
 * One conversational turn, streamed as server-sent events:
 *   text   {delta}            reply text as Claude writes it
 *   chunk  {index, text}      a sentence was sent to TTS
 *   audio  {index, url}       that sentence's speech is ready
 *   done   {text}             reply finished
 *   error  {message}
 * Speech for each sentence is synthesized in parallel as soon as the
 * sentence completes, so the avatar starts talking before Claude finishes.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/chat/[slug]">) => {
  const { slug } = await ctx.params;
  rateLimit(req, "chat", 40);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid message.");
  const record = resolveAvatar(req, slug, parsed.data.previewId);
  const history = sanitizeHistory(parsed.data.messages);
  if (!parsed.data.greet && history[history.length - 1]?.role !== "user") {
    throw new HttpError(400, "Say something first.");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const speech: Promise<void>[] = [];
      let index = 0;
      const say = (text: string) => {
        const i = index++;
        send({ type: "chunk", index: i, text });
        speech.push(
          speakAs(record, text)
            .then((a) => send({ type: "audio", index: i, url: a.url, durationMs: a.durationMs }))
            .catch((err) => {
              console.error("tts failed", err);
              send({ type: "audio_error", index: i });
            }),
        );
      };

      try {
        if (parsed.data.greet) {
          const text = greetingFor(record.persona);
          send({ type: "text", delta: text });
          say(text);
          await Promise.all(speech);
          send({ type: "done", text });
        } else {
          const chunker = new SentenceChunker();
          let full = "";
          for await (const delta of streamReply({ persona: record.persona, history, signal: req.signal })) {
            full += delta;
            send({ type: "text", delta });
            for (const sentence of chunker.push(delta)) say(sentence);
          }
          for (const sentence of chunker.flush()) say(sentence);
          await Promise.all(speech);
          send({ type: "done", text: full.trim() });
        }
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("chat failed", err);
          send({ type: "error", message: "Sorry, I lost my train of thought. Try again?" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
