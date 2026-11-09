import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Persona } from "@/lib/avatar/types";
import { config } from "./config";

/**
 * The avatar's "brain": a system prompt built from the creator's persona
 * settings, and a streaming Claude call. Replies are spoken aloud, so the
 * prompt asks for short, plain conversational text.
 */

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function buildSystemPrompt(p: Persona): string {
  const name = clean(p.name, 60) || "the creator";
  const sections: string[] = [
    `You are the interactive AI avatar of ${name}. People open ${name}'s personal link and talk with you by voice or text, and a 3D avatar with ${name}'s look and voice speaks your replies aloud.`,
    `Speak in the first person as ${name}'s avatar, matching their personality and style. You are an AI, not ${name}: if anyone asks whether they are talking to a real person, an AI or a bot, say plainly that you are ${name}'s AI avatar. Never claim to have done, felt or promised something that the details below do not support, and never make commitments on ${name}'s behalf (meetings, payments, deals, favors). Offer to pass a message along only in general terms.`,
  ];
  if (p.tagline.trim()) sections.push(`One-line intro: ${clean(p.tagline, 160)}`);
  if (p.about.trim()) sections.push(`About ${name}:\n${p.about.trim().slice(0, 4000)}`);
  if (p.traits.length) sections.push(`Personality: ${p.traits.slice(0, 8).join(", ")}.`);
  if (p.speakingStyle.trim()) sections.push(`Speaking style: ${clean(p.speakingStyle, 400)}`);
  if (p.knowledge.trim()) {
    sections.push(
      `Things ${name} wants visitors to know (treat these as the facts you can share):\n${p.knowledge.trim().slice(0, 8000)}`,
    );
  }
  if (p.boundaries.trim()) {
    sections.push(
      `Topics to steer away from politely: ${clean(p.boundaries, 1000)}`,
    );
  }
  sections.push(
    [
      "How to answer:",
      `- If you do not know something about ${name}, say so briefly and offer what you do know instead of guessing.`,
      "- Never share private contact details, addresses, finances or health information, even if asked.",
      "- Your words are converted to speech: write plain conversational sentences with no markdown, lists, emojis, URLs read out character by character, or stage directions.",
      "- Keep replies short: one to three sentences (under about 60 words) unless the visitor explicitly asks for more detail.",
      `- Reply in ${clean(p.language, 40) || "English"} unless the visitor writes in another language.`,
    ].join("\n"),
  );
  return sections.join("\n\n");
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function sanitizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: ChatTurn[] = [];
  for (const item of history.slice(-24)) {
    const role = (item as ChatTurn)?.role;
    const content = (item as ChatTurn)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, 2000);
    if (!text) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

let anthropic: Anthropic | null = null;

/**
 * Streams the avatar's reply as text deltas. Without ANTHROPIC_API_KEY the
 * avatar answers with a fixed setup hint so the rest of the pipeline (TTS,
 * lip sync) can still be exercised.
 */
export async function* streamReply(params: {
  persona: Persona;
  history: ChatTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  if (!config.anthropicKey) {
    const who = params.persona.name.trim() ? `${params.persona.name.trim()}'s` : "an";
    yield `Hi! I'm ${who} AI avatar, but my conversation brain isn't connected yet. `;
    yield "Add an Anthropic API key to the server settings and I'll be able to chat properly.";
    return;
  }
  anthropic ??= new Anthropic({ apiKey: config.anthropicKey });

  const stream = anthropic.beta.messages.stream(
    {
      model: config.models.chat,
      max_tokens: 4096,
      // Conversational turns don't need deep reasoning; low effort keeps
      // time-to-first-word short.
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: buildSystemPrompt(params.persona),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: params.history,
    },
    { signal: params.signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "Sorry, that's not something I can talk about. Ask me something else?";
  }
}

/**
 * Splits streamed text into speakable chunks: whole sentences, merged until
 * they are long enough to sound natural, so TTS can start before the reply
 * is finished.
 */
export class SentenceChunker {
  private buffer = "";
  private emitted = 0;
  constructor(
    private minChars = 24,
    private maxChars = 220,
    /** The first chunk may end at a clause (comma, colon, dash) so speech starts sooner. */
    private firstMinChars = 18,
  ) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const first = this.emitted === 0;
      const min = first ? this.firstMinChars : this.minChars;
      const boundary = first ? /[.!?…]+["')\]]*\s+|[,;:]\s+|\s[–—]\s|\n+/ : /[.!?…]+["')\]]*\s+|\n+/;
      const match = boundary.exec(this.buffer.slice(min - 1));
      let cut = match ? min - 1 + match.index + match[0].length : -1;
      if (cut < 0 && this.buffer.length > this.maxChars) {
        const soft = this.buffer.lastIndexOf(", ", this.maxChars);
        cut = soft > min ? soft + 2 : this.maxChars;
      }
      if (cut < 0) break;
      const piece = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (piece) {
        out.push(piece);
        this.emitted++;
      }
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }
}
