import { z } from "zod";
import { toPublicItem, type PublicItem } from "@/lib/avatar/context";
import type { AvatarRecord } from "@/lib/avatar/types";
import { getAvatar, getAvatarBySlug, verifyEditToken } from "@/lib/server/db";
import { HttpError, handle, rateLimit } from "@/lib/server/http";
import { SentenceChunker, sanitizeHistory, streamReply } from "@/lib/server/persona";
import { createSpeaker, greetingFor, usesClonedVoice } from "@/lib/server/voice";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.string(), content: z.string(), shown: z.array(z.string()).max(10).optional() }))
    .max(60)
    .default([]),
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
 *   pcm    {index, data}      streamed speech (ElevenLabs): base64 16-bit PCM
 *   pcm_end {index}           that sentence's stream is complete
 *   audio  {index, url}       a whole clip is ready (MiniMax fallback)
 *   show   {items}            the avatar put catalog items on screen (cards)
 *   done   {text, shown}      reply finished; `shown` lists the item ids, for the next turn's history
 *   error  {message}
 * Speech for each sentence starts as soon as the sentence completes, so the
 * avatar starts talking before Claude finishes the reply.
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
      const speaker = await createSpeaker(record, send, req.signal);
      const say = (text: string) => speaker.say(text);

      try {
        if (parsed.data.greet) {
          const text = greetingFor(record.persona);
          send({ type: "text", delta: text });
          const chunker = new SentenceChunker();
          for (const sentence of [...chunker.push(`${text} `), ...chunker.flush()]) say(sentence);
          await speaker.done();
          send({ type: "done", text });
        } else {
          const chunker = new SentenceChunker();
          const items = new Map(record.context.items.map((item) => [item.id, item]));
          const shown: string[] = [];
          let full = "";
          const reply = streamReply({
            persona: record.persona,
            context: record.context,
            ownVoice: usesClonedVoice(record),
            history,
            signal: req.signal,
          });
          for await (const event of reply) {
            if (event.type === "show") {
              const cards = event.ids.flatMap((id) => {
                const item = items.get(id);
                return item && !shown.includes(id) ? [toPublicItem(item)] : [];
              }) satisfies PublicItem[];
              if (!cards.length) continue;
              shown.push(...cards.map((card) => card.id));
              send({ type: "show", items: cards });
              continue;
            }
            full += event.delta;
            send({ type: "text", delta: event.delta });
            for (const sentence of chunker.push(event.delta)) say(sentence);
          }
          for (const sentence of chunker.flush()) say(sentence);
          await speaker.done();
          send({ type: "done", text: full.trim(), shown });
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
